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
    id: 1, mailboxKey: 'sales@sunkaier.com', mailboxKeys: ['sales@sunkaier.com'], subject: '<script>alert(1)</script> RFQ', inquiryId: null,
    opportunityId: null, opportunityNo: '', opportunityTitle: '', customerId: null, customerCode: '', customerName: '', contactId: null,
    contactCode: '', contactName: '',
    triageStatus: 'pending', triageAssignedUserId: null, triageAssignedDisplayName: '', triageEvents: [],
    lastMessageAt: '2026-09-03T01:00:00Z', messageCount: 1, attachmentCount: 1, lastFromAddress: 'buyer@example.com',
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

async function createAgent({
  userId,
  roles,
  language = 'en',
  uploadDir = './var/uploads',
  sendingEnabled = false,
  teamMembers = [],
  linkableOpportunities = [],
  linkableInquiries = [],
  onLinkOpportunity = null,
  onPurgeThread = null,
  purgeEligibleThreadIds = [1],
  spamCleanupSummary = { eligibleThreads: 0, messages: 0, attachments: 0, attachmentBytes: 0, rawMessages: 0, rawMessageBytes: 0 },
  spamPurgeCandidates = []
}) {
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
    contactName: 'Alice',
    triageStatus: 'linked_opportunity'
  });
  linked.messages = linked.messages.map((message) => ({ ...message, threadId: 2 }));
  linked.messages.push({
    ...linked.messages[0],
    id: 12,
    direction: 'outbound',
    fromAddress: 'sales@sunkaier.com',
    fromName: 'Sales',
    toRecipients: [{ address: 'buyer@example.com' }],
    textBody: 'Quotation sent',
    deliveryStatus: 'sent',
    receivedAt: null,
    sentAt: '2026-09-03T02:00:00Z',
    attachments: []
  });
  linked.messageCount = 2;
  const repository = {
    async listThreads() { return [unlinked, linked]; },
    async listActivePersonalMailboxAssignments() {
      return [{ userId: user.id, mailboxAddress: user.email, displayName: user.displayName }];
    },
    async listThreadsByOpportunity(id) { return Number(id) === 20 ? [linked] : []; },
    async findThreadById(id) { return Number(id) === 2 ? linked : Number(id) === 1 ? unlinked : null; },
    async findLatestThreadByOpportunity() { return linked; },
    async findLatestThreadByInquiry() { return unlinked; },
    async getThreadDetail(id) { return Number(id) === 2 ? linked : Number(id) === 1 ? unlinked : null; },
    async linkThreadToOpportunity(id, opportunityId) {
      if (Number(id) !== 1 || unlinked.opportunityId) return null;
      unlinked.opportunityId = Number(opportunityId);
      unlinked.opportunityNo = '800020';
      unlinked.opportunityTitle = 'Mixer Project';
      onLinkOpportunity?.(Number(id), Number(opportunityId));
      return unlinked;
    },
    async transitionThreadTriage(input) {
      if (unlinked.triageStatus !== input.expectedStatus) return null;
      unlinked.triageStatus = input.triageStatus;
      return unlinked;
    },
    async createTriageEvent(input) {
      unlinked.triageEvents.push(input);
      return input;
    },
    async getSpamCleanupSummary() { return spamCleanupSummary; },
    async listSpamPurgeCandidates() { return spamPurgeCandidates; },
    async isThreadPurgeEligible(id) { return purgeEligibleThreadIds.includes(Number(id)); },
    async purgeEmailThread(input) {
      if (!purgeEligibleThreadIds.includes(Number(input.threadId))) return null;
      onPurgeThread?.(input);
      return {
        threadId: Number(input.threadId),
        messageCount: 1,
        attachmentBytes: 0,
        rawMessageBytes: 0,
        attachmentPaths: [],
        rawMessagePaths: []
      };
    },
    async findAttachmentById(id) { return Number(id) === 21 ? unlinked.messages[0].attachments[0] : null; },
    async findMessageById(id) { return Number(id) === 11 ? unlinked.messages[0] : null; }
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'test-secret', csrfProtection: false, emailCenter: { enabled: true },
    customerEmail: { enabled: sendingEnabled, sharedAddress: 'sales@sunkaier.com', maxUploadMb: 25, smtp: {} }, uploadDir,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersByRole() { return []; }, async listUsersWithRoles() { return [user]; }
    },
    emailArchiveRepository: repository,
    opportunityRepository: {
      async getOpportunityDetail(id) {
        return Number(id) === 20 ? {
          id: 20, salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3,
          technicalManagerId: 6, commercialManagerId: 9, opportunityNo: '800020', title: 'Mixer Project'
        } : null;
      },
      async listOpportunities() { return linkableOpportunities; }
    },
    inquiryRepository: { async listInquiries() { return linkableInquiries; } },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return teamMembers; } },
    quotationPackageRepository: { async listByOpportunity() { return []; }, async getPackageDetail() { return null; } }
  });
  const agent = request.agent(app);
  if (language === 'zh') await agent.get('/language?lang=zh&returnTo=/login');
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return agent;
}

