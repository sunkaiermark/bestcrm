import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function session(userId, roles, repository) {
  const user = { id: userId, username: `terms${userId}`, displayName: `User ${userId}`, passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'test-secret', csrfProtection: false,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersByRole() { return []; }, async listUsersWithRoles() { return []; }
    },
    salesQuotationStandardTermRepository: repository
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return agent;
}

test('standard wording management blocks direct salesperson access and preserves empty catalog', async () => {
  const repository = { async listAll() { return []; } };
  const salesperson = await session(2, [ROLES.SALESPERSON], repository);
  assert.equal((await salesperson.get('/quotation-standard-terms')).status, 403);
  assert.equal((await salesperson.post('/quotation-standard-terms').type('form').send({ termKey: 'payment', language: 'en', title: 'A', body: 'B' })).status, 403);
  const administrator = await session(3, [ROLES.ADMINISTRATOR], repository);
  assert.equal((await administrator.get('/quotation-standard-terms')).status, 403);
  assert.equal((await administrator.post('/quotation-standard-terms').type('form').send({ termKey: 'payment', language: 'en', title: 'A', body: 'B' })).status, 403);
  const author = await session(7, [ROLES.COMMERCIAL_MANAGER], repository);
  const page = await author.get('/quotation-standard-terms');
  assert.equal(page.status, 200);
  assert.match(page.text, /No wording yet/);
  assert.match(page.text, /New wording draft/);
});

test('reviewer sees complete text and publishes only the matching reviewed version', async () => {
  const term = { id: 91, key: 'payment', language: 'en', revisionNo: 1, title: 'Payment', body: 'Company approved text', status: 'draft', createdBy: 7 };
  const calls = [];
  const repository = {
    async findById() { return term; },
    async publish(input) { calls.push(input); return { ...term, status: 'published' }; }
  };
  const reviewer = await session(8, [ROLES.GENERAL_MANAGER], repository);
  const page = await reviewer.get('/quotation-standard-terms/91');
  assert.equal(page.status, 200);
  assert.match(page.text, /Company approved text/);
  const fingerprint = page.text.match(/name="expectedFingerprint" value="([a-f0-9]{64})"/)?.[1];
  assert.ok(fingerprint);
  assert.equal((await reviewer.post('/quotation-standard-terms/91/publish').type('form').send({ expectedFingerprint: 'stale' })).status, 409);
  assert.equal((await reviewer.post('/quotation-standard-terms/91/publish').type('form').send({ expectedFingerprint: fingerprint })).status, 302);
  assert.equal(calls.length, 1);
});
