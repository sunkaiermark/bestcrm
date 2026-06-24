import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword, verifyPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createSystemAgent(options = {}) {
  const currentUser = {
    id: 7,
    username: options.username || 'admin01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: options.displayName || 'Admin User',
    isActive: true,
    roles: options.roles || [ROLES.ADMINISTRATOR]
  };
  const managedUser = {
    id: 11,
    username: 'sales_manager01',
    displayName: 'Sales Manager',
    email: 'sales.manager01@bestcrm.local',
    phone: '',
    isActive: true,
    roles: [ROLES.SALES_MANAGER]
  };
  const role = {
    id: 21,
    code: 'service_manager',
    name: 'Service Manager',
    description: 'Coordinates service work.',
    isActive: true
  };
  const salesRole = {
    id: 22,
    code: ROLES.SALESPERSON,
    name: 'Sales',
    description: 'Creates opportunities.',
    isActive: true
  };
  const salesManagerRole = {
    id: 24,
    code: ROLES.SALES_MANAGER,
    name: 'Sales Manager',
    description: 'Approves initiation.',
    isActive: true
  };
  const technicalRole = {
    id: 23,
    code: ROLES.TECHNICAL_MANAGER,
    name: 'Technical Manager',
    description: 'Approves technical solutions.',
    isActive: true
  };
  const approvalSetting = {
    id: 31,
    settingKey: 'opportunity_initiation',
    stage: 'Opportunity Initiation',
    userId: managedUser.id,
    userDisplayName: managedUser.displayName,
    username: managedUser.username,
    roleCode: ROLES.SALES_MANAGER,
    roleName: 'Sales Manager',
    sortOrder: 1,
    isActive: true
  };
  const calls = [];
  const { language } = options;
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        if (Number(id) === currentUser.id) {
          return currentUser;
        }
        if (Number(id) === managedUser.id) {
          return managedUser;
        }
        return null;
      },
      async findByUsernameWithRoles(username) {
        return username === currentUser.username ? currentUser : null;
      },
      async listUsersWithRoles() {
        return [managedUser, currentUser];
      },
      async createUser(input) {
        calls.push({ method: 'createUser', input });
        return { id: 12 };
      },
      async updateUser(id, input) {
        calls.push({ method: 'updateUser', id: Number(id), input });
        return { id: Number(id) };
      },
      async deactivateUser(id) {
        calls.push({ method: 'deactivateUser', id: Number(id) });
        return { id: Number(id) };
      }
    },
    roleRepository: {
      async listRoles() {
        return [role];
      },
      async listActiveRoles() {
        return [role, salesRole, salesManagerRole, technicalRole];
      },
      async findById(id) {
        return Number(id) === role.id ? role : null;
      },
      async createRole(input) {
        calls.push({ method: 'createRole', input });
        return { id: 22 };
      },
      async updateRole(id, input) {
        calls.push({ method: 'updateRole', id: Number(id), input });
        return { id: Number(id) };
      },
      async deactivateRole(id) {
        calls.push({ method: 'deactivateRole', id: Number(id) });
        return { id: Number(id) };
      }
    },
    approvalSettingRepository: {
      async listApprovalSettings() {
        return [approvalSetting];
      },
      async findById(id) {
        return Number(id) === approvalSetting.id ? approvalSetting : null;
      },
      async createApprovalSetting(input) {
        calls.push({ method: 'createApprovalSetting', input });
        return { id: 32 };
      },
      async updateApprovalSetting(id, input) {
        calls.push({ method: 'updateApprovalSetting', id: Number(id), input });
        return { id: Number(id) };
      },
      async deactivateApprovalSetting(id) {
        calls.push({ method: 'deactivateApprovalSetting', id: Number(id) });
        return { id: Number(id) };
      }
    },
    loginSecurityRepository: {
      async findStates() {
        return [];
      },
      async resetAttempts(keys) {
        if (keys.length === 1) {
          calls.push({ method: 'resetLoginAttempts', keys });
        }
      },
      async resetAttemptsForUsername(username) {
        calls.push({ method: 'resetLoginAttemptsForUsername', username });
      },
      async recordAuditEvent() {
      }
    }
  });
  const agent = request.agent(app);
  if (language) {
    await agent.get(`/language?lang=${language}&returnTo=/login`);
  }
  await agent.post('/login').type('form').send({ username: currentUser.username, password: 'ChangeMe123!' });
  return { agent, calls };
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
  const { agent } = await createSystemAgent();

  const users = await agent.get('/system/users');
  assert.equal(users.status, 200);
  assertSystemSidebar(users.text, '/system/users');
  assert.match(users.text, /System Users/);
  assert.match(users.text, /sales_manager01/);
  assert.match(users.text, /Sales Manager/);
  assert.match(users.text, /sales_manager/);
  assert.match(users.text, /class="role-list"[\s\S]*class="role-list-item"[\s\S]*sales_manager/);
  assert.doesNotMatch(users.text, /administrator, sales_manager/);
  assert.match(users.text, /<table class="list-table content-fit-table">/);
  assert.match(users.text, /\.content-fit-table thead th\s*\{[\s\S]*background:\s*#1e3a5f;/);
  assert.match(users.text, /<td class="actions-cell">[\s\S]*<div class="inline-actions system-actions">/);
  assert.match(users.text, /action="\/system\/users\/11\/reset-password"/);
  assert.match(users.text, /action="\/system\/users\/11\/unlock-login"/);
  assert.match(users.text, /action="\/system\/users\/11\/delete" onsubmit="return confirm\('Delete this user\?'\)"/);
  assert.match(users.text, /\.system-actions\s*\{[\s\S]*flex-wrap:\s*nowrap;/);
  assert.match(users.text, /\.system-actions\s*\{[\s\S]*justify-content:\s*space-between;/);

  const roles = await agent.get('/system/roles');
  assert.equal(roles.status, 200);
  assertSystemSidebar(roles.text, '/system/roles');
  assert.match(roles.text, /System Roles/);
  assert.match(roles.text, /Service Manager/);
  assert.match(roles.text, /service_manager/);
  assert.match(roles.text, /<table class="list-table content-fit-table">/);
  assert.match(roles.text, /<td class="actions-cell">[\s\S]*<div class="inline-actions system-actions">/);
  assert.match(roles.text, /action="\/system\/roles\/21\/delete" onsubmit="return confirm\('Delete this role\?'\)"/);

  const approvals = await agent.get('/system/approval-settings');
  assert.equal(approvals.status, 200);
  assertSystemSidebar(approvals.text, '/system/approval-settings');
  assert.match(approvals.text, /Approval Settings/);
  assert.match(approvals.text, /Opportunity Initiation/);
  assert.match(approvals.text, /sales_manager01/);
  assert.match(approvals.text, /Sales Manager/);
  assert.match(approvals.text, /New setting/);
  assert.match(approvals.text, /<table class="list-table content-fit-table">/);
  assert.match(approvals.text, /<td class="actions-cell">[\s\S]*<div class="inline-actions system-actions">/);
  assert.match(approvals.text, /action="\/system\/approval-settings\/31\/delete" onsubmit="return confirm\('Delete this approval setting\?'\)"/);
});

test('system framework text uses selected Chinese language', async () => {
  const { agent } = await createSystemAgent({ language: 'zh' });

  const users = await agent.get('/system/users');
  assert.equal(users.status, 200);
  assert.match(users.text, /<h1>\u7cfb\u7edf\u7528\u6237<\/h1>/);
  assert.match(users.text, /\u65b0\u5efa\u7528\u6237/);
  assert.match(users.text, />\u7f16\u8f91<\/a>/);
  assert.match(users.text, />\u5220\u9664<\/button>/);

  const roles = await agent.get('/system/roles');
  assert.equal(roles.status, 200);
  assert.match(roles.text, /<h1>\u7cfb\u7edf\u89d2\u8272<\/h1>/);
  assert.match(roles.text, /\u65b0\u5efa\u89d2\u8272/);

  const approvals = await agent.get('/system/approval-settings');
  assert.equal(approvals.status, 200);
  assert.match(approvals.text, /<h1>\u5ba1\u6279\u4eba\u914d\u7f6e<\/h1>/);
  assert.match(approvals.text, /\u65b0\u5efa\u914d\u7f6e/);

  const userForm = await agent.get('/system/users/new');
  assert.equal(userForm.status, 200);
  assert.match(userForm.text, /\u521d\u59cb\u5bc6\u7801/);
  assert.match(userForm.text, /\u663e\u793a\u540d\u79f0/);
  assert.match(userForm.text, /\u6fc0\u6d3b\u767b\u5f55\u8d26\u53f7/);
  assert.match(userForm.text, /\u53d6\u6d88/);

  const roleForm = await agent.get('/system/roles/new');
  assert.equal(roleForm.status, 200);
  assert.match(roleForm.text, /\u89d2\u8272\u7f16\u7801/);
  assert.match(roleForm.text, /\u89d2\u8272\u540d\u79f0/);
  assert.match(roleForm.text, /\u6fc0\u6d3b\u89d2\u8272/);
  assert.match(roleForm.text, /\u53d6\u6d88/);
});

test('non administrators cannot view system pages', async () => {
  const { agent } = await createSystemAgent({
    username: 'sales01',
    displayName: 'Sales User',
    roles: [ROLES.SALESPERSON]
  });

  for (const path of ['/system/users', '/system/roles', '/system/approval-settings']) {
    const response = await agent.get(path);
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
});

test('administrator can add edit and deactivate system users', async () => {
  const { agent, calls } = await createSystemAgent();

  const newForm = await agent.get('/system/users/new');
  assert.equal(newForm.status, 200);
  assertSystemSidebar(newForm.text, '/system/users');
  assert.match(newForm.text, /New User/);
  assert.match(newForm.text, /name="username"/);
  assert.match(newForm.text, /name="password"/);
  assert.match(newForm.text, /value="service_manager"/);

  const created = await agent.post('/system/users').type('form').send({
    username: 'new_user',
    displayName: 'New User',
    email: 'new.user@bestcrm.local',
    phone: '555',
    password: 'Start12345!',
    roles: ROLES.SALESPERSON,
    isActive: 'on'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/system/users');
  assert.equal(calls[0].method, 'createUser');
  assert.equal(calls[0].input.username, 'new_user');
  assert.equal(calls[0].input.displayName, 'New User');
  assert.deepEqual(calls[0].input.roles, [ROLES.SALESPERSON]);
  assert.equal(calls[0].input.isActive, true);
  assert.notEqual(calls[0].input.passwordHash, 'Start12345!');
  assert.equal(await verifyPassword('Start12345!', calls[0].input.passwordHash), true);

  const editForm = await agent.get('/system/users/11/edit');
  assert.equal(editForm.status, 200);
  assertSystemSidebar(editForm.text, '/system/users');
  assert.match(editForm.text, /Edit User/);
  assert.match(editForm.text, /sales_manager01/);
  assert.match(editForm.text, /name="displayName"/);
  assert.match(editForm.text, /New login password/);
  assert.match(editForm.text, /name="password"/);

  const updated = await agent.post('/system/users/11').type('form').send({
    displayName: 'Updated Manager',
    email: 'updated.manager@bestcrm.local',
    phone: '777',
    roles: ROLES.TECHNICAL_MANAGER
  });
  assert.equal(updated.status, 302);
  assert.equal(updated.headers.location, '/system/users');
  assert.equal(calls[1].method, 'updateUser');
  assert.equal(calls[1].id, 11);
  assert.deepEqual(calls[1].input, {
    displayName: 'Updated Manager',
    email: 'updated.manager@bestcrm.local',
    phone: '777',
    isActive: false,
    roles: [ROLES.TECHNICAL_MANAGER]
  });

  const passwordUpdated = await agent.post('/system/users/11').type('form').send({
    displayName: 'Updated Manager',
    email: 'updated.manager@bestcrm.local',
    phone: '777',
    password: 'Changed123!',
    roles: ROLES.TECHNICAL_MANAGER,
    isActive: 'on'
  });
  assert.equal(passwordUpdated.status, 302);
  assert.equal(passwordUpdated.headers.location, '/system/users');
  assert.equal(calls[2].method, 'updateUser');
  assert.equal(calls[2].id, 11);
  assert.equal(calls[2].input.displayName, 'Updated Manager');
  assert.equal(calls[2].input.isActive, true);
  assert.notEqual(calls[2].input.passwordHash, 'Changed123!');
  assert.equal(await verifyPassword('Changed123!', calls[2].input.passwordHash), true);

  const deleted = await agent.post('/system/users/11/delete').type('form').send();
  assert.equal(deleted.status, 302);
  assert.equal(deleted.headers.location, '/system/users');
  assert.deepEqual(calls[3], { method: 'deactivateUser', id: 11 });
});

test('administrator can reset user password and unlock login attempts', async () => {
  const { agent, calls } = await createSystemAgent();

  const reset = await agent.post('/system/users/11/reset-password').type('form').send({
    password: 'NewTemp123!'
  });
  assert.equal(reset.status, 302);
  assert.equal(reset.headers.location, '/system/users');
  assert.equal(calls[0].method, 'updateUser');
  assert.equal(calls[0].id, 11);
  assert.equal(calls[0].input.displayName, 'Sales Manager');
  assert.equal(calls[0].input.isActive, true);
  assert.deepEqual(calls[0].input.roles, [ROLES.SALES_MANAGER]);
  assert.notEqual(calls[0].input.passwordHash, 'NewTemp123!');
  assert.equal(await verifyPassword('NewTemp123!', calls[0].input.passwordHash), true);

  const unlock = await agent.post('/system/users/11/unlock-login').type('form').send();
  assert.equal(unlock.status, 302);
  assert.equal(unlock.headers.location, '/system/users');
  assert.deepEqual(calls[1], {
    method: 'resetLoginAttemptsForUsername',
    username: 'sales_manager01'
  });
});

test('non administrators cannot manage system users', async () => {
  const { agent, calls } = await createSystemAgent({
    username: 'sales01',
    displayName: 'Sales User',
    roles: [ROLES.SALESPERSON]
  });

  for (const requestCall of [
    () => agent.get('/system/users/new'),
    () => agent.post('/system/users').type('form').send({ username: 'x' }),
    () => agent.get('/system/users/11/edit'),
    () => agent.post('/system/users/11').type('form').send({ displayName: 'x' }),
    () => agent.post('/system/users/11/reset-password').type('form').send({ password: 'NewTemp123!' }),
    () => agent.post('/system/users/11/unlock-login').type('form').send(),
    () => agent.post('/system/users/11/delete').type('form').send()
  ]) {
    const response = await requestCall();
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
  assert.deepEqual(calls, []);
});

test('administrator can add edit and deactivate system roles', async () => {
  const { agent, calls } = await createSystemAgent();

  const newForm = await agent.get('/system/roles/new');
  assert.equal(newForm.status, 200);
  assertSystemSidebar(newForm.text, '/system/roles');
  assert.match(newForm.text, /New Role/);
  assert.match(newForm.text, /name="code"/);
  assert.match(newForm.text, /name="description"/);

  const created = await agent.post('/system/roles').type('form').send({
    code: 'service_manager',
    name: 'Service Manager',
    description: 'Coordinates service work.',
    isActive: 'on'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/system/roles');
  assert.deepEqual(calls[0], {
    method: 'createRole',
    input: {
      code: 'service_manager',
      name: 'Service Manager',
      description: 'Coordinates service work.',
      isActive: true
    }
  });

  const editForm = await agent.get('/system/roles/21/edit');
  assert.equal(editForm.status, 200);
  assertSystemSidebar(editForm.text, '/system/roles');
  assert.match(editForm.text, /Edit Role/);
  assert.match(editForm.text, /service_manager/);
  assert.match(editForm.text, /name="name"/);
  assert.doesNotMatch(editForm.text, /name="code"/);

  const updated = await agent.post('/system/roles/21').type('form').send({
    name: 'Updated Service Manager',
    description: 'Updated role description.'
  });
  assert.equal(updated.status, 302);
  assert.equal(updated.headers.location, '/system/roles');
  assert.deepEqual(calls[1], {
    method: 'updateRole',
    id: 21,
    input: {
      name: 'Updated Service Manager',
      description: 'Updated role description.',
      isActive: false
    }
  });

  const deleted = await agent.post('/system/roles/21/delete').type('form').send();
  assert.equal(deleted.status, 302);
  assert.equal(deleted.headers.location, '/system/roles');
  assert.deepEqual(calls[2], { method: 'deactivateRole', id: 21 });
});

test('non administrators cannot manage system roles', async () => {
  const { agent, calls } = await createSystemAgent({
    username: 'sales01',
    displayName: 'Sales User',
    roles: [ROLES.SALESPERSON]
  });

  for (const requestCall of [
    () => agent.get('/system/roles/new'),
    () => agent.post('/system/roles').type('form').send({ code: 'x' }),
    () => agent.get('/system/roles/21/edit'),
    () => agent.post('/system/roles/21').type('form').send({ name: 'x' }),
    () => agent.post('/system/roles/21/delete').type('form').send()
  ]) {
    const response = await requestCall();
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
  assert.deepEqual(calls, []);
});

test('administrator can add edit and deactivate approval settings', async () => {
  const { agent, calls } = await createSystemAgent();

  const newForm = await agent.get('/system/approval-settings/new');
  assert.equal(newForm.status, 200);
  assertSystemSidebar(newForm.text, '/system/approval-settings');
  assert.match(newForm.text, /New Approval Setting/);
  assert.match(newForm.text, /name="settingKey"/);
  assert.match(newForm.text, /name="roleCode"/);
  assert.match(newForm.text, /name="userId"/);
  assert.match(newForm.text, /Opportunity Initiation/);

  const created = await agent.post('/system/approval-settings').type('form').send({
    settingKey: 'opportunity_initiation',
    roleCode: ROLES.SALES_MANAGER,
    userId: '11',
    sortOrder: '1',
    isActive: 'on'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/system/approval-settings');
  assert.deepEqual(calls[0], {
    method: 'createApprovalSetting',
    input: {
      settingKey: 'opportunity_initiation',
      userId: 11,
      roleCode: ROLES.SALES_MANAGER,
      sortOrder: 1,
      isActive: true
    }
  });

  const editForm = await agent.get('/system/approval-settings/31/edit');
  assert.equal(editForm.status, 200);
  assertSystemSidebar(editForm.text, '/system/approval-settings');
  assert.match(editForm.text, /Edit Approval Setting/);
  assert.match(editForm.text, /value="opportunity_initiation"/);
  assert.match(editForm.text, /sales_manager01/);

  const updated = await agent.post('/system/approval-settings/31').type('form').send({
    settingKey: 'technical_solution',
    roleCode: ROLES.TECHNICAL_MANAGER,
    userId: '7',
    sortOrder: '2'
  });
  assert.equal(updated.status, 302);
  assert.equal(updated.headers.location, '/system/approval-settings');
  assert.deepEqual(calls[1], {
    method: 'updateApprovalSetting',
    id: 31,
    input: {
      settingKey: 'technical_solution',
      userId: 7,
      roleCode: ROLES.TECHNICAL_MANAGER,
      sortOrder: 2,
      isActive: false
    }
  });

  const deleted = await agent.post('/system/approval-settings/31/delete').type('form').send();
  assert.equal(deleted.status, 302);
  assert.equal(deleted.headers.location, '/system/approval-settings');
  assert.deepEqual(calls[2], { method: 'deactivateApprovalSetting', id: 31 });
});

test('non administrators cannot manage approval settings', async () => {
  const { agent, calls } = await createSystemAgent({
    username: 'sales01',
    displayName: 'Sales User',
    roles: [ROLES.SALESPERSON]
  });

  for (const requestCall of [
    () => agent.get('/system/approval-settings/new'),
    () => agent.post('/system/approval-settings').type('form').send({ settingKey: 'x' }),
    () => agent.get('/system/approval-settings/31/edit'),
    () => agent.post('/system/approval-settings/31').type('form').send({ settingKey: 'x' }),
    () => agent.post('/system/approval-settings/31/delete').type('form').send()
  ]) {
    const response = await requestCall();
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
  assert.deepEqual(calls, []);
});