test('email center remains unavailable while the feature flag is disabled', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret', emailCenter: { enabled: false } });
  const response = await request(app).get('/email-center');
  assert.equal(response.status, 404);
});

test('enabled email center requires login', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret', emailCenter: { enabled: true } });
  const response = await request(app).get('/email-center');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('sales manager sees mailbox-separated pending threads and plain-text escaped message content', async () => {
  const agent = await createAgent({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    language: 'zh',
    linkableOpportunities: [{ id: 20, opportunityNo: '800020', title: 'Mixer Project' }],
    linkableInquiries: [{ id: 9, subject: 'Mixer inquiry', contactEmail: 'buyer@example.com', status: 'new' }]
  });
  const list = await agent.get('/email-center');
  assert.equal(list.status, 200);
  assert.match(list.text, /邮件中心/);
  assert.doesNotMatch(list.text, /业务邮件和附件永久保存在 CRM 归档中/);
  assert.doesNotMatch(list.text, /当前连接状态/);
  assert.match(list.text, /公共邮箱 · sales@sunkaier\.com/);
  assert.match(list.text, /class="email-folder-tab is-active"[^>]*aria-current="page"[^>]*>待处理<\/a>/);
  assert.match(list.text, /“待处理”指仍需人工判断的正常业务收件/);
  assert.match(list.text, /class="email-inbox-list"/);
  assert.match(list.text, /class="email-inbox-row" href="\/email-center\/threads\/1\?mailbox=sales%40sunkaier\.com&from=pending" title="打开会话"/);
  assert.match(list.text, /class="email-inbox-sender" title="buyer@example\.com">buyer@example\.com<\/span>/);
  assert.match(list.text, /class="email-inbox-preview" title="&lt;img src=x onerror=alert\(1\)&gt; Need quote"/);
  assert.match(list.text, /class="email-inbox-message-count" title="往来封数">\(2\)<\/span>/);
  assert.match(list.text, /class="email-inbox-attachment" title="附件数"><span aria-hidden="true">📎<\/span> 1<\/span>/);
  assert.doesNotMatch(list.text, /C000010|Acme Co|CT000020|Alice/);
  assert.match(list.text, /\.email-inbox-row\s*\{[\s\S]*font-size:\s*18px;[\s\S]*grid-template-columns:\s*minmax\(260px, 300px\) minmax\(0, 1fr\) 64px 168px;/);
  assert.match(list.text, /\.email-inbox-preview\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
  assert.match(list.text, /2026-09-03 09:00/);
  assert.doesNotMatch(list.text, /GMT\+0800|China Standard Time|09:00:00/);
  assert.match(list.text, />垃圾邮件<\/a>/);
  assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; RFQ/);
  assert.doesNotMatch(list.text, /<script>alert\(1\)<\/script>/);

  const detail = await agent.get('/email-center/threads/1');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /href="\/email-center\?mailbox=sales%40sunkaier\.com&folder=pending">← 返回邮件列表<\/a>/);
  assert.match(detail.text, /class="email-triage-grid-row"[\s\S]*?<button type="submit">人工分拣<\/button>[\s\S]*?<select name="assignedUserId"/);
  assert.match(detail.text, /<button type="submit">关联商机<\/button>[\s\S]*?<select name="opportunityId"/);
  assert.match(detail.text, /<button type="submit">关联询价<\/button>[\s\S]*?<select name="inquiryId"/);
  assert.match(detail.text, /class="email-triage-final-actions"[\s\S]*?转为询价[\s\S]*?标记为垃圾邮件/);
  assert.match(detail.text, /<summary>其他处理<\/summary>/);
  assert.match(detail.text, /class="email-conversation-list"/);
  assert.match(detail.text, /<details class="email-conversation-item email-message-inbound" open>/);
  assert.match(detail.text, /class="email-conversation-summary"/);
  assert.match(detail.text, /class="email-message-details"/);
  assert.match(detail.text, /class="email-attachment-chip" href="\/email-center\/attachments\/21\/download"/);
  assert.match(detail.text, /class="email-attachment-integrity"/);
  assert.match(detail.text, /&lt;script&gt;alert\(2\)&lt;\/script&gt; Need quote/);
  assert.doesNotMatch(detail.text, /tracker\.example\/pixel/);
  assert.match(detail.text, new RegExp('a'.repeat(64)));
});

test('email thread back action preserves its source folder', async () => {
  const agent = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh' });
  const detail = await agent.get('/email-center/threads/1?mailbox=sales%40sunkaier.com&from=sent');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /href="\/email-center\?mailbox=sales%40sunkaier\.com&folder=sent">← 返回邮件列表<\/a>/);
});

