import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createAnalyticsAgent() {
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
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({
    username: user.username,
    password: 'ChangeMe123!'
  });
  return agent;
}

test('anonymous users are redirected from analytics', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/analytics');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('logged in users can open Analytics from the left sidebar', async () => {
  const agent = await createAnalyticsAgent();

  const response = await agent.get('/analytics');

  assert.equal(response.status, 200);
  assert.match(response.text, /<h1>Analytics<\/h1>/);
  assert.match(response.text, /class="nav-link active" href="\/analytics">Analytics<\/a>/);
  assert.match(response.text, /No analytics reports have been configured yet\./);
});
