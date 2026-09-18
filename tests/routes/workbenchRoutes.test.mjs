import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createWorkbenchAgent(options = {}) {
  const estimationUpdates = [];
  const user = {
    id: 7,
    username: options.username || 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: options.displayName || 'Sales One',
    isActive: true,
    roles: options.roles || [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === user.id ? user : null;
      },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      }
    },
    workbenchRepository: {
      async listOpenWorkItems() {
        return [{
          id: 1,
          opportunityId: 30,
          opportunityNo: 'OPP-001',
          opportunityTitle: 'Factory upgrade',
          customerName: 'Acme Co',
          title: 'Approve opportunity initiation',
          status: 'pending',
          plannedStartAt: '2026-06-05T10:00:00.000Z',
          dueAt: '2026-06-06T10:00:00.000Z',
          estimatedHours: 6.5,
          workloadLevel: 'high',
          estimateUrl: '/workbench/work-items/1/estimate',
          kpiCode: 'approve_on_time',
          createdAt: '2026-06-05T10:00:00.000Z'
        }];
      },
      async listOpportunityInitiationTodos() {
        return [{
          id: 'opportunity-initiation-32',
          opportunityId: 32,
          opportunityNo: '800003',
          opportunityTitle: 'Draft package',
          customerName: 'Gamma LLC',
          title: 'Submit opportunity initiation',
          status: 'pending',
          plannedStartAt: '2026-06-05T09:30:00.000Z',
          dueAt: null,
          kpiCode: 'submit_opportunity_initiation',
          createdAt: '2026-06-05T09:30:00.000Z'
        }];
      },
      async listProjectExecutionConfirmationItems() {
        return [];
      },
      async listCreatedOpportunities() {
        throw new Error('created opportunities should not be queried for workbench');
      },
      async listAssignedOpportunities() {
        throw new Error('assigned opportunities should not be queried for workbench');
      },
      async listRecentWorkflowMessages() {
        throw new Error('recent status messages should not be queried for the workbench');
      },
      async countByWorkflowState() {
        return [
          { status: STATUSES.DRAFT, count: 2 },
          { status: STATUSES.INITIATION_PENDING, count: 1 }
        ];
      },
      async findWorkItemById(id) {
        if (options.workItemMissing) return null;
        return {
          id: Number(id),
          opportunityId: 30,
          opportunityNo: 'OPP-001',
          opportunityTitle: 'Factory upgrade',
          assigneeUserId: options.workItemAssigneeId ?? user.id,
          title: 'Approve opportunity initiation',
          status: options.workItemStatus || 'pending',
          estimatedHours: 6.5,
          workloadLevel: 'high'
        };
      },
      async updateWorkItemEstimation(id, input) {
        estimationUpdates.push({ id, input });
        return true;
      }
    }
  });
  const agent = request.agent(app);
  if (options.language) {
    await agent.get(`/language?lang=${options.language}&returnTo=/login`);
  }
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  agent.estimationUpdates = estimationUpdates;
  return agent;
}

