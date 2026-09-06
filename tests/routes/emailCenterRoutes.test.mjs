import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

function thread(overrides = {}) {
  return {
    id: 1, mailboxKey: 'sales@sunkaier.com', subject: '<script>alert(1)</script> RFQ', inquiryId: 8,
    opportunityId: null, opportunityNo: '', opportunityTitle: '', customerId: null, customerCode: '', customerName: '', contactId: null,
    contactCode: '', contactName: '',
    lastMessageAt: '2026-09-03T01:00:00Z', messageCount: 1, lastFromAddress: 'buyer@example.com',
    lastTextPreview: '<img src=x onerror=alert(1)> Need quote', messages: [{
      id: 11, threadId: 1, direction: 'inbound', messageId: 'rfq@example.com', inReplyTo: '',
      referenceIds: [], fromAddress: 'buyer@example.com', fromName: 'Buyer',
      toRecipients: [{ address: 'sales@sunkaier.com' }], ccRecipients: [], subject: 'RFQ',
      textBody: '<script>alert(2)</script> Need quote', htmlBody: '<img src="https://tracker.example/pixel">',
      deliveryStatus: 'received', receivedAt: '2026-09-03T01:00:00Z', attachments: [{
        id: 21, messageId: 11, originalName: 'spec.pdf', storedPath: 'email-archive/spec.pdf',
        mimeType: 'application/pdf', fileSize: 4, sha256: 'a'.repeat(64)
      }], deliveryAttempts: []
    }],
    ...overrides
  };
}

async function createAgent({ userId, roles, language = 'en', uploadDir = './var/uploads', sendingEnabled = false, teamMembers = [] }) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: userId, username: `user${userId}`, displayName: `User ${userId}`,
    emailSignatureName: `User ${userId}`, emailSignatureTitle: 'Project Engineer',
    email: `user${userId}@sunkaier.com`, passwordHash, isActive: true, roles
  };
  const unlinked = thread();
  const linked = thread({
    id: 2,
    inquiryId: 9,
    opportunityId: 20,
    opportunityNo: '800020',
    opportunityTitle: 'Mixer Project',
    customerId: 10,
    customerCode: 'C000010',
    customerName: 'Acme Co',
    contactId: 20,
    contactCode: 'CT000020',
    contactName: 'Alice'
  });
  linked.messages = linked.messages.map((message) => ({ ...message, threadId: 2 }));
  const repository = {
    async listThreads() { return [unlinked, linked]; },
    async listThreadsByOpportunity(id) { return Number(id) === 20 ? [linked] : []; },
    async findThreadById(id) { return Number(id) === 2 ? linked : Number(id) === 1 ? unlinked : null; },
    async findLatestThreadByOpportunity() { return linked; },
    async findLatestThreadByInquiry() { return unlinked; },
    async getThreadDetail(id) { return Number(id) === 2 ? linked : Number(id) === 1 ? unlinked : null; },
    async findAttachmentById(id) { return Number(id) === 21 ? unlinked.messages[0].attachments[0] : null; },
    async findMessageById(id) { return Number(id) === 11 ? unlinked.messages[0] : null; }
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'test-secret', csrfProtection: false, emailCenter: { enabled: true },
    customerEmail: { enabled: sendingEnabled, sharedAddress: 'sales@sunkaier.com', maxUploadMb: 25, smtp: {} }, uploadDir,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersByRole() { return []; }, async listUsersWithRoles() { return []; }
    },
    emailArchiveRepository: repository,
    opportunityRepository: {
      async getOpportunityDetail(id) {
        return Number(id) === 20 ? {
          id: 20, salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3,
          technicalManagerId: 6, commercialManagerId: 9, opportunityNo: '800020', title: 'Mixer Project'
        } : null;
      },
      async listOpportunities() { return []; }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return teamMembers; } },
    quotationPackageRepository: { async listByOpportunity() { return []; }, async getPackageDetail() { return null; } }
  });
  const agent = request.agent(app);
  if (language === 'zh') await agent.get('/language?lang=zh&returnTo=/login');
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return agent;
}

