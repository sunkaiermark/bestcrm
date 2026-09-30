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
  const overview = await request(app).get('/workbench/actions');
  assert.equal(overview.status, 302);
  assert.equal(overview.headers.location, '/login');
});

test('workbench has sticky top links to action and plan overviews', async () => {
  const agent = await createWorkbenchAgent();

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /Workbench/);
  assert.doesNotMatch(response.text, /class="user-line"/);
  assert.doesNotMatch(response.text, /Sales One - salesperson/);
  const topbarHtml = response.text.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] || '';
  assert.doesNotMatch(topbarHtml, /New opportunity/);
  assert.doesNotMatch(topbarHtml, /href="\/opportunities\/new"/);
  assert.match(response.text, /<nav class="workbench-shortcuts" aria-label="Workbench">/);
  assert.match(response.text, /Pending Work Items/);
  assert.match(response.text, /class="workbench-shortcut workbench-shortcut--action" href="\/workbench\/actions"/);
  assert.match(response.text, /class="workbench-shortcut workbench-shortcut--plan" href="\/sales-work\/plans"/);
  assert.match(response.text, /\.workbench-shortcuts\s*\{[^}]*position:\s*sticky;/);
  assert.match(response.text, /\.workbench-shortcuts\s*\{[^}]*top:\s*0;/);
  assert.match(response.text, /\.state-item\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.match(response.text, /\.state-item:nth-child\(5n \+ 3\)\s*\{[\s\S]*background:\s*#f5f3ff;/);
  assert.doesNotMatch(response.text, /class="workbench-table workbench-table--tasks"/);
  assert.doesNotMatch(response.text, /Opportunities I created/);
  assert.doesNotMatch(response.text, /Opportunities assigned to me/);
  assert.match(response.text, /Work Plan/);
  assert.doesNotMatch(response.text, /Recent Status Messages/);
  assert.match(response.text, /Counts by workflow state/);
  assert.match(response.text, /left-nav/);
  assert.doesNotMatch(response.text, /href="\/inquiries"/);
  assert.doesNotMatch(response.text, /class="nav-parent">System/);
  assert.doesNotMatch(response.text, /href="\/system\/users"/);
  assert.doesNotMatch(response.text, /href="\/system\/roles"/);
  assert.doesNotMatch(response.text, /href="\/system\/approval-settings"/);
  assert.match(response.text, /class="state-strip"/);
});

test('action overview links to permitted work item detail and business detail', async () => {
  const agent = await createWorkbenchAgent();
  const overview = await agent.get('/workbench/actions');

  assert.equal(overview.status, 200);
  assert.match(overview.text, /Approve opportunity initiation/);
  assert.match(overview.text, /Submit opportunity initiation/);
  assert.match(overview.text, /href="\/workbench\/work-items\/1"/);
  assert.match(overview.text, /href="\/opportunities\/32"/);
  assert.match(overview.text, /Factory upgrade/);
  assert.match(overview.text, /Planned Start/);
  assert.match(overview.text, /Deadline/);

  const detail = await agent.get('/workbench/work-items/1');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Approve opportunity initiation/);
  assert.match(detail.text, /href="\/workbench\/actions"/);
  assert.match(detail.text, /href="\/workbench\/work-items\/1\/estimate"/);
  assert.match(detail.text, /href="\/opportunities\/30"/);
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
  assert.equal(updateResponse.headers.location, '/workbench/work-items/1');
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
  const forbiddenDetail = await unauthorizedAgent.get('/workbench/work-items/1');
  assert.equal(forbiddenDetail.status, 403);

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
  assert.doesNotMatch(response.text, /class="workbench-shortcut workbench-shortcut--plan"/);
});

test('workbench framework text uses selected Chinese language', async () => {
  const agent = await createWorkbenchAgent({ language: 'zh' });

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /<h1>\u5de5\u4f5c\u53f0<\/h1>/);
  assert.match(response.text, /\u6d41\u7a0b\u7edf\u8ba1/);
  assert.match(response.text, /\u5f85\u5b8c\u6210\u5de5\u5355/);
  assert.match(response.text, /\u5de5\u4f5c\u8ba1\u5212/);
  assert.match(response.text, /href="\/workbench\/actions"/);
  assert.doesNotMatch(response.text, /\u6700\u8fd1\u72b6\u6001\u6d88\u606f/);
  const overview = await agent.get('/workbench/actions');
  assert.equal(overview.status, 200);
  assert.match(overview.text, /\u5ba1\u6279\u5546\u673a\u7acb\u9879/);
  assert.match(overview.text, /\u63d0\u4ea4\u5546\u673a\u7acb\u9879/);
  assert.match(overview.text, /\u5f00\u59cb\u65f6\u95f4/);
  assert.match(overview.text, /\u622a\u6b62\u65f6\u95f4/);
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
  assert.match(response.text, /href="\/system\/approval-settings">[^\n]*<span>Approvals<\/span><\/a>/);
  assert.match(response.text, /href="\/inquiries"/);
  const mainNavigation = response.text.match(/<nav class="nav-group">[\s\S]*?<\/nav>/)?.[0] || '';
  const navigationFooter = response.text.match(/<div class="nav-footer">[\s\S]*?<\/aside>/)?.[0] || '';
  assert.doesNotMatch(mainNavigation, /href="\/account\/password"/);
  assert.match(navigationFooter, /href="\/account\/password">[^\n]*<span>Password<\/span><\/a>/);
  assert.match(navigationFooter, /<span>Sign Out<\/span><\/button>/);
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
  assert.match(response.text, /href="\/workbench">[\s\S]*?<span>我的工作<\/span>/);
  assert.doesNotMatch(response.text, /href="\/sales-work\/plans">工作<\/a>/);
  assert.doesNotMatch(response.text, /href="\/notifications">通知<\/a>/);
  assert.match(response.text, /href="\/opportunities">[^\n]*<span>销售商机<\/span><\/a>/);
  assert.match(response.text, /href="\/customers">[^\n]*<span>客户档案<\/span><\/a>/);
  assert.match(response.text, /href="\/contacts">[^\n]*<span>联系名录<\/span><\/a>/);
  assert.match(response.text, /class="nav-parent">系统设置<\/div>/);
  assert.match(response.text, /href="\/system\/users">[^\n]*<span>用户管理<\/span><\/a>/);
  assert.match(response.text, /href="\/system\/roles">[^\n]*<span>角色管理<\/span><\/a>/);
  assert.match(response.text, /href="\/system\/approval-settings">[^\n]*<span>审批设置<\/span><\/a>/);
  assert.match(response.text, /<span>退出登录<\/span><\/button>/);
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
  assert.match(response.text, /href="\/lead-submissions">[^\n]*<span>销售线索<\/span><\/a>/);
  assert.doesNotMatch(response.text, /href="\/sales-work\/plans">工作<\/a>/);
  assert.match(response.text, /class="workbench-shortcut workbench-shortcut--plan" href="\/sales-work\/plans">/);
  assert.doesNotMatch(response.text, /href="\/lead-submissions">我提交的线索<\/a>/);
  assert.doesNotMatch(response.text, /href="\/sales-work\/plans">工作管理<\/a>/);
});
