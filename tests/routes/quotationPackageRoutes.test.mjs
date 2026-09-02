import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

function quotationPackage(overrides = {}) {
  return {
    id: 51, opportunityId: 20, sourcePackageId: null, draftRevisionNo: 1, versionNo: null,
    label: 'QP-D1', status: 'draft', technicalSolutionVersionId: 41, technicalSolutionVersionNo: 2,
    commercialQuoteId: 31, commercialQuoteVersionNo: 3, currency: 'USD', totalPrice: 120000,
    deliveryPeriod: '16 weeks', paymentTerms: '30/60/10', validUntil: '2026-12-31',
    commercialLineItems: [], inclusions: 'FAT', exclusions: 'Civil work', technicalAssumptions: 'Clean utilities',
    revisionReason: '', changeSummary: '', creatorDisplayName: 'Sales One', createdBy: 7, updatedBy: 7,
    attachments: [{ id: 61, sourceType: 'technical_solution_document', originalName: 'TS-V2.pdf', sha256: 'a'.repeat(64) }],
    events: [{ id: 71, eventType: 'created', actorUserId: 7, actorDisplayName: 'Sales One', createdAt: '2026-09-03' }],
    ...overrides
  };
}

async function createAgent({ userId, roles, packageStatus = 'draft', language = 'en' }) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = { id: userId, username: `user${userId}`, displayName: `User ${userId}`, passwordHash, isActive: true, roles };
  const opportunity = {
    id: 20, opportunityNo: '800020', title: 'Mixer Project', customerName: 'Acme',
    salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3, technicalManagerId: 6,
    commercialManagerId: 9, status: 'customer_negotiation', teamMembers: []
  };
  const calls = [];
  const formal = ['approved', 'sent', 'accepted'].includes(packageStatus);
  const item = quotationPackage({ status: packageStatus, versionNo: formal ? 1 : null, label: formal ? 'QP-V1' : 'QP-D1' });
  const quotationPackageRepository = {
    supportsQuotationPackages: true,
    async listByOpportunity() { return [item]; },
    async getPackageDetail(id) { return Number(id) === item.id ? item : null; },
    async listApprovedTechnicalSolutions() { return [{ id: 41, versionNo: 2, label: 'TS-V2', language: 'bilingual' }]; },
    async listApprovedCommercialQuotes() { return [{ id: 31, versionNo: 3, label: 'CQ-V3', totalPrice: 120000 }]; },
    async approvePending(input) { calls.push(['approve', input]); return { ...item, status: 'approved', versionNo: 1 }; },
    async rejectPending(input) { calls.push(['reject', input]); return { ...item, status: 'rejected' }; }
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'test-secret', csrfProtection: false,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersByRole() { return []; },
      async listUsersWithRoles() { return []; }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) { return Number(id) === opportunity.id ? opportunity : null; },
      async listOpportunities() { return []; }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } },
    quotationPackageRepository
  });
  const agent = request.agent(app);
  if (language === 'zh') await agent.get('/language?lang=zh&returnTo=/login');
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

test('anonymous users are redirected from quotation package routes', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  const response = await request(app).get('/opportunities/20/quotation-packages');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('sales owner sees bilingual package list, frozen content and submit action', async () => {
  const { agent } = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON], language: 'zh' });
  const list = await agent.get('/opportunities/20/quotation-packages');
  assert.equal(list.status, 200);
  assert.match(list.text, /客户报价包/);
  assert.match(list.text, /QP-D1/);
  const detail = await agent.get('/opportunities/20/quotation-packages/51');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /TS-V2/);
  assert.match(detail.text, /CQ-V3/);
  assert.match(detail.text, /提交报价包审批/);
  assert.match(detail.text, /aaaaaaaaaaaaaaaa/);
});

test('unassigned salesperson cannot list or directly open quotation packages', async () => {
  const { agent } = await createAgent({ userId: 8, roles: [ROLES.SALESPERSON] });
  assert.equal((await agent.get('/opportunities/20/quotation-packages')).status, 403);
  assert.equal((await agent.get('/opportunities/20/quotation-packages/51')).status, 403);
});

test('only assigned commercial manager sees and executes package review', async () => {
  const { agent, calls } = await createAgent({ userId: 9, roles: [ROLES.COMMERCIAL_MANAGER], packageStatus: 'pending' });
  const detail = await agent.get('/opportunities/20/quotation-packages/51');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Approve and Assign QP Version/);
  const review = await agent.post('/opportunities/20/quotation-packages/51/review').type('form').send({ decision: 'approve', comment: 'Approved' });
  assert.equal(review.status, 302);
  assert.equal(calls[0][0], 'approve');
  assert.equal(calls[0][1].actorUserId, 9);
});

test('only sales owner sees the manual sent control on an approved package', async () => {
  const salesSession = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON], packageStatus: 'approved' });
  const salesDetail = await salesSession.agent.get('/opportunities/20/quotation-packages/51');
  assert.equal(salesDetail.status, 200);
  assert.match(salesDetail.text, /Record as Sent/);
  assert.match(salesDetail.text, /Step 9 will replace it with an atomic CRM email send/);

  const managerSession = await createAgent({ userId: 9, roles: [ROLES.COMMERCIAL_MANAGER], packageStatus: 'approved' });
  const managerDetail = await managerSession.agent.get('/opportunities/20/quotation-packages/51');
  assert.equal(managerDetail.status, 200);
  assert.doesNotMatch(managerDetail.text, /Record as Sent/);
});
