import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentTopicError } from '../../src/domain/developmentTopics.mjs';

async function makeAgent(repository, { enabled = true, conceptRepository = null } = {}) {
  const user = {
    id: 901, username: 'npd_p4_user', displayName: 'NPD User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles: ['salesperson']
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'npd-p4-test', csrfProtection: false,
    developmentWorkspace: { enabled }, developmentRepository: repository,
    developmentConceptRepository: conceptRepository,
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

test('P4 workspace remains unavailable while its independent flag is off', async () => {
  const { agent } = await makeAgent({}, { enabled: false });
  assert.equal((await agent.get('/development/topics')).status, 404);
  const workbench = await agent.get('/workbench');
  assert.doesNotMatch(workbench.text, /href="\/development\/topics"/);
});

test('P4 topic entry requires login and validates creation without an opportunity', async () => {
  const writes = [];
  const repository = {
    async createTopic(input) {
      writes.push(input);
      return { id: 12, topicNo: 'NPD-12', ...input };
    }
  };
  const { app, agent } = await makeAgent(repository);
  assert.equal((await request(app).get('/development/topics')).status, 302);
  assert.equal((await request(app).post('/development/topics').send({
    title: 'Idea', sourceType: 'customer_idea', directions: []
  })).status, 401);

  const form = await agent.get('/development/topics/new');
  assert.equal(form.status, 200);
  assert.match(form.text, /New development topic/);
  assert.doesNotMatch(form.text, /A topic does not require an opportunity/);
  assert.match(form.text, /name="directions"/);
  assert.match(form.text, /href="\/development\/topics"/);

  const invalid = await agent.post('/development/topics').send({
    title: '', sourceType: 'customer_idea', directions: []
  });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.fields, ['title']);
  assert.equal(writes.length, 0);

  const created = await agent.post('/development/topics').send({
    title: '  Plug screw feeder  ', sourceType: 'customer_idea',
    problemStatement: 'Explore a new process',
    directions: ['key_equipment', 'process_technology', 'key_equipment']
  });
  assert.equal(created.status, 201);
  assert.equal(writes[0].actorUserId, 901);
  assert.equal(writes[0].opportunityId, undefined);
  assert.deepEqual(writes[0].directions, ['key_equipment', 'process_technology']);
});

test('P4 list and detail render only repository-scoped records and escape topic text', async () => {
  const calls = [];
  const topic = {
    id: 12, topicNo: 'NPD-12', title: '<script>alert(1)</script>',
    sourceType: 'customer_idea', problemStatement: 'New idea', phase: 'idea',
    result: null, ownerUserId: 901, ownerName: 'NPD User', rowVersion: 1,
    directions: ['key_equipment'], updatedAt: new Date()
  };
  const repository = {
    async listVisibleTopics(input) {
      calls.push(input);
      return { topics: [topic], total: 1 };
    },
    async findVisibleTopicById(input) {
      calls.push(input);
      return Number(input.topicId) === 12 ? topic : null;
    },
    async listVisibleCurrentMembers(input) {
      calls.push(input);
      return [
        { userId: 901, displayName: 'NPD User', username: 'npd_p4_user' },
        { userId: 902, displayName: 'Colleague', username: 'colleague' }
      ];
    },
    async listInviteCandidates(input) { calls.push(input); return []; },
    async listVisibleDiscussion(input) {
      calls.push(input);
      return { comments: [{
        id: 5, authorUserId: 901, authorName: 'NPD User',
        body: '<script>alert(2)</script>', createdAt: new Date('2026-09-27T00:00:00Z')
      }], hasMore: false };
    }
  };
  const { agent } = await makeAgent(repository);
  const list = await agent.get('/development/topics');
  assert.equal(list.status, 200);
  assert.match(list.text, /NPD-12/);
  assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(list.text, /<script>alert\(1\)<\/script>/);
  assert.equal(calls[0].actorUserId, 901);

  const detail = await agent.get('/development/topics/12');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Open memberships/);
  assert.match(detail.text, /End membership/);
  assert.match(detail.text, /Team discussion/);
  for (const zone of ['Foundation research', 'Development and validation',
    'Collaboration and decisions', 'Outcomes and versions', 'Business links']) {
    assert.match(detail.text, new RegExp(zone));
  }
  assert.match(detail.text, /href="#foundation"/);
  assert.match(detail.text, /href="#business"/);
  assert.match(detail.text, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.doesNotMatch(detail.text, /<script>alert\(2\)<\/script>/);
  assert.doesNotMatch(detail.text, /href="\/development\/topics\/12\/materials"/);
  assert.equal(calls[1].actorUserId, 901);
  assert.equal((await agent.get('/development/topics/999')).status, 404);
});

test('P4 topic detail shows only the scoped current concept gate and escapes its decision', async () => {
  const conceptCalls = [];
  const topic = {
    id: 12, topicNo: 'NPD-12', title: 'Concept review',
    sourceType: 'customer_idea', problemStatement: 'Test direction', phase: 'concept_review',
    result: null, ownerUserId: 901, ownerName: 'NPD User', rowVersion: 3,
    directions: ['key_equipment'], updatedAt: new Date()
  };
  const repository = {
    async findVisibleTopicById({ topicId }) { return topicId === 12 ? topic : null; },
    async listVisibleCurrentMembers() { return [{
      userId: 901, displayName: 'NPD User', username: 'npd_p4_user'
    }]; },
    async listInviteCandidates() { return []; },
    async listVisibleDiscussion() { return { comments: [], hasMore: false }; }
  };
  const conceptRepository = {
    async getConceptGate(input) {
      conceptCalls.push(input);
      return {
        currentRevisionId: 27, currentRevisionNo: 2,
        decisionCode: 'approved', decisionReason: '<script>private</script>',
        eligibleForFormalDesign: true, handoffId: null
      };
    }
  };
  const { agent } = await makeAgent(repository, { conceptRepository });
  const detail = await agent.get('/development/topics/12');
  assert.equal(detail.status, 200);
  assert.deepEqual(conceptCalls, [{ topicId: 12, actorUserId: 901 }]);
  assert.match(detail.text, /Concept approved/);
  assert.match(detail.text, /Current revision 2/);
  assert.match(detail.text, /href="\/development\/topics\/12\/concepts\/27\/preview"/);
  assert.match(detail.text, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(detail.text, /<script>private<\/script>/);
  assert.match(detail.text, /handoff can be requested/);

  assert.equal((await agent.get('/development/topics/999')).status, 404);
  assert.equal(conceptCalls.length, 1);
});

test('P4 discussion validates input and passes current member identity to scoped storage', async () => {
  const writes = [];
  const repository = {
    async appendVisibleDiscussion(input) {
      writes.push(input);
      return { id: 19, ...input };
    }
  };
  const { agent } = await makeAgent(repository);
  const invalid = await agent.post('/development/topics/12/discussion')
    .send({ body: '   ' });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.fields, ['body']);
  const oversized = await agent.post('/development/topics/12/discussion')
    .send({ body: 'x'.repeat(4001) });
  assert.equal(oversized.status, 422);
  assert.equal(writes.length, 0);
  const posted = await agent.post('/development/topics/12/discussion')
    .send({ body: '  Test an alternative route  ' });
  assert.equal(posted.status, 201);
  assert.deepEqual(writes, [{
    topicId: 12, actorUserId: 901, body: 'Test an alternative route'
  }]);
});

test('P4 membership endpoints keep the actor and topic identity at the repository boundary', async () => {
  const writes = [];
  const repository = {
    async addVisibleMember(input) { writes.push(['add', input]); return input; },
    async endVisibleMember(input) { writes.push(['end', input]); return input; }
  };
  const { agent } = await makeAgent(repository);
  const bad = await agent.post('/development/topics/12/members').send({ userId: 'invalid' });
  assert.equal(bad.status, 422);
  assert.equal(writes.length, 0);
  assert.equal((await agent.post('/development/topics/12/members').send({ userId: 9 })).status, 201);
  assert.equal((await agent.post('/development/topics/12/members/9/end').send({})).status, 200);
  assert.deepEqual(writes, [
    ['add', { topicId: 12, userId: 9, actorUserId: 901 }],
    ['end', { topicId: 12, userId: 9, actorUserId: 901 }]
  ]);
});

test('P4 direct member access denial is not turned into a visible record', async () => {
  const repository = {
    async findVisibleTopicById() { return null; },
    async addVisibleMember() { throw new DevelopmentTopicError('Development topic not found', 404); },
    async appendVisibleDiscussion() {
      throw new DevelopmentTopicError('Development topic not found', 404);
    }
  };
  const { agent } = await makeAgent(repository);
  assert.equal((await agent.get('/development/topics/71')).status, 404);
  assert.equal((await agent.post('/development/topics/71/members').send({ userId: 9 })).status, 404);
  assert.equal((await agent.post('/development/topics/71/discussion')
    .send({ body: 'private' })).status, 404);
});