test('only an administrator sees and can invoke immediate permanent spam cleanup', async () => {
  const manager = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh' });
  const managerSpam = await manager.get('/email-center?mailbox=sales%40sunkaier.com&folder=spam');
  assert.equal(managerSpam.status, 200);
  assert.doesNotMatch(managerSpam.text, /垃圾邮件清理/);

  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh',
    spamCleanupSummary: {
      eligibleThreads: 3,
      messages: 4,
      attachments: 2,
      attachmentBytes: 1048576,
      rawMessages: 4,
      rawMessageBytes: 2097152
    }
  });
  const adminSpam = await administrator.get('/email-center?mailbox=sales%40sunkaier.com&folder=spam');
  assert.equal(adminSpam.status, 200);
  assert.match(adminSpam.text, /垃圾邮件清理/);
  assert.match(adminSpam.text, /可清理会话[^]*?<strong>3<\/strong>/);
  assert.match(adminSpam.text, /3\.0 MB/);
  assert.match(adminSpam.text, /name="confirmation"[^>]*pattern="DELETE"/);

  const rejected = await administrator.post('/email-center/spam/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    confirmation: 'delete'
  });
  assert.equal(rejected.status, 400);

  const accepted = await administrator.post('/email-center/spam/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    confirmation: 'DELETE'
  });
  assert.equal(accepted.status, 302);
  assert.match(accepted.headers.location, /folder=spam/);
});

test('administrator can delete an eligible unlinked thread but linked mail stays protected', async () => {
  const manager = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh' });
  const managerDetail = await manager.get('/email-center/threads/1');
  assert.equal(managerDetail.status, 200);
  assert.doesNotMatch(managerDetail.text, /彻底删除邮件/);

  const purgeCalls = [];
  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh',
    onPurgeThread: (input) => purgeCalls.push(input)
  });
  const unlinkedDetail = await administrator.get('/email-center/threads/1');
  assert.equal(unlinkedDetail.status, 200);
  assert.match(unlinkedDetail.text, /彻底删除邮件/);
  assert.match(unlinkedDetail.text, /action="\/email-center\/threads\/1\/purge"/);

  const linkedDetail = await administrator.get('/email-center/threads/2');
  assert.equal(linkedDetail.status, 200);
  assert.doesNotMatch(linkedDetail.text, /action="\/email-center\/threads\/2\/purge"/);

  const rejected = await administrator.post('/email-center/threads/1/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'pending',
    confirmation: 'delete'
  });
  assert.equal(rejected.status, 400);

  const accepted = await administrator.post('/email-center/threads/1/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'pending',
    confirmation: 'DELETE'
  });
  assert.equal(accepted.status, 302);
  assert.equal(accepted.headers.location, '/email-center?mailbox=sales%40sunkaier.com&folder=pending');
  assert.equal(purgeCalls.length, 1);
});

test('an authorized user can link an unlinked personal conversation to one visible opportunity', async () => {
  const linkedCalls = [];
  const agent = await createAgent({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    linkableOpportunities: [{ id: 20, opportunityNo: '800020', title: 'Mixer Project' }],
    onLinkOpportunity: (...args) => linkedCalls.push(args)
  });
  const detail = await agent.get('/email-center/threads/1');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /name="opportunityId"/);
  assert.match(detail.text, /800020 · Mixer Project/);

  const linked = await agent.post('/email-center/threads/1/opportunity').type('form').send({ opportunityId: 20 });
  assert.equal(linked.status, 302);
  assert.equal(linked.headers.location, '/email-center/threads/1?from=pending');
  assert.deepEqual(linkedCalls, [[1, 20]]);

  const relink = await agent.post('/email-center/threads/1/opportunity').type('form').send({ opportunityId: 21 });
  assert.equal(relink.status, 409);
});

