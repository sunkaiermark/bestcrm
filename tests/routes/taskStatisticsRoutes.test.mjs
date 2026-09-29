import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

async function agentFor(roles, taskStatisticsRepository) {
  const user = { id: 7, username: 'stats_test', displayName: 'Stats Tester',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles };
  const app = createApp({ databaseUrl: '', sessionSecret: 'stats-test',
    csrfProtection: false, taskStatisticsRepository,
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

test('non-admin sees no task statistics entry and direct page/data requests return 403', async () => {
  const calls = [];
  const repository = {
    async getReport() { calls.push('report'); return { summary: {}, rows: [] }; },
    async listUsers() { calls.push('users'); return []; }
  };
  const { agent } = await agentFor([ROLES.SALESPERSON], repository);
  const analytics = await agent.get('/analytics');
  assert.equal(analytics.status, 200);
  assert.doesNotMatch(analytics.text, /href="\/analytics\/tasks"/);
  assert.equal((await agent.get('/analytics/tasks')).status, 403);
  assert.equal((await agent.get('/analytics/tasks/data')).status, 403);
  assert.deepEqual(calls, []);
  assert.equal((await agent.get('/workbench')).status, 200);
});

test('anonymous requests cannot read either task statistics surface', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'stats-anonymous',
    taskStatisticsRepository: { async getReport() { throw Error('must not run'); } } });
  for (const path of ['/analytics/tasks', '/analytics/tasks/data']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/login');
  }
});

test('admin can filter the page and data API, with escaped task content', async () => {
  const calls = [];
  const repository = {
    async listUsers() { calls.push('users'); return [{ id: 7, name: 'Stats Tester', isActive: true }]; },
    async getReport(filters) {
      calls.push(filters);
      return { summary: { total: 1, completed: 0, cancelled: 0, subprojects: 1,
        unassigned: 0 }, rows: [{ sourceType: 'development_subproject', sourceId: 9,
        userId: 7, userName: 'Stats Tester', userIsActive: true,
        projectNo: 'RDP-9', projectName: '<script>Mixer</script>',
        taskTitle: 'Seal experiment', taskSummary: '<b>Thermal trial</b>',
        plannedStart: '2026-10-01',
        plannedEnd: '2026-10-20', actualCompleted: null, status: 'planned',
        opportunityId: null }] };
    }
  };
  const { agent } = await agentFor([ROLES.ADMINISTRATOR], repository);
  const analytics = await agent.get('/analytics');
  assert.match(analytics.text, /href="\/analytics\/tasks"/);
  const page = await agent.get('/analytics/tasks?period=quarter&startYear=2026&startUnit=4&endYear=2027&endUnit=2&userId=7');
  assert.equal(page.status, 200);
  assert.match(page.headers['cache-control'], /no-store/);
  assert.match(page.text, /Seal experiment/);
  assert.match(page.text, /&lt;script&gt;Mixer&lt;\/script&gt;/);
  assert.match(page.text, /&lt;b&gt;Thermal trial&lt;\/b&gt;/);
  assert.doesNotMatch(page.text, /<script>Mixer<\/script>/);
  assert.match(page.text, /Actual completion/);
  assert.match(page.text, /name="startYear"/);
  assert.match(page.text, /name="endYear"/);
  assert.match(page.text, /name="startUnit"/);
  assert.match(page.text, /name="endUnit"/);
  assert.doesNotMatch(page.text, /name="month"/);
  const data = await agent.get('/analytics/tasks/data?period=quarter&startYear=2026&startUnit=4&endYear=2027&endUnit=2&userId=7');
  assert.equal(data.status, 200);
  assert.equal(data.body.rows[0].actualCompleted, null);
  assert.deepEqual(calls[0], { period: 'quarter', startYear: 2026, startUnit: 4,
    endYear: 2027, endUnit: 2, userId: 7, page: 1, pageSize: 50,
    startDate: '2026-10-01', endDate: '2027-07-01' });
  assert.equal((await agent.get('/analytics/tasks?period=week')).status, 400);
  assert.equal(calls.length, 3);
});
