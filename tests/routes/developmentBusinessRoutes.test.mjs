import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentConceptError } from '../../src/domain/developmentConcepts.mjs';

async function agentFor(roles, repository, { enabled = true } = {}) {
  const user = { id: 901, username: 'npd_business_route', displayName: 'Business user',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles };
  const app = createApp({ databaseUrl: '', sessionSecret: 'npd-business-test',
    csrfProtection: false, developmentWorkspace: { enabled },
    developmentBusinessRepository: repository,
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
  return { app, agent };
}

test('business link workspace stays dark and enforces topic membership', async () => {
  const repository = { async listTopicBusiness() {
    throw new DevelopmentConceptError('Development topic not found', 404);
  } };
  const disabled = await agentFor(['salesperson'], repository, { enabled: false });
  assert.equal((await disabled.agent.get('/development/topics/7/business')).status, 404);
  const { app, agent } = await agentFor(['salesperson'], repository);
  assert.equal((await request(app).get('/development/topics/7/business')).status, 302);
  assert.equal((await agent.get('/development/topics/7/business')).status, 404);
});

test('business page escapes opportunity and asset labels and scopes search', async () => {
  const calls = [];
  const repository = {
    async listTopicBusiness(input) {
      calls.push(['list', input]);
      return { topic: { id: 7, topicNo: 'NPD-7', ownerUserId: 901 },
        links: [{ id: 3, opportunityId: 22, opportunityNo: '800022',
          opportunityTitle: '<script>opportunity</script>', reason: 'Prototype' }],
        assets: [{ id: 5, title: '<script>asset</script>',
          revisionNo: 1, outcomeRevisionId: 11 }], requests: [] };
    },
    async searchVisibleOpportunities(input) {
      calls.push(['search', input]); return [];
    },
    async listSentCustomerFiles() { return []; },
    async linkOpportunity(input) {
      calls.push(['link', input]); return { id: 4 };
    }
  };
  const { agent } = await agentFor(['salesperson'], repository);
  const page = await agent.get('/development/topics/7/business?search=reactor');
  assert.equal(page.status, 200);
  assert.match(page.text, /&lt;script&gt;opportunity&lt;\/script&gt;/);
  assert.match(page.text, /&lt;script&gt;asset&lt;\/script&gt;/);
  assert.doesNotMatch(page.text, /<script>asset<\/script>/);
  assert.equal(calls[1][1].actorUserId, 901);
  assert.equal(calls[1][1].search, 'reactor');
  const invalid = await agent.post('/development/topics/7/business/links').send({
    opportunityId: 22, reason: ''
  });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 2);
  const linked = await agent.post('/development/topics/7/business/links')
    .type('form').send({ opportunityId: 22, reason: 'Customer request' });
  assert.equal(linked.status, 303);
  assert.equal(calls[2][1].actorUserId, 901);
  assert.equal(calls[2][1].opportunityId, 22);
});

test('customer-use approval is a separate manager-only exact request and revocation', async () => {
  const calls = [];
  const repository = {
    async requestCustomerUse(input) { calls.push(['request', input]); return { id: 15 }; },
    async decideCustomerUse(input) { calls.push(['decide', input]); return { id: 16 }; },
    async revokeCustomerUse(input) { calls.push(['revoke', input]); return { id: 17 }; }
  };
  const salesperson = await agentFor(['salesperson'], repository);
  const requested = await salesperson.agent.post(
    '/development/topics/7/business/links/3/customer-use'
  ).send({ assetId: 5, purpose: 'Quote 800022 technical section' });
  assert.equal(requested.status, 201);
  assert.equal(calls[0][1].linkId, 3);
  assert.equal(calls[0][1].assetId, 5);
  assert.equal((await salesperson.agent.post(
    '/development/topics/7/business/requests/15/decision'
  ).send({ decisionCode: 'approved', reason: 'Validated' })).status, 403);
  assert.equal(calls.length, 1);
  const manager = await agentFor(['technical_manager'], repository);
  const invalid = await manager.agent.post(
    '/development/topics/7/business/requests/15/decision'
  ).send({ decisionCode: 'approved', reason: '' });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 1);
  const decided = await manager.agent.post(
    '/development/topics/7/business/requests/15/decision'
  ).send({ decisionCode: 'approved', reason: 'Scoped to exact revision and use' });
  assert.equal(decided.status, 201);
  assert.equal(calls[1][1].actorUserId, 901);
  assert.equal(calls[1][1].requestId, 15);
  const revoked = await manager.agent.post(
    '/development/topics/7/business/requests/15/revoke'
  ).type('form').send({ reason: 'Evidence superseded' });
  assert.equal(revoked.status, 303);
  assert.equal(calls[2][1].requestId, 15);
});

