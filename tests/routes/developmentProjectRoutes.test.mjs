import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { DevelopmentProjectError } from '../../src/domain/developmentProjects.mjs';

async function agentFor(repository, { enabled = true } = {}) {
  const user = { id: 940, username: 'npd_project_route', displayName: 'Project user',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true,
    roles: ['salesperson'] };
  const app = createApp({ databaseUrl: '', sessionSecret: 'npd-project-test',
    csrfProtection: false, developmentWorkspace: { enabled },
    developmentProjectRepository: repository,
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

function visiblePlan(ownerUserId = 940) {
  return {
    project: { id: 7, projectNo: 'RDP-7', title: '<script>R&D</script>',
      objective: 'Concept work', plannedStartOn: '2026-09-22',
      plannedEndOn: '2026-10-30', ownerUserId, ownerName: 'Project user',
      rowVersion: 1 },
    items: [
      { id: 11, projectId: 7, itemKind: 'subproject', code: 'SP-01',
        title: 'Explore', summary: 'Seal options', plannedStartOn: '2026-09-22',
        plannedEndOn: '2026-10-05', responsibleUserId: 940,
        responsibleName: 'Project user', responsibleIsActive: true, rowVersion: 1 },
      { id: 12, projectId: 7, itemKind: 'concept_gate', code: 'G-01',
        title: 'Concept approval', plannedStartOn: '2026-10-06',
        plannedEndOn: '2026-10-06', gateApproved: false,
        gateTopicNo: null, rowVersion: 1 }
    ],
    dependencies: [{ id: 1, predecessorItemId: 11, successorItemId: 12,
      relationCode: 'FS', lagCalendarDays: 0 }],
    topicLinks: [], members: [{ userId: 940, displayName: 'Project user', isActive: true }],
    events: []
  };
}

test('NPD project routes are gated and private', async () => {
  const repository = {
    async listVisibleProjects() { return { projects: [], total: 0 }; },
    async getVisiblePlan() { throw new DevelopmentProjectError('Development project not found', 404); }
  };
  const disabled = await agentFor(repository, { enabled: false });
  assert.equal((await disabled.agent.get('/development/projects')).status, 404);
  const { app, agent } = await agentFor(repository);
  assert.equal((await request(app).get('/development/projects')).status, 302);
  assert.equal((await agent.get('/development/projects/7')).status, 404);
  assert.equal((await agent.get('/development/projects/7').set('Accept', 'application/json')).body.error,
    'Development project not found');
});

test('member sees Gantt codes and milestone but cannot edit owner controls', async () => {
  const repository = { async getVisiblePlan() { return visiblePlan(941); } };
  const { agent } = await agentFor(repository);
  const response = await agent.get('/development/projects/7');
  assert.equal(response.status, 200);
  assert.match(response.text, /SP-01 FS\+0d/);
  assert.match(response.text, /G-01/);
  assert.match(response.text, /data-predecessor="11"/);
  assert.match(response.text, /Responsible：Project user/);
  assert.match(response.text, /Seal options/);
  assert.doesNotMatch(response.text, /name="responsibleUserId"/);
  assert.doesNotMatch(response.text, /items\/11\/summary/);
  assert.match(response.text, /&lt;script&gt;R&amp;D&lt;\/script&gt;/);
  assert.doesNotMatch(response.text, /<script>R&D<\/script>/);
  assert.doesNotMatch(response.text, /建立前置依赖/);
});

test('owner can create a project and dependency while invalid inputs never reach storage', async () => {
  const calls = [];
  const repository = {
    async createProject(input) { calls.push(['create', input]); return { id: 7, ...input }; },
    async updateProjectDates(input) { calls.push(['dates', input]); return { id: 7, ...input }; },
    async addDependency(input) { calls.push(['link', input]); return { id: 22 }; }
  };
  const { agent } = await agentFor(repository);
  const invalid = await agent.post('/development/projects').set('Accept', 'application/json').send({
    title: 'Project', plannedStartOn: '2026-10-30', plannedEndOn: '2026-10-01'
  });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 0);
  const created = await agent.post('/development/projects').set('Accept', 'application/json').send({
    title: 'Project', plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-30'
  });
  assert.equal(created.status, 201);
  assert.equal(calls[0][1].actorUserId, 940);
  const invalidDates = await agent.post('/development/projects/7/dates')
    .set('Accept', 'application/json').send({ expectedRowVersion: 1,
      plannedStartOn: '2026-11-01', plannedEndOn: '2026-10-01' });
  assert.equal(invalidDates.status, 422);
  assert.equal(calls.length, 1);
  const updatedDates = await agent.post('/development/projects/7/dates')
    .set('Accept', 'application/json').send({ expectedRowVersion: 1,
      plannedStartOn: '2026-10-01', plannedEndOn: '2026-11-01' });
  assert.equal(updatedDates.status, 201);
  assert.equal(calls[1][1].expectedRowVersion, 1);
  const badDependency = await agent.post('/development/projects/7/dependencies')
    .set('Accept', 'application/json').send({ predecessorItemId: 11,
      successorItemId: 11, relationCode: 'FS' });
  assert.equal(badDependency.status, 422);
  assert.equal(calls.length, 2);
  const linked = await agent.post('/development/projects/7/dependencies')
    .set('Accept', 'application/json').send({ predecessorItemId: 11,
      successorItemId: 12, relationCode: 'SS', lagCalendarDays: -2 });
  assert.equal(linked.status, 201);
  assert.equal(calls[2][1].actorUserId, 940);
  assert.deepEqual(calls[2][1].dependency, { predecessorItemId: 11,
    successorItemId: 12, relationCode: 'SS', lagCalendarDays: -2 });
});

test('owner sees horizontal subproject entry and submits both dependency directions together', async () => {
  const calls = [];
  const repository = {
    async getVisiblePlan() { return visiblePlan(); },
    async listInviteCandidates() { return []; },
    async listLinkableTopics() { return []; },
    async addSubprojectWithDependencies(input) {
      calls.push(input);
      return { id: 13, code: 'SP-02', ...input.item, dependencies: [] };
    }
  };
  const { agent } = await agentFor(repository);
  const page = await agent.get('/development/projects/7');
  assert.equal(page.status, 200);
  assert.match(page.text, /class="plan-subproject-row"/);
  assert.match(page.text, /name="upstreamItemId"/);
  assert.match(page.text, /name="downstreamItemId"/);
  assert.match(page.text, /plan-date-field/);
  assert.match(page.text, /name="responsibleUserId"/);
  assert.match(page.text, /items\/11\/responsible/);
  assert.match(page.text, /name="summary"/);
  assert.match(page.text, /items\/11\/summary/);
  const invalid = await agent.post('/development/projects/7/items')
    .set('Accept', 'application/json').send({ itemKind: 'subproject', title: 'Seal trial',
      plannedStartOn: '2026-10-10', plannedEndOn: '2026-10-15',
      responsibleUserId: 940,
      upstreamItemId: 11, upstreamRelationCode: 'invalid' });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 0);
  const created = await agent.post('/development/projects/7/items')
    .set('Accept', 'application/json').send({ itemKind: 'subproject', title: 'Seal trial',
      summary: '  Validate seals under heat  ',
      plannedStartOn: '2026-10-10', plannedEndOn: '2026-10-15',
      responsibleUserId: 940,
      upstreamItemId: 11, upstreamRelationCode: 'FS', upstreamLagCalendarDays: 0,
      downstreamItemId: 12, downstreamRelationCode: 'FF', downstreamLagCalendarDays: 5 });
  assert.equal(created.status, 201);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].upstream, { itemId: 11, relationCode: 'FS', lagCalendarDays: 0 });
  assert.deepEqual(calls[0].downstream, { itemId: 12, relationCode: 'FF', lagCalendarDays: 5 });
  assert.equal(calls[0].item.responsibleUserId, 940);
  assert.equal(calls[0].item.summary, 'Validate seals under heat');
});

