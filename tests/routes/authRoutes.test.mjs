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
  assert.match(response.text, /BESTCRM/);
  assert.match(response.text, /class="login-shell"/);
  assert.match(response.text, /class="login-card"/);
  assert.match(response.text, /font:\s*21px\/1\.4 Arial, "Microsoft YaHei", Helvetica, sans-serif;/);
  assert.match(response.text, /\.login-heading\s*\{[\s\S]*font-size:\s*39px;/);
  assert.match(response.text, /\.login-subtitle\s*\{[\s\S]*font-size:\s*19\.5px;/);
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
