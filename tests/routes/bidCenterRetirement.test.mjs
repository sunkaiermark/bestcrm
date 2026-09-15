import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

test('retired Bid Center routes stay unmounted even with a stale enabled option', async () => {
  const currentUser = {
    id: 1,
    username: 'admin',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Administrator',
    isActive: true,
    roles: [ROLES.ADMINISTRATOR]
  };
  const app = createApp({
    databaseUrl: '',
    sessionSecret: 'test-secret',
    csrfProtection: false,
    bidCenter: { enabled: true },
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === currentUser.id ? currentUser : null; },
      async findByUsernameWithRoles(username) { return username === currentUser.username ? currentUser : null; }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'admin', password: 'ChangeMe123!' });

  for (const route of [
    '/bid-center/workspaces',
    '/bid-center/commercial-templates',
    '/bid-center/clauses',
    '/bid-center/public-materials',
    '/opportunities/20/bid-workspace'
  ]) {
    const response = await agent.get(route);
    assert.equal(response.status, 404, route);
  }
});
