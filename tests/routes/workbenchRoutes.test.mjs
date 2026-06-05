import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createWorkbenchAgent() {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
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
      async listCreatedOpportunities() {
        return [{
          id: 30,
          opportunityNo: 'OPP-001',
          title: 'Factory upgrade',
          customerName: 'Acme Co',
          status: STATUSES.DRAFT,
          estimatedAmount: 120000,
          updatedAt: '2026-06-05T09:00:00.000Z'
        }];
      },
      async listAssignedOpportunities() {
        return [{
          id: 31,
          opportunityNo: 'OPP-002',
          title: 'Quotation package',
          customerName: 'Beta Ltd',
          status: STATUSES.COMMERCIAL_QUOTE_PENDING,
          estimatedAmount: 88000,
          updatedAt: '2026-06-05T08:00:00.000Z'
        }];
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
  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
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
  assert.match(response.text, /My pending todos/);
  assert.match(response.text, /Opportunities I created/);
  assert.match(response.text, /Opportunities assigned to me/);
  assert.match(response.text, /Recent workflow messages/);
  assert.match(response.text, /Counts by workflow state/);
  assert.match(response.text, /Approve opportunity initiation/);
  assert.match(response.text, /Factory upgrade/);
  assert.match(response.text, /Quotation package/);
  assert.match(response.text, /submit_initiation/);
  assert.match(response.text, /draft/);
  assert.match(response.text, /left-nav/);
  assert.match(response.text, /System/);
  assert.match(response.text, /href="\/system\/users"/);
  assert.match(response.text, /Users/);
  assert.match(response.text, /href="\/system\/roles"/);
  assert.match(response.text, /Roles/);
  assert.match(response.text, /href="\/system\/approval-settings"/);
  assert.match(response.text, /Approval Settings/);
  assert.match(response.text, /class="state-strip"/);
  assert.match(response.text, /class="workbench-list"/);
  assert.match(response.text, /class="list-section"/);
  assert.doesNotMatch(response.text, /class="panel-grid"/);
});