test('email center remains unavailable while the feature flag is disabled', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  const response = await request(app).get('/email-center');
  assert.equal(response.status, 404);
});

test('enabled email center requires login', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret', emailCenter: { enabled: true } });
  const response = await request(app).get('/email-center');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('sales manager sees bilingual protected threads and plain-text escaped message content', async () => {
  const agent = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh' });
  const list = await agent.get('/email-center');
  assert.equal(list.status, 200);
  assert.match(list.text, /邮件中心/);
  assert.match(list.text, /业务邮件和附件永久保存在 CRM 归档中/);
  assert.match(list.text, /垃圾邮件隔离区/);
  assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; RFQ/);
  assert.doesNotMatch(list.text, /<script>alert\(1\)<\/script>/);

  const detail = await agent.get('/email-center/threads/1');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /&lt;script&gt;alert\(2\)&lt;\/script&gt; Need quote/);
  assert.doesNotMatch(detail.text, /tracker\.example\/pixel/);
  assert.match(detail.text, new RegExp('a'.repeat(64)));
});

test('salesperson sees assigned opportunity mail but direct unlinked mail access is forbidden', async () => {
  const agent = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON] });
  const list = await agent.get('/email-center');
  assert.equal(list.status, 200);
  assert.match(list.text, /Mixer Project/);
  assert.match(list.text, /C000010 · Acme Co/);
  assert.match(list.text, /CT000020 · Alice/);
  assert.doesNotMatch(list.text, /Protected unlinked email/);
  assert.equal((await agent.get('/email-center/threads/1')).status, 403);
  const detail = await agent.get('/email-center/threads/2');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /C000010 · Acme Co/);
  assert.match(detail.text, /CT000020 · Alice/);
});

test('email attachment download enforces the same thread permission', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-route-'));
  try {
    await mkdir(path.join(uploadDir, 'email-archive'));
    await writeFile(path.join(uploadDir, 'email-archive', 'spec.pdf'), 'spec');
    const manager = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], uploadDir });
    const downloaded = await manager.get('/email-center/attachments/21/download');
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers['content-disposition'], /spec\.pdf/);
    assert.equal(downloaded.headers['cache-control'], 'private, no-store');
    assert.equal(downloaded.headers['x-archive-sha256'], 'a'.repeat(64));

    const salesperson = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON], uploadDir });
    assert.equal((await salesperson.get('/email-center/attachments/21/download')).status, 403);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('compose route is separately disabled until customer SMTP sending is enabled', async () => {
  const agent = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON] });
  assert.equal((await agent.get('/email-center/compose?opportunityId=20')).status, 404);
});

test('compose page shows send only to an authorized opportunity member and remains bilingual', async () => {
  const salesperson = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON], sendingEnabled: true });
  const salesCompose = await salesperson.get('/email-center/compose?opportunityId=20');
  assert.equal(salesCompose.status, 200);
  assert.match(salesCompose.text, /Compose customer email/);
  assert.match(salesCompose.text, /value="send"/);
  assert.match(salesCompose.text, /opportunity-email-workspace/);
  assert.match(salesCompose.text, /opportunity-email-conversation/);
  assert.match(salesCompose.text, /opportunity-email-compose/);
  assert.match(salesCompose.text, /value="buyer@example\.com"/);
  assert.match(salesCompose.text, /Need quote/);

  const supporting = await createAgent({
    userId: 15,
    roles: [ROLES.QUOTATION_ENGINEER],
    language: 'zh',
    sendingEnabled: true,
    teamMembers: [{ userId: 15, isActive: true, canSendExternalEmail: false }]
  });
  const supportingCompose = await supporting.get('/email-center/compose?opportunityId=20');
  assert.equal(supportingCompose.status, 200);
  assert.match(supportingCompose.text, /编写客户邮件/);
  assert.match(supportingCompose.text, /value="draft"/);
  assert.doesNotMatch(supportingCompose.text, /value="send"/);
});