test('file-use binding validates archived evidence identity and keeps actor scope', async () => {
  const calls = [];
  const repository = { async recordCustomerFileUse(input) {
    calls.push(input); return { id: 19, sha256: 'a'.repeat(64) };
  } };
  const { agent } = await agentFor(['salesperson'], repository);
  const endpoint = '/development/topics/7/business/requests/15/file-uses';
  assert.equal((await agent.post(endpoint).send({
    evidenceKey: 'technical_solution:2:3', usageLocation: ''
  })).status, 422);
  assert.equal((await agent.post(endpoint).send({
    evidenceKey: 'quotation_package:0:3', usageLocation: 'Page 2'
  })).status, 422);
  assert.equal((await agent.post(endpoint).send({
    evidenceKey: 'technical_solution:2:3', usageLocation: 'Page 2'
  })).status, 422);
  assert.equal(calls.length, 0);
  const bound = await agent.post(endpoint).send({
    evidenceKey: 'quotation_package:17:29', usageLocation: '  Page 2, process description  ',
    contentConfirmed: true
  });
  assert.equal(bound.status, 201);
  assert.deepEqual(calls[0], {
    topicId: 7, requestId: 15, actorUserId: 901,
    fileKind: 'quotation_package', fileId: 17, emailAttachmentId: 29,
    usageLocation: 'Page 2, process description'
  });
});

test('business page separates approved intent from sent-file evidence and escapes evidence text', async () => {
  const repository = {
    async listTopicBusiness() {
      return {
        topic: { id: 7, topicNo: 'NPD-7', ownerUserId: 901 },
        links: [{ id: 3, opportunityId: 22, opportunityNo: '800022',
          opportunityTitle: 'Customer', reason: 'Customer idea' }],
        assets: [], requests: [{
          id: 15, linkId: 3, opportunityId: 22,
          outcomeTitle: 'Approved result', revisionNo: 1, outcomeRevisionId: 12,
          purpose: 'Proposal paragraph', effective: true,
          decision: { id: 16, decisionCode: 'approved',
            decidedAt: '2026-09-27T01:00:00Z', reason: 'Limited use' },
          fileUses: []
        }]
      };
    },
    async listSentCustomerFiles() {
      return [{ opportunityId: 22, evidenceKey: 'technical_solution:4:9',
        fileName: '<script>unsafe</script>.pdf', versionLabel: 'TS-V1',
        emailMessageId: 8, emailAttachmentId: 9,
        sentAt: '2026-09-27T02:00:00Z' }];
    },
    async searchVisibleOpportunities() { return []; }
  };
  const { agent } = await agentFor(['salesperson'], repository);
  const page = await agent.get('/development/topics/7/business');
  assert.equal(page.status, 200);
  assert.match(page.text, /Approved for use; no customer-file use recorded yet/);
  assert.match(page.text, /technical_solution:4:9/);
  assert.match(page.text, /&lt;script&gt;unsafe&lt;\/script&gt;\.pdf/);
  assert.doesNotMatch(page.text, /<script>unsafe<\/script>/);
  assert.match(page.text, /name="contentConfirmed"/);
});
