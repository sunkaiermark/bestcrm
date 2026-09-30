import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createAgent({ userId = 7, roles = [ROLES.SALESPERSON], archivedAt = null, sourceAvailable = true } = {}) {
  const user = {
    id: userId, username: `user${userId}`, displayName: 'Test User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles
  };
  const opportunity = {
    id: 20, opportunityNo: '800020', title: 'Mixer Project', customerName: 'Acme',
    primaryContactName: 'Alex', salespersonId: 7, status: 'technical_solution_in_progress',
    archivedAt, teamMembers: []
  };
  const source = {
    technicalDraftId: 41, technicalDraftRevisionNo: 2, attachmentId: 51,
    originalName: 'internal-technical-quote.pdf', sha256: 'a'.repeat(64), technicalStatus: 'ready'
  };
  const calls = [];
  const app = createApp({
    databaseUrl: '', sessionSecret: 'test-secret', csrfProtection: false,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersByRole() { return []; },
      async listUsersWithRoles() { return []; }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) { return Number(id) === 20 ? opportunity : null; },
      async listOpportunities() { return []; }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } },
    salesCommercialQuotationDraftRepository: {
      async getByOpportunity() { return null; },
      async listTechnicalSources() { return sourceAvailable ? [source] : []; },
      async getTechnicalSource(_opportunityId, id) { return sourceAvailable && Number(id) === 51 ? source : null; },
      async saveDraft(input) { calls.push(input); return { id: 10, draftRevisionNo: 1 }; }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

test('sales owner sees the early draft form and saves two lines without technical approval', async () => {
  const { agent, calls } = await createAgent();
  const page = await agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  assert.match(page.text, /Internal Commercial Quotation Draft/);
  assert.match(page.text, /800020/);
  assert.match(page.text, /internal-technical-quote\.pdf/);
  assert.match(page.text, /Add row/);
  assert.doesNotMatch(page.text, /quotation-packages\/.*submit/);
  const save = await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on', currency: 'USD',
    description: ['Mixer', 'Seal'], quantity: ['1', '2'],
    unit: ['set', 'piece'], unitPrice: ['100', '20']
  });
  assert.equal(save.status, 302);
  assert.match(save.headers.location, /saved=1/);
  assert.equal(calls[0].lineItems.length, 2);
});

test('direct draft access is denied to an unrelated salesperson and direct write to an engineer', async () => {
  const other = await createAgent({ userId: 8 });
  assert.equal((await other.agent.get('/opportunities/20/commercial-quotation-draft')).status, 403);
  assert.equal((await other.agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({ sourceAttachmentId: '51', expectedRevisionNo: '0' })).status, 403);
  const engineer = await createAgent({ userId: 3, roles: [ROLES.QUOTATION_ENGINEER] });
  assert.equal((await engineer.agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({ sourceAttachmentId: '51', expectedRevisionNo: '0' })).status, 403);
});

test('archived opportunity and missing uploaded source cannot create a draft', async () => {
  const archived = await createAgent({ archivedAt: '2026-09-21' });
  assert.equal((await archived.agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({ sourceAttachmentId: '51', expectedRevisionNo: '0' })).status, 403);
  const missing = await createAgent({ sourceAvailable: false });
  const page = await missing.agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  assert.match(page.text, /No active uploaded technical file/);
  assert.equal((await missing.agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({ sourceAttachmentId: '51', expectedRevisionNo: '0' })).status, 409);
});
