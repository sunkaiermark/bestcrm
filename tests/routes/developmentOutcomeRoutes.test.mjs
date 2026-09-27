import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentConceptError } from '../../src/domain/developmentConcepts.mjs';

async function agentFor(roles, repository, { enabled = true } = {}) {
  const user = {
    id: 901, username: 'npd_outcome_route', displayName: 'Outcome user',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'npd-outcome-test', csrfProtection: false,
    developmentWorkspace: { enabled }, developmentOutcomeRepository: repository,
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

test('outcome workspace remains dark and denies nonmember reads', async () => {
  const repository = { async listTopicOutcomes() {
    throw new DevelopmentConceptError('Development topic not found', 404);
  } };
  const disabled = await agentFor(['salesperson'], repository, { enabled: false });
  assert.equal((await disabled.agent.get('/development/topics/7/outcomes')).status, 404);
  const { app, agent } = await agentFor(['salesperson'], repository);
  assert.equal((await request(app).get('/development/topics/7/outcomes')).status, 302);
  assert.equal((await agent.get('/development/topics/7/outcomes')).status, 404);
});

test('member outcome page escapes findings and accepts immutable revision form', async () => {
  const calls = [];
  const repository = {
    async listTopicOutcomes() { return {
      topic: { id: 7, topicNo: 'NPD-7', title: 'Mixer', phase: 'exploration' },
      revisions: [{ id: 12, topicId: 7, revisionNo: 1, outcomeKind: 'lesson_learned',
        title: '<script>title</script>', finding: '<script>finding</script>',
        applicability: 'Internal only', limitations: 'Unverified',
        evidenceReferences: ['Lab note'], authoredByUserId: 902,
        authoredAt: new Date(), candidate: null }]
    }; },
    async createOutcomeRevision(input) { calls.push(input); return { id: 13, ...input }; },
    async proposeAssetCandidate(input) { calls.push(input); return { id: 14, ...input }; }
  };
  const { agent } = await agentFor(['salesperson'], repository);
  const page = await agent.get('/development/topics/7/outcomes');
  assert.equal(page.status, 200);
  assert.match(page.text, /&lt;script&gt;finding&lt;\/script&gt;/);
  assert.doesNotMatch(page.text, /<script>finding<\/script>/);
  assert.match(page.text, /not asset publication or customer-use approval/);
  const invalid = await agent.post('/development/topics/7/outcomes').send({
    outcomeKind: 'unknown', title: 'Title', finding: 'Finding'
  });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 0);
  const created = await agent.post('/development/topics/7/outcomes').type('form').send({
    outcomeKind: 'lesson_learned', title: 'Seal trial', finding: 'Seal failed',
    applicability: 'Viscous batches', limitations: 'One run only',
    evidenceReferences: 'Lab note 1\nLab note 2'
  });
  assert.equal(created.status, 303);
  assert.deepEqual(calls[0].evidenceReferences, ['Lab note 1', 'Lab note 2']);
  const proposed = await agent.post('/development/topics/7/outcomes/12/candidate')
    .type('form').send({ rationale: 'Avoid repeat failure' });
  assert.equal(proposed.status, 303);
  assert.equal(calls[1].revisionId, 12);
});

test('candidate review requires a technical manager in service and remains repository scoped', async () => {
  const calls = [];
  const repository = { async reviewAssetCandidate(input) {
    calls.push(input); return { id: 8, ...input };
  } };
  const salesperson = await agentFor(['salesperson'], repository);
  const refused = await salesperson.agent.post('/development/topics/7/asset-candidates/9/review')
    .send({ decisionCode: 'endorsed', reason: 'Independent evidence' });
  assert.equal(refused.status, 403);
  assert.equal(calls.length, 0);
  const manager = await agentFor(['technical_manager'], repository);
  const reviewed = await manager.agent.post('/development/topics/7/asset-candidates/9/review')
    .send({ decisionCode: 'endorsed', reason: 'Evidence is adequate' });
  assert.equal(reviewed.status, 201);
  assert.equal(calls[0].reviewerUserId, 901);
  assert.equal(calls[0].topicId, 7);
});

test('internal asset library and publish/withdraw actions preserve separate manager authority', async () => {
  const calls = [];
  const repository = {
    async listVisibleAssets(input) {
      calls.push(['list', input]);
      return [{ id: 51, topicId: 7, topicNo: 'NPD-7', topicTitle: 'Mixer',
        revisionNo: 2, title: '<script>private</script>', finding: 'Safe result',
        applicability: 'Batch', limitations: 'Pilot only' }];
    },
    async publishAsset(input) { calls.push(['publish', input]); return { id: 51 }; },
    async withdrawAsset(input) { calls.push(['withdraw', input]); return { id: 52 }; }
  };
  const salesperson = await agentFor(['salesperson'], repository);
  const library = await salesperson.agent.get('/development/assets');
  assert.equal(library.status, 200);
  assert.match(library.text, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(library.text, /<script>private<\/script>/);
  assert.match(library.text, /customer-facing use requires approval/);
  assert.equal(calls[0][1].actorUserId, 901);
  assert.equal((await salesperson.agent.post(
    '/development/topics/7/asset-candidates/22/publish'
  ).send({ reason: 'Internally validated' })).status, 403);
  assert.equal(calls.length, 1);
  const manager = await agentFor(['technical_manager'], repository);
  const published = await manager.agent.post('/development/topics/7/asset-candidates/22/publish')
    .type('form').send({ reason: 'Independent result' });
  assert.equal(published.status, 303);
  assert.equal(calls[1][1].publisherUserId, 901);
  const withdrawn = await manager.agent.post('/development/topics/7/assets/51/withdraw')
    .type('form').send({ reason: 'New test failed' });
  assert.equal(withdrawn.status, 303);
  assert.equal(calls[2][1].assetId, 51);
});