test('subproject responsible change is validated and passed to owner-only storage', async () => {
  const calls = [];
  const repository = {
    async updateItemResponsible(input) { calls.push(input); return { id: input.itemId }; }
  };
  const { agent } = await agentFor(repository);
  const invalid = await agent.post('/development/projects/7/items/11/responsible')
    .set('Accept', 'application/json').send({ responsibleUserId: '', expectedRowVersion: 1 });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 0);
  const changed = await agent.post('/development/projects/7/items/11/responsible')
    .set('Accept', 'application/json').send({ responsibleUserId: 940,
      expectedRowVersion: 1 });
  assert.equal(changed.status, 201);
  assert.deepEqual(calls[0], { projectId: 7, itemId: 11,
    responsibleUserId: 940, expectedRowVersion: 1, actorUserId: 940 });
});

test('subproject summary edit validates input and passes actor to owner-only storage', async () => {
  const calls = [];
  const repository = {
    async updateItemSummary(input) { calls.push(input); return { id: input.itemId }; }
  };
  const { agent } = await agentFor(repository);
  const invalid = await agent.post('/development/projects/7/items/11/summary')
    .set('Accept', 'application/json').send({ summary: 'x'.repeat(2001),
      expectedRowVersion: 1 });
  assert.equal(invalid.status, 422);
  assert.equal(calls.length, 0);
  const changed = await agent.post('/development/projects/7/items/11/summary')
    .set('Accept', 'application/json').send({ summary: '  Trial setup  ',
      expectedRowVersion: 1 });
  assert.equal(changed.status, 201);
  assert.deepEqual(calls[0], { projectId: 7, itemId: 11, summary: 'Trial setup',
    expectedRowVersion: 1, actorUserId: 940 });
});

test('legacy unassigned subprojects remain visible and assigned members cannot be removed in the page', async () => {
  const plan = visiblePlan();
  plan.items[0].responsibleUserId = null;
  plan.items[0].responsibleName = null;
  const repository = {
    async getVisiblePlan() { return plan; },
    async listInviteCandidates() { return []; },
    async listLinkableTopics() { return []; }
  };
  const { agent } = await agentFor(repository);
  const unassigned = await agent.get('/development/projects/7');
  assert.equal(unassigned.status, 200);
  assert.match(unassigned.text, /Responsible：Unassigned/);
  plan.items[0].responsibleUserId = 941;
  plan.items[0].responsibleName = 'Other member';
  plan.members.push({ userId: 941, displayName: 'Other member', isActive: true });
  const assigned = await agent.get('/development/projects/7');
  assert.equal(assigned.status, 200);
  assert.match(assigned.text, /Reassign subprojects first/);
  assert.match(assigned.text, /disabled>Reassign subprojects first/);
});
