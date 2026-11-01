import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

const token = (html) => html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];

test('stale logout requires fresh confirmation and preserves the authenticated session until confirmed', async () => {
  const user = { id: 7, username: 'test', displayName: 'Test', isActive: true,
    passwordHash: await hashPassword('ChangeMe123!'), roles: [] };
  const app = createApp({ databaseUrl: '', csrfProtection: true, sessionSecret: 'logout-test',
    userRepository: {
      async findByUsernameWithRoles() { return user; },
      async findByIdWithRoles() { return user; }
    } });
  const agent = request.agent(app);
  const oldToken = token((await agent.get('/login')).text);
  await agent.post('/login').type('form').send({ username: 'test', password: 'ChangeMe123!', _csrf: oldToken }).expect(302);
  await agent.post('/logout').type('form').send({ _csrf: oldToken }).expect(303).expect('Location', '/logout');
  await agent.get('/session/me').expect(200);
  const confirmation = await agent.get('/logout').expect(200);
  assert.match(confirmation.headers['cache-control'], /no-store/);
  const freshToken = token(confirmation.text);
  assert.ok(freshToken);
  assert.notEqual(freshToken, oldToken);
  // GET and forged POST never destroy the session.
  await agent.get('/session/me').expect(200);
  await agent.post('/logout').type('form').send({ _csrf: 'forged' }).expect(303);
  await agent.get('/session/me').expect(200);
  await agent.post('/login').type('form').send({ _csrf: 'forged' }).expect(403);
  await agent.post('/logout').type('form').send({ _csrf: freshToken }).expect(302).expect('Location', '/login');
  await agent.get('/session/me').expect(401);
  await agent.get('/logout').expect(302).expect('Location', '/login');
});
