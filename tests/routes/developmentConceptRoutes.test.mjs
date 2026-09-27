import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentConceptError } from '../../src/domain/developmentConcepts.mjs';

async function agentFor(roles, repository) {
  const user = {
    id: 901, username: 'npd_p2_route', displayName: 'NPD User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'npd-test-secret', csrfProtection: false,
    developmentConceptRepository: repository,
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

test('P2 direct API denies anonymous approval and non-manager approval', async () => {
  const repository = {
    async decideConceptRevision() { throw new Error('Must not reach repository'); }
  };
  const anonymous = createApp({ databaseUrl: '', sessionSecret: 'npd-test-secret',
    developmentConceptRepository: repository });
  assert.equal((await request(anonymous)
    .post('/development/topics/1/concepts/2/decision')
    .send({ decisionCode: 'approved' })).status, 401);
  const salesperson = await agentFor(['salesperson'], repository);
  assert.equal((await salesperson.post('/development/topics/1/concepts/2/decision')
    .send({ expectedRowVersion: 3, decisionCode: 'approved', reason: 'Ready',
      idempotencyKey: 'one' })).status, 403);
});

test('P2 direct API maps field errors, object denial and optimistic conflicts', async () => {
  const calls = [];
  const repository = {
    async createConceptRevision(input) { calls.push(input); return { id: 4, ...input }; },
    async getConceptGate() { throw new DevelopmentConceptError('Not found', 404); },
    async requestFormalDesignHandoff() {
      throw new DevelopmentConceptError('Current approval required', 409);
    }
  };
  const owner = await agentFor(['salesperson'], repository);
  const incomplete = await owner.post('/development/topics/1/concepts')
    .send({ expectedRowVersion: 1, snapshot: { problem: 7 } });
  assert.equal(incomplete.status, 422);
  assert.deepEqual(incomplete.body.fields, ['problem']);
  assert.equal(calls.length, 0);
  const created = await owner.post('/development/topics/1/concepts')
    .send({ expectedRowVersion: 1, snapshot: { problem: 'Idea' } });
  assert.equal(created.status, 201);
  assert.match(created.body.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.equal((await owner.get('/development/topics/1/concept-gate')).status, 404);
  const refused = await owner.post('/development/topics/1/design-handoffs').send({
    revisionId: 4, expectedRowVersion: 2, idempotencyKey: 'handoff-one'
  });
  assert.equal(refused.status, 409);
});

test('concept preview is a member-scoped escaped snapshot, not an editable design', async () => {
  const repository = {
    async getConceptRevision() {
      return {
        topicNo: 'NPD-7', topicTitle: 'Mixer idea', revisionNo: 2,
        isCurrent: true, authoredAt: new Date(), snapshotSha256: 'a'.repeat(64),
        snapshot: {
          problem: '<script>alert(1)</script>', application: 'Batch line',
          scope: 'Mixer', options: [{
            name: 'Option A', benefits: 'Less cleaning', tradeoffs: 'Seal risk'
          }], preferredOption: 'Option A', assumptions: ['Viscosity bound'],
          risks: ['Wear'], evidence: ['Bench note'],
          nextStepEffort: 'Two weeks', customerOpportunityRelation: ''
        },
        submittedAt: new Date(), decisionCode: 'approved',
        decisionReason: 'Approved for limited design', isSelfReview: false
      };
    }
  };
  const actor = await agentFor(['technical_manager'], repository);
  const response = await actor.get('/development/topics/7/concepts/12/preview');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.text, /Concept review preview/);
  assert.match(response.text, /Option A/);
  assert.match(response.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(response.text, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(response.text, /<form[^>]*design/i);
  await actor.get('/language?lang=zh&returnTo=/development/topics/7/concepts/12/preview');
  const chinese = await actor.get('/development/topics/7/concepts/12/preview');
  assert.equal(chinese.status, 200);
  assert.match(chinese.text, /概念方案预览/);
});
