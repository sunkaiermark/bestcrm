import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createSystemAgent() {
  const user = {
    id: 7,
    username: 'admin01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Admin User',
    isActive: true,
    roles: [ROLES.ADMINISTRATOR]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === user.id ? user : null;
      },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      },
      async listUsersWithRoles() {
        return [{
          id: 11,
          username: 'sales_manager01',
          displayName: 'Sales Manager',
          email: 'sales.manager01@bestcrm.local',
          phone: '',
          isActive: true,
          roles: [ROLES.SALES_MANAGER]
        }];
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'admin01', password: 'ChangeMe123!' });
  return agent;
}

function assertSystemSidebar(html, activeHref) {
  assert.match(html, /class="left-nav"/);
  assert.match(html, /class="nav-parent">System/);
  assert.match(html, /class="nav-subgroup"/);
  assert.match(html, new RegExp(`href="${activeHref}"`));
  assert.match(html, /action="\/logout"/);
}

test('anonymous users are redirected from system pages', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  for (const path of ['/system/users', '/system/roles', '/system/approval-settings']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/login');
  }
});

test('logged in users can view system user role and approval setting details', async () => {
  const agent = await createSystemAgent();

  const users = await agent.get('/system/users');
  assert.equal(users.status, 200);
  assertSystemSidebar(users.text, '/system/users');
  assert.match(users.text, /System Users/);
  assert.match(users.text, /sales_manager01/);
  assert.match(users.text, /Sales Manager/);
  assert.match(users.text, /sales_manager/);

  const roles = await agent.get('/system/roles');
  assert.equal(roles.status, 200);
  assertSystemSidebar(roles.text, '/system/roles');
  assert.match(roles.text, /System Roles/);
  assert.match(roles.text, /Quotation Engineer/);
  assert.match(roles.text, /technical_manager/);

  const approvals = await agent.get('/system/approval-settings');
  assert.equal(approvals.status, 200);
  assertSystemSidebar(approvals.text, '/system/approval-settings');
  assert.match(approvals.text, /Approval Settings/);
  assert.match(approvals.text, /Opportunity Initiation/);
  assert.match(approvals.text, /Technical Solution/);
  assert.match(approvals.text, /Commercial Quote/);
  assert.match(approvals.text, /Contract Approval/);
});
