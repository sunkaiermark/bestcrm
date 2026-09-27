import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentConceptError } from '../../src/domain/developmentConcepts.mjs';

async function agentFor(roles, repository) {
  const user = {
    id: 902, username: 'npd_policy_route', displayName: 'NPD User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'npd-policy-test-secret', csrfProtection: false,
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
