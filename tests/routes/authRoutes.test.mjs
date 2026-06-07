import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

function buildUserRepository(user) {
  return {
    async findByIdWithRoles(id) {
      return Number(id) === user.id ? user : null;
    },
    async findByUsernameWithRoles(username) {
      return username === user.username ? user : null;
    }
  };
}

test('login page renders username and password form', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const response = await request(app).get('/login');

  assert.equal(response.status, 200);
  assert.match(response.text, /class="login-shell"/);
  assert.match(response.text, /class="login-card"/);
  assert.match(response.text, /font:\s*15px\/1\.5 system-ui, "Microsoft YaHei", sans-serif;/);
  assert.match(response.text, /\.login-logo\s*\{[\s\S]*display:\s*block;/);
  assert.match(response.text, /\.login-logo\s*\{[\s\S]*margin:\s*0 auto 22px;/);
  assert.match(response.text, /\.login-logo\s*\{[\s\S]*width:\s*224px;/);
  assert.match(response.text, /class="login-logo"\s+src="\/assets\/sunkaier-logo-login\.png"\s+alt="SUNKAIER"/);
  assert.doesNotMatch(response.text, /class="login-heading"/);
  assert.doesNotMatch(response.text, />BESTCRM</);
  assert.doesNotMatch(response.text, /Company CRM/);
  assert.doesNotMatch(response.text, /class="login-subtitle"/);
  assert.match(response.text, /\.form-field input\s*\{[\s\S]*height:\s*42px;[\s\S]*line-height:\s*1\.4;/);
  assert.match(response.text, /\.login-button\s*\{[\s\S]*height:\s*44px;[\s\S]*line-height:\s*1;/);
  assert.match(response.text, /class="form-field"/);
  assert.match(response.text, /class="login-button"/);
  assert.match(response.text, /name="username"/);
  assert.match(response.text, /name="password"/);
});

test('valid login creates a session and logout clears it', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository(user)
  });
  const agent = request.agent(app);

  const loginResponse = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.location, '/');

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 200);
  assert.deepEqual(meResponse.body, {
    id: 7,
    username: 'sales01',
    displayName: 'Sales One',
    roles: [ROLES.SALESPERSON]
  });

  const logoutResponse = await agent.post('/logout');
  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.location, '/login');

  const afterLogout = await agent.get('/session/me');
  assert.equal(afterLogout.status, 401);
});

test('inactive users cannot keep using an existing session', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository(user)
  });
  const agent = request.agent(app);

  await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  user.isActive = false;

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 401);

  const workbenchResponse = await agent.get('/workbench');
  assert.equal(workbenchResponse.status, 302);
  assert.equal(workbenchResponse.headers.location, '/login');
});

test('invalid login does not create a session', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    })
  });
  const agent = request.agent(app);

  const response = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'WrongPassword' });

  assert.equal(response.status, 401);
  assert.match(response.text, /Invalid username or password/);

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 401);
});
