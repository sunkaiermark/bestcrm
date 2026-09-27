import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentConceptError } from '../../src/domain/developmentConcepts.mjs';

async function agentFor(roles, repository, { workspaceEnabled = false } = {}) {
  const user = {
    id: 902, username: 'npd_policy_route', displayName: 'NPD User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'npd-policy-test-secret', csrfProtection: false,
    developmentWorkspace: { enabled: workspaceEnabled },
    developmentPolicyRepository: repository,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({
    username: user.username, password: 'ChangeMe123!'
  });
  return agent;
}

test('P2 policy HTTP denies anonymous and non-admin decisions or proxy appointment', async () => {
  const repository = {
    async decideLifecycle() { throw new Error('Must not reach repository'); },
    async appointReviewerProxy() { throw new Error('Must not reach repository'); }
  };
  const anonymous = createApp({ databaseUrl: '',
    sessionSecret: 'npd-policy-test-secret', developmentPolicyRepository: repository });
  assert.equal((await request(anonymous)
    .post('/development/topics/1/lifecycle-requests/2/decision')
    .send({ decisionCode: 'approved' })).status, 401);
  const owner = await agentFor(['salesperson'], repository);
  assert.equal((await owner.post('/development/topics/1/lifecycle-requests/2/decision')
    .send({ decisionCode: 'approved', reason: 'Okay', idempotencyKey: 'a' })).status, 403);
  assert.equal((await owner.post('/development/topics/1/reviewer-delegations')
    .send({ absentManagerUserId: 10, proxyManagerUserId: 11,
      validFrom: '2026-09-27T00:00:00Z', validUntil: '2026-09-30T00:00:00Z',
      reason: 'Absence', idempotencyKey: 'b' })).status, 403);
});

test('lifecycle management page exposes owner requests and administrator decisions', async () => {
  const calls = [];
  const repository = {
    async getLifecycle() { return {
      topicId: 7, topicNo: 'NPD-7', ownerUserId: 902,
      phase: 'exploration', rowVersion: 3,
      requests: [{ id: 4, actionCode: 'pause', reason: '<script>private</script>',
        requestedByUserId: 902, decision: null }]
    }; },
    async requestLifecycle(input) { calls.push(['request', input]); return { id: 5 }; },
    async decideLifecycle(input) { calls.push(['decision', input]); return { id: 6 }; }
  };
  const owner = await agentFor(['salesperson'], repository, { workspaceEnabled: true });
  const page = await owner.get('/development/topics/7/lifecycle/manage');
  assert.equal(page.status, 200);
  assert.match(page.text, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(page.text, /<script>private<\/script>/);
  assert.doesNotMatch(page.text, /name="decisionCode"/);
  const requested = await owner.post('/development/topics/7/lifecycle-requests')
    .type('form').send({ actionCode: 'stop', reason: 'No demand',
      expectedRowVersion: '3', idempotencyKey: 'owner-request-1' });
  assert.equal(requested.status, 303);
  assert.equal(calls[0][1].expectedRowVersion, 3);

  const admin = await agentFor(['administrator'], repository, { workspaceEnabled: true });
  const adminPage = await admin.get('/development/topics/7/lifecycle/manage');
  assert.match(adminPage.text, /name="decisionCode"/);
  const decided = await admin.post('/development/topics/7/lifecycle-requests/4/decision')
    .type('form').send({ decisionCode: 'approved', reason: 'Validated',
      idempotencyKey: 'admin-decision-1' });
  assert.equal(decided.status, 303);
  assert.equal(calls[1][1].actorUserId, 902);
  assert.equal(calls[1][1].requestId, 4);
});

test('proxy management form is administrator-only and uses scoped active-manager choices', async () => {
  const calls = [];
  const repository = {
    async listReviewerDelegations() { return [{
      id: 12, absentManagerUserId: 31, proxyManagerUserId: 32,
      validFrom: '2099-01-01T00:00:00Z', validUntil: '2099-02-01T00:00:00Z',
      reason: '<script>private</script>', revokedAt: null
    }]; },
    async listReviewerProxyCandidates(input) {
      calls.push(['choices', input]);
      return {
        absentManagers: [{ userId: 31, displayName: 'Assigned manager' }],
        proxyManagers: [{ userId: 31, displayName: 'Assigned manager' },
          { userId: 32, displayName: 'Another manager' }]
      };
    },
    async appointReviewerProxy(input) { calls.push(['appoint', input]); return { id: 13 }; },
    async revokeReviewerProxy(input) { calls.push(['revoke', input]); return { id: 14 }; }
  };
  const owner = await agentFor(['salesperson'], repository, { workspaceEnabled: true });
  assert.equal((await owner.get('/development/topics/7/reviewer-delegations/manage')).status, 403);
  const admin = await agentFor(['administrator'], repository, { workspaceEnabled: true });
  const page = await admin.get('/development/topics/7/reviewer-delegations/manage');
  assert.equal(page.status, 200);
  assert.match(page.text, /Assigned manager/);
  assert.match(page.text, /Another manager/);
  assert.match(page.text, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(page.text, /<script>private<\/script>/);
  assert.equal(calls[0][1].actorUserId, 902);
  const appointed = await admin.post('/development/topics/7/reviewer-delegations')
    .type('form').send({ absentManagerUserId: '31', proxyManagerUserId: '32',
      validFrom: '2099-01-01T00:00:00Z', validUntil: '2099-02-01T00:00:00Z',
      reason: 'Absence', idempotencyKey: 'proxy-form-1' });
  assert.equal(appointed.status, 303);
  assert.equal(calls[1][1].proxyManagerUserId, 32);
  const revoked = await admin.post('/development/topics/7/reviewer-delegations/12/revoke')
    .type('form').send({ reason: 'Returned', idempotencyKey: 'proxy-revoke-1' });
  assert.equal(revoked.status, 303);
  assert.equal(calls[2][1].delegationId, 12);
});

test('P2 policy HTTP validates request and maps visibility and conflicts', async () => {
  const calls = [];
  const repository = {
    async requestLifecycle(input) { calls.push(input); return { id: 8, ...input }; },
    async getLifecycle() { throw new DevelopmentConceptError('Not found', 404); },
    async revokeReviewerProxy() {
      throw new DevelopmentConceptError('Already revoked', 409);
    }
  };
  const owner = await agentFor(['salesperson'], repository);
  const invalid = await owner.post('/development/topics/1/lifecycle-requests').send({
    actionCode: 'conclude', expectedRowVersion: 1,
    reason: 'Try', idempotencyKey: 'wrong'
  });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.fields, ['actionCode']);
  assert.equal(calls.length, 0);
  const created = await owner.post('/development/topics/1/lifecycle-requests').send({
    actionCode: 'pause', expectedRowVersion: 2,
    reason: 'Await test result', idempotencyKey: 'pause-1'
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.equal(calls[0].actionCode, 'pause');
  assert.equal((await owner.get('/development/topics/1/lifecycle')).status, 404);
  const admin = await agentFor(['administrator'], repository);
  const conflict = await admin.post('/development/topics/1/reviewer-delegations/4/revoke')
    .send({ reason: 'Returned', idempotencyKey: 'revoke-1' });
  assert.equal(conflict.status, 409);
});