test('email conversation opens the newest message without reply actions in the archive view', async () => {
  const agent = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh', sendingEnabled: true });
  const detail = await agent.get('/email-center/threads/2');

  assert.equal(detail.status, 200);
  assert.equal((detail.text.match(/class="email-conversation-item/g) || []).length, 2);
  assert.match(detail.text, /<details class="email-conversation-item email-message-outbound" open>/);
  assert.doesNotMatch(detail.text, /邮件回复/);
  assert.doesNotMatch(detail.text, /\/email-center\/compose\?threadId=2/);
  assert.doesNotMatch(detail.text, /\/email-center\/messages\/12\/send/);
  assert.match(detail.text, /C000010/);
  assert.match(detail.text, /CT000020/);
  assert.match(detail.text, /2026-09-03 10:00/);
});

test('salesperson sees assigned opportunity mail but direct unlinked mail access is forbidden', async () => {
  const agent = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON] });
  const list = await agent.get('/email-center');
  assert.equal(list.status, 200);
  assert.match(list.text, /\/email-center\/threads\/2\?mailbox=user7%40sunkaier\.com&from=pending/);
  assert.doesNotMatch(list.text, /Mixer Project|C000010|Acme Co|CT000020|Alice/);
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
  assert.doesNotMatch(salesCompose.text, /All customer email is sent through sales@sunkaier\.com/);
  assert.match(salesCompose.text, /opportunity-email-workspace/);
  assert.match(salesCompose.text, /opportunity-email-conversation/);
  assert.match(salesCompose.text, /opportunity-email-compose/);
  assert.match(salesCompose.text, /opportunity-email-timeline/);
  assert.match(salesCompose.text, /opportunity-email-message-inbound/);
  assert.match(salesCompose.text, /opportunity-email-message-outbound/);
  assert.match(salesCompose.text, /customer-email-header-fields/);
  assert.equal((salesCompose.text.match(/class="customer-email-header-field"/g) || []).length, 3);
  assert.match(salesCompose.text, /grid-template-columns: clamp\(220px, 18vw, 260px\) minmax\(0, 1fr\)/);
  assert.match(salesCompose.text, /\.opportunity-email-message\s*\{[\s\S]*?width: 100%/);
  assert.match(salesCompose.text, /customer-email-quotation-field/);
  assert.match(salesCompose.text, /inline-actions customer-email-actions/);
  assert.match(salesCompose.text, /\.customer-email-actions\s*\{\s*gap: 14px/);
  assert.match(salesCompose.text, />Formal quotation package</);
  assert.match(salesCompose.text, />Email signature preview</);
  assert.match(salesCompose.text, /customer-email-signature-preview/);
  assert.match(salesCompose.text, /aria-readonly="true"/);
  assert.match(salesCompose.text, /Best regards,/);
  assert.match(salesCompose.text, /User 7/);
  assert.match(salesCompose.text, /Project Engineer/);
  assert.match(salesCompose.text, /user7@sunkaier\.com/);
  assert.match(salesCompose.text, /mailto:user7@sunkaier\.com/);
  assert.match(salesCompose.text, /SUNKAIER Asia Pacific Pte\. Ltd\./);
  assert.match(salesCompose.text, /2 Venture Drive, #10-30, Vision Exchange, Singapore 608526/);
  assert.match(salesCompose.text, /src="\/assets\/sunkaier-logo-email\.png"/);
  assert.match(salesCompose.text, /CONFIDENTIALITY NOTICE:/);
  assert.match(salesCompose.text, /www\.sunkaier\.com/);
  assert.match(salesCompose.text, /data-customer-email-file-picker/);
  assert.match(salesCompose.text, />Attachments</);
  assert.doesNotMatch(salesCompose.text, />Additional attachments</);
  assert.match(salesCompose.text, />Choose files</);
  assert.match(salesCompose.text, />No files selected</);
  assert.match(salesCompose.text, /src="\/assets\/email-compose\.js"/);
  assert.match(salesCompose.text, /value="buyer@example\.com"/);
  assert.match(salesCompose.text, /Need quote/);
  assert.match(salesCompose.text, /Quotation sent/);
  assert.doesNotMatch(salesCompose.text, /placeholder="buyer@example\.com"/);

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
  assert.match(supportingCompose.text, />邮件签名预览</);
  assert.doesNotMatch(supportingCompose.text, /所有客户邮件统一通过 sales@sunkaier\.com 发出/);
  assert.match(supportingCompose.text, />附件</);
  assert.match(supportingCompose.text, />选择文件</);
  assert.match(supportingCompose.text, />未选择任何文件</);
  assert.match(supportingCompose.text, /value="draft"/);
  assert.doesNotMatch(supportingCompose.text, /value="send"/);
});