test('anonymous users are redirected from workbench', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/workbench');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('logged in users see compact workbench list layout', async () => {
  const agent = await createWorkbenchAgent();

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /Workbench/);
  assert.doesNotMatch(response.text, /class="user-line"/);
  assert.doesNotMatch(response.text, /Sales One - salesperson/);
  const topbarHtml = response.text.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] || '';
  assert.doesNotMatch(topbarHtml, /New opportunity/);
  assert.doesNotMatch(topbarHtml, /href="\/opportunities\/new"/);
  assert.match(response.text, /Needs My Action/);
  assert.match(response.text, /class="workbench-list workbench-columns"/);
  assert.match(response.text, /class="list-section workbench-column workbench-column--action"/);
  assert.match(response.text, /class="list-section workbench-column workbench-column--plan"/);
  assert.match(response.text, /\.workbench-list\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(response.text, /\.workbench-column--action\s*\{[\s\S]*--workbench-accent:\s*#b42318;/);
  assert.match(response.text, /\.workbench-column--action\s*\{[\s\S]*--workbench-heading-bg:\s*#fff1f0;/);
  assert.match(response.text, /\.workbench-column--plan\s*\{[\s\S]*--workbench-accent:\s*#245b8a;/);
  assert.match(response.text, /\.workbench-column--plan\s*\{[\s\S]*--workbench-heading-bg:\s*#eef6ff;/);
  assert.match(response.text, /\.state-item\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.match(response.text, /\.state-item:nth-child\(5n \+ 3\)\s*\{[\s\S]*background:\s*#f5f3ff;/);
  assert.match(response.text, /\.workbench-table th\s*\{[\s\S]*background:\s*#eaf2f8;/);
  assert.match(response.text, /class="workbench-table workbench-table--tasks"/);
  assert.match(response.text, /@media \(max-width: 760px\)[\s\S]*\.workbench-table td\[data-label\]::before/);
  assert.match(response.text, /\.workbench-table td\[data-label\]::before\s*\{[\s\S]*background:\s*#eef4f8;[\s\S]*border-left:\s*3px solid var\(--workbench-accent\);/);
  assert.doesNotMatch(response.text, /Opportunities I created/);
  assert.doesNotMatch(response.text, /Opportunities assigned to me/);
  assert.doesNotMatch(response.text, /<th>Opportunity Name<\/th>/);
  assert.doesNotMatch(response.text, /<th>Title<\/th>/);
  assert.match(response.text, /Work Plan/);
  assert.doesNotMatch(response.text, /Recent Status Messages/);
  assert.match(response.text, /Counts by workflow state/);
  assert.match(response.text, /Approve opportunity initiation/);
  assert.match(response.text, /Submit opportunity initiation/);
  assert.match(response.text, /<th scope="col">Related Opportunity<\/th>/);
  assert.match(response.text, /<th scope="col">Specific Work<\/th>/);
  assert.match(response.text, /<th scope="col">Planned Start<\/th>/);
  assert.match(response.text, /<th scope="col">Deadline<\/th>/);
  assert.match(response.text, /<th scope="col">Estimated Hours \/ Workload<\/th>/);
  assert.match(response.text, /6\.5 h · High/);
  assert.match(response.text, /href="\/workbench\/work-items\/1\/estimate"/);
  assert.match(response.text, /<th scope="col">KPI \/ Completion Standard<\/th>/);
  assert.match(response.text, /Approve or give a clear rejection decision by the deadline/);
  assert.match(response.text, /href="\/opportunities\/32"[^>]*>[\s\S]*800003[\s\S]*Draft package/);
  assert.match(response.text, /Factory upgrade/);
  assert.match(response.text, /Draft/);
  assert.match(response.text, /left-nav/);
  assert.doesNotMatch(response.text, /href="\/inquiries"/);
  assert.doesNotMatch(response.text, /class="nav-parent">System/);
  assert.doesNotMatch(response.text, /href="\/system\/users"/);
  assert.doesNotMatch(response.text, /href="\/system\/roles"/);
  assert.doesNotMatch(response.text, /href="\/system\/approval-settings"/);
  assert.match(response.text, /class="state-strip"/);
  assert.match(response.text, /class="workbench-list workbench-columns"/);
  assert.doesNotMatch(response.text, /class="workbench-card-list"/);
  assert.doesNotMatch(response.text, /class="panel-grid"/);
});

test('assigned users can view and update their work estimate', async () => {
  const agent = await createWorkbenchAgent();

  const formResponse = await agent.get('/workbench/work-items/1/estimate');

  assert.equal(formResponse.status, 200);
  assert.match(formResponse.text, /Workload estimate/);
  assert.match(formResponse.text, /name="estimatedHours"[^>]*value="6\.5"/);
  assert.match(formResponse.text, /option value="high" selected/);

  const updateResponse = await agent
    .post('/workbench/work-items/1/estimate')
    .type('form')
    .send({ estimatedHours: '8.25', workloadLevel: 'medium' });

  assert.equal(updateResponse.status, 302);
  assert.equal(updateResponse.headers.location, '/workbench');
  assert.deepEqual(agent.estimationUpdates, [{
    id: 1,
    input: {
      estimatedHours: 8.25,
      workloadLevel: 'medium',
      actorUserId: 7
    }
  }]);
});

test('work estimate route rejects unauthorized and invalid changes', async () => {
  const unauthorizedAgent = await createWorkbenchAgent({ workItemAssigneeId: 99 });
  const forbiddenResponse = await unauthorizedAgent.get('/workbench/work-items/1/estimate');
  assert.equal(forbiddenResponse.status, 403);

  const assignedAgent = await createWorkbenchAgent();
  const invalidResponse = await assignedAgent
    .post('/workbench/work-items/1/estimate')
    .type('form')
    .send({ estimatedHours: '1.234', workloadLevel: 'medium' });
  assert.equal(invalidResponse.status, 400);
  assert.match(invalidResponse.text, /positive number with at most two decimals/);
  assert.deepEqual(assignedAgent.estimationUpdates, []);
});

test('sales managers see inquiry navigation', async () => {
  const agent = await createWorkbenchAgent({
    username: 'salesmanager01',
    displayName: 'Sales Manager',
    roles: [ROLES.SALES_MANAGER]
  });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /href="\/inquiries"/);
});

test('non-sales users do not see inquiry navigation', async () => {
  const agent = await createWorkbenchAgent({
    username: 'qe01',
    displayName: 'Quotation Engineer',
    roles: [ROLES.QUOTATION_ENGINEER]
  });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.doesNotMatch(response.text, /href="\/inquiries"/);
});

test('workbench framework text uses selected Chinese language', async () => {
  const agent = await createWorkbenchAgent({ language: 'zh' });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /<h1>\u5de5\u4f5c\u53f0<\/h1>/);
  assert.match(response.text, /\u6d41\u7a0b\u7edf\u8ba1/);
  assert.match(response.text, /\u9700\u8981\u6211\u5904\u7406/);
  assert.match(response.text, /\u5de5\u4f5c\u8ba1\u5212/);
  assert.doesNotMatch(response.text, /\u6700\u8fd1\u72b6\u6001\u6d88\u606f/);
  assert.match(response.text, /<th scope="col">\u5173\u8054\u5546\u673a<\/th>/);
  assert.match(response.text, /<th scope="col">\u5de5\u4f5c\u5185\u5bb9<\/th>/);
  assert.match(response.text, /<th scope="col">\u5f00\u59cb\u65f6\u95f4<\/th>/);
  assert.match(response.text, /<th scope="col">\u622a\u6b62\u65f6\u95f4<\/th>/);
  assert.match(response.text, /\u5de5\u65f6\uff0f\u5de5\u4f5c\u91cf/);
  assert.match(response.text, /6\.5 \u5c0f\u65f6 · \u9ad8/);
  assert.match(response.text, /\u5b8c\u6210\u6807\u51c6/);
  assert.match(response.text, /\u6309\u65f6\u5ba1\u6279\u6216\u660e\u786e\u9a73\u56de/);
  assert.match(response.text, /\u5ba1\u6279\u5546\u673a\u7acb\u9879/);
  assert.match(response.text, /\u63d0\u4ea4\u5546\u673a\u7acb\u9879/);
  assert.doesNotMatch(response.text, /Approve opportunity initiation/);
  assert.doesNotMatch(response.text, /Submit opportunity initiation/);
  const stateStripHtml = response.text.match(/<div class="state-strip">[\s\S]*?<\/div>\s*<\/section>/)?.[0] || '';
  assert.match(stateStripHtml, /\u8349\u7a3f/);
  assert.match(stateStripHtml, /\u7acb\u9879\u5ba1\u6279\u4e2d/);
});

test('administrator users see system navigation in the left sidebar', async () => {
  const agent = await createWorkbenchAgent({
    username: 'admin01',
    displayName: 'System Administrator',
    roles: [ROLES.ADMINISTRATOR]
  });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /left-nav/);
  assert.match(response.text, /class="nav-parent">System/);
  assert.match(response.text, /class="nav-subgroup"/);
  assert.match(response.text, /href="\/system\/users"/);
  assert.match(response.text, /Users/);
  assert.match(response.text, /href="\/system\/roles"/);
  assert.match(response.text, /Roles/);
  assert.match(response.text, /href="\/system\/approval-settings"/);
  assert.match(response.text, /Approval Settings/);
  assert.match(response.text, /href="\/inquiries"/);
  const mainNavigation = response.text.match(/<nav class="nav-group">[\s\S]*?<\/nav>/)?.[0] || '';
  const navigationFooter = response.text.match(/<div class="nav-footer">[\s\S]*?<\/aside>/)?.[0] || '';
  assert.doesNotMatch(mainNavigation, /href="\/account\/password"/);
  assert.match(navigationFooter, /href="\/account\/password">Change password<\/a>/);
  assert.match(navigationFooter, /action="\/logout"/);
});

test('left sidebar uses selected Chinese language after login', async () => {
  const agent = await createWorkbenchAgent({
    username: 'admin01',
    displayName: 'System Administrator',
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh'
  });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /href="\/workbench">\s*<span>工作台<\/span>/);
  assert.doesNotMatch(response.text, /href="\/sales-work\/plans">工作<\/a>/);
  assert.doesNotMatch(response.text, /href="\/notifications">通知<\/a>/);
  assert.match(response.text, /href="\/opportunities">商机<\/a>/);
  assert.match(response.text, /href="\/customers">客户<\/a>/);
  assert.match(response.text, /href="\/contacts">联系人<\/a>/);
  assert.match(response.text, /class="nav-parent">系统<\/div>/);
  assert.match(response.text, /href="\/system\/users">用户<\/a>/);
  assert.match(response.text, /href="\/system\/roles">角色<\/a>/);
  assert.match(response.text, /href="\/system\/approval-settings">审批人<\/a>/);
  assert.match(response.text, />退出登录<\/button>/);
});

test('salesperson sidebar uses concise Chinese lead and work labels', async () => {
  const agent = await createWorkbenchAgent({
    username: 'sales01',
    displayName: 'Sales One',
    roles: [ROLES.SALESPERSON],
    language: 'zh'
  });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /href="\/lead-submissions">线索<\/a>/);
  assert.doesNotMatch(response.text, /href="\/sales-work\/plans">工作<\/a>/);
  assert.match(response.text, /href="\/sales-work\/plans">管理工作计划<\/a>/);
  assert.doesNotMatch(response.text, /href="\/lead-submissions">我提交的线索<\/a>/);
  assert.doesNotMatch(response.text, /href="\/sales-work\/plans">工作管理<\/a>/);
});
