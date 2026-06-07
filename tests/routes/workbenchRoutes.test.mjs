import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createWorkbenchAgent(options = {}) {
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
      async listPendingTodos() {
        return [{
          id: 1,
          opportunityId: 30,
          opportunityNo: 'OPP-001',
          opportunityTitle: 'Factory upgrade',
          customerName: 'Acme Co',
          title: 'Approve opportunity initiation',
          status: 'pending',
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
          createdAt: '2026-06-05T09:30:00.000Z'
        }];
      },
      async listCreatedOpportunities() {
        throw new Error('created opportunities should not be queried for workbench');
      },
      async listAssignedOpportunities() {
        throw new Error('assigned opportunities should not be queried for workbench');
      },
      async listRecentWorkflowMessages() {
        return [{
          id: 90,
          opportunityId: 30,
          opportunityNo: 'OPP-001',
          opportunityTitle: 'Factory upgrade',
          eventType: 'submit_initiation',
          fromStatus: STATUSES.DRAFT,
          toStatus: STATUSES.INITIATION_PENDING,
          actorDisplayName: 'Sales One',
          targetDisplayName: 'Sales Manager',
          comment: 'ready for review',
          createdAt: '2026-06-05T11:00:00.000Z'
        }];
      },
      async countByWorkflowState() {
        return [
          { status: STATUSES.DRAFT, count: 2 },
          { status: STATUSES.INITIATION_PENDING, count: 1 }
        ];
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return agent;
}

test('anonymous users are redirected from workbench', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const response = await request(app).get('/workbench');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('logged in users see compact workbench list layout', async () => {
  const agent = await createWorkbenchAgent();

  const response = await agent.get('/workbench');

  assert.equal(response.status, 200);
  assert.match(response.text, /Workbench/);
  const topbarHtml = response.text.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] || '';
  assert.doesNotMatch(topbarHtml, /New opportunity/);
  assert.doesNotMatch(topbarHtml, /href="\/opportunities\/new"/);
  assert.match(response.text, /My pending todos/);
  assert.match(response.text, /<h2 class="todo-alert-heading">My pending todos<\/h2>/);
  assert.match(response.text, /\.todo-alert-heading\s*\{[\s\S]*background:\s*#fee2e2;[\s\S]*color:\s*#991b1b;/);
  assert.doesNotMatch(response.text, /Opportunities I created/);
  assert.doesNotMatch(response.text, /Opportunities assigned to me/);
  assert.doesNotMatch(response.text, /<th>Opportunity Name<\/th>/);
  assert.doesNotMatch(response.text, /<th>Title<\/th>/);
  assert.match(response.text, /Recent workflow messages/);
  assert.match(response.text, /Counts by workflow state/);
  assert.match(response.text, /Approve opportunity initiation/);
  assert.match(response.text, /Submit opportunity initiation/);
  assert.match(response.text, /href="\/opportunities\/32">800003 - Draft package/);
  assert.match(response.text, /Factory upgrade/);
  assert.match(response.text, /submit_initiation/);
  assert.match(response.text, /draft/);
  assert.match(response.text, /left-nav/);
  assert.doesNotMatch(response.text, /class="nav-parent">System/);
  assert.doesNotMatch(response.text, /href="\/system\/users"/);
  assert.doesNotMatch(response.text, /href="\/system\/roles"/);
  assert.doesNotMatch(response.text, /href="\/system\/approval-settings"/);
  assert.match(response.text, /class="state-strip"/);
  assert.match(response.text, /class="workbench-list"/);
  assert.match(response.text, /class="list-section"/);
  assert.doesNotMatch(response.text, /class="panel-grid"/);
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
});
