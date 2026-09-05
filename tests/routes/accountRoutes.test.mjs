import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword, verifyPassword } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

function extractCsrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

async function buildHarness({ csrfProtection = false } = {}) {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('482951'),
    displayName: 'Sales One',
    email: 'sales@example.com',
    phone: '',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const passwordChanges = [];
  const auditEvents = [];
  const userRepository = {
    async findByIdWithRoles(id) {
      return Number(id) === user.id ? user : null;
    },
    async findByUsernameWithRoles(username) {
      return username === user.username ? user : null;
    },
    async changePassword(id, passwordHash, auditEvent) {
      passwordChanges.push({ id: Number(id), passwordHash, auditEvent });
      user.passwordHash = passwordHash;
      return { id: Number(id) };
    }
  };
  const loginSecurityRepository = {
    auditEvents,
    async findStates() { return []; },
    async recordFailedAttempt() {},
    async resetAttempts() {},
    async recordAuditEvent(event) { auditEvents.push(event); }
  };
  const app = createApp({
    csrfProtection,
    sessionSecret: 'test-secret',
    userRepository,
    loginSecurityRepository
  });
  return { app, auditEvents, passwordChanges, user };
}

async function login(agent, password = '482951') {
  return agent.post('/login').type('form').send({ username: 'sales01', password });
}

test('password settings require login and render the confirmed policy', async () => {
  const { app } = await buildHarness();

  const blocked = await request(app).get('/account/password');
  assert.equal(blocked.status, 302);
  assert.equal(blocked.headers.location, '/login');

  const agent = request.agent(app);
  await login(agent);
  const page = await agent.get('/account/password');

  assert.equal(page.status, 200);
  assert.match(page.text, /name="currentPassword"/);
  assert.match(page.text, /name="newPassword"[\s\S]*minlength="6"[\s\S]*maxlength="6"[\s\S]*pattern="\[0-9\]\{6\}"/);
  assert.match(page.text, /name="confirmPassword"/);
  assert.match(page.text, /href="\/account\/password">Change password<\/a>/);
});

test('password settings reject invalid values without changing the password', async () => {
  const { app, auditEvents, passwordChanges } = await buildHarness();
  const agent = request.agent(app);
  await login(agent);
  auditEvents.length = 0;

  const incorrect = await agent.post('/account/password').type('form').send({
    currentPassword: 'Wrong1',
    newPassword: '730846',
    confirmPassword: '730846'
  });
  assert.equal(incorrect.status, 401);
  assert.match(incorrect.text, /The current password is incorrect/);
  assert.equal(auditEvents.at(-1).reason, 'current_password_incorrect');

  const tooShort = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '12345',
    confirmPassword: '12345'
  });
  assert.equal(tooShort.status, 400);
  assert.match(tooShort.text, /exactly 6 digits/);

  const sequential = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '123489',
    confirmPassword: '123489'
  });
  assert.equal(sequential.status, 400);
  assert.match(sequential.text, /sequential digits/);

  const repeated = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '111125',
    confirmPassword: '111125'
  });
  assert.equal(repeated.status, 400);
  assert.match(repeated.text, /identical digits/);

  const samePassword = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '482951',
    confirmPassword: '482951'
  });
  assert.equal(samePassword.status, 400);
  assert.match(samePassword.text, /must be different/);
  assert.equal(passwordChanges.length, 0);
});

test('successful password change signs out the user and accepts only the new password', async () => {
  const { app, passwordChanges, user } = await buildHarness();
  const agent = request.agent(app);
  await login(agent);

  const changed = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '730846',
    confirmPassword: '730846'
  });

  assert.equal(changed.status, 302);
  assert.equal(changed.headers.location, '/login?passwordChanged=1');
  assert.match(changed.headers['set-cookie'].join('\n'), /__Host-bestcrm\.mfa_trust=/);
  assert.equal(passwordChanges.length, 1);
  assert.equal(passwordChanges[0].auditEvent.reason, 'password_changed');
  assert.equal(await verifyPassword('730846', user.passwordHash), true);
  assert.equal((await agent.get('/session/me')).status, 401);

  const notice = await agent.get('/login?passwordChanged=1');
  assert.match(notice.text, /Password changed\. Sign in again with your new password/);
  assert.equal((await login(agent, '482951')).status, 401);
  assert.equal((await login(agent, '730846')).status, 302);
});

test('password change requires the current CSRF token when protection is enabled', async () => {
  const { app } = await buildHarness({ csrfProtection: true });
  const agent = request.agent(app);
  const loginPage = await agent.get('/login');
  const loginToken = extractCsrfToken(loginPage.text);
  await agent.post('/login').type('form').send({
    username: 'sales01',
    password: '482951',
    _csrf: loginToken
  });

  const blocked = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '730846',
    confirmPassword: '730846'
  });
  assert.equal(blocked.status, 403);

  const passwordPage = await agent.get('/account/password');
  const passwordToken = extractCsrfToken(passwordPage.text);
  const changed = await agent.post('/account/password').type('form').send({
    currentPassword: '482951',
    newPassword: '730846',
    confirmPassword: '730846',
    _csrf: passwordToken
  });
  assert.equal(changed.status, 302);
  assert.equal(changed.headers.location, '/login?passwordChanged=1');
});
