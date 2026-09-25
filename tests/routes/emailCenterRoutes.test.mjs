import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    classificationCategory: 'inquiry',
    archiveDisposition: 'active', triageStatus: 'pending', triageAssignedUserId: null, triageAssignedDisplayName: '', triageEvents: [],
    purgeBlockedReason: 'not_confirmed_for_deletion',
    lastMessageAt: '2026-09-03T01:00:00Z', messageCount: 1, attachmentCount: 1, lastFromAddress: 'buyer@example.com',
    lastTextPreview: '<img src=x onerror=alert(1)> Need quote', messages: [{
      id: 11, threadId: 1, direction: 'inbound', messageId: 'rfq@example.com', inReplyTo: '',
      referenceIds: [], fromAddress: 'buyer@example.com', fromName: 'Buyer',
      toRecipients: [{ address: 'sales@sunkaier.com' }], ccRecipients: [], subject: 'RFQ',
      textBody: '<script>alert(2)</script> Need quote', htmlBody: '<img src="cid:spec@example.com"><img src="cid:sunkaier-signature-logo@sunkaier.com" alt="SUNKAIER"><img src="https://tracker.example/pixel">',
      deliveryStatus: 'received', receivedAt: '2026-09-03T01:00:00Z', attachments: [{
        id: 21, messageId: 11, originalName: 'spec.pdf', storedPath: 'email-archive/spec.pdf',
        mimeType: 'application/pdf', fileSize: 4, sha256: 'a'.repeat(64), contentId: '<spec@example.com>'
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
  approvedOpportunityFiles = [],
  linkableOpportunities = [],
  onLinkOpportunity = null,
  onPurgeThread = null,
  onListThreads = null,
  spamCleanupSummary = { eligibleThreads: 0, messages: 0, attachments: 0, attachmentBytes: 0, rawMessages: 0, rawMessageBytes: 0 },
  nonBusinessCleanupSummary = { eligibleThreads: 0, messages: 0, attachments: 0, attachmentBytes: 0, rawMessages: 0, rawMessageBytes: 0 },
  spamPurgeCandidates = [],
  nonBusinessPurgeCandidates = [],
  unlinkedOverrides = {},
  linkedOverrides = {},
  additionalOpportunityThreads = []
}) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: userId, username: `user${userId}`, displayName: `User ${userId}`,
    emailSignatureName: `User ${userId}`, emailSignatureTitle: 'Project Engineer',
    email: `user${userId}@sunkaier.com`, passwordHash, isActive: true, roles
  };
  const unlinked = thread(unlinkedOverrides);
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
    triageStatus: 'linked_opportunity',
    purgeBlockedReason: 'linked_opportunity',
    ...linkedOverrides
  });
  const purgeEligible = (item) => !item.opportunityId;
  unlinked.purgeEligible = purgeEligible(unlinked);
  linked.purgeEligible = purgeEligible(linked);
  if (unlinked.purgeEligible) unlinked.purgeBlockedReason = '';
  if (linked.purgeEligible) linked.purgeBlockedReason = '';
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
  const opportunityThreads = [linked, ...additionalOpportunityThreads];
  const repository = {
    async listThreads(filter) {
      onListThreads?.(filter);
      return [unlinked, ...opportunityThreads];
    },
    async listActivePersonalMailboxAssignments() {
      return [{ userId: user.id, mailboxAddress: user.email, displayName: user.displayName }];
    },
    async listThreadsByOpportunity(id) { return Number(id) === 20 ? opportunityThreads : []; },
    async isOrphanedConvertedInquirySpamEligible(id) {
      return Number(id) === 1 && unlinked.orphanedSpamEligible !== false;
    },
    async findThreadById(id) {
      return Number(id) === 1
        ? unlinked
        : opportunityThreads.find((item) => Number(item.id) === Number(id)) || null;
    },
    async findLatestThreadByOpportunity() { return linked; },
    async findLatestThreadByInquiry() { return unlinked; },
    async getThreadDetail(id) {
      return Number(id) === 1
        ? unlinked
        : opportunityThreads.find((item) => Number(item.id) === Number(id)) || null;
    },
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
      unlinked.archiveDisposition = input.archiveDisposition;
      unlinked.purgeEligible = purgeEligible(unlinked);
      unlinked.purgeBlockedReason = unlinked.purgeEligible ? '' : 'linked_opportunity';
      return unlinked;
    },
    async createTriageEvent(input) {
      unlinked.triageEvents.push(input);
      return input;
    },
    async getCleanupSummary({ folder }) {
      return folder === 'non_business' ? nonBusinessCleanupSummary : spamCleanupSummary;
    },
    async listCleanupCandidates({ folder }) {
      return folder === 'non_business' ? nonBusinessPurgeCandidates : spamPurgeCandidates;
    },
    async isThreadPurgeEligible(id) {
      const item = Number(id) === linked.id ? linked : Number(id) === unlinked.id ? unlinked : null;
      return Boolean(item && !item.opportunityId);
    },
    async purgeEmailThread(input) {
      const item = Number(input.threadId) === linked.id ? linked : Number(input.threadId) === unlinked.id ? unlinked : null;
      if (!item || item.opportunityId) return null;
      onPurgeThread?.(input);
      return {
        threadId: Number(input.threadId),
        purgeAuditId: 900 + Number(input.threadId),
        fileJobCount: 0,
        messageCount: 1,
        attachmentBytes: 0,
        rawMessageBytes: 0
      };
    },
    async claimEmailPurgeFileJobs() { return []; },
    async completeEmailPurgeFileJob() { return true; },
    async failEmailPurgeFileJob() { return true; },
    async countEmailPurgeFileJobs() { return 0; },
    async findAttachmentById(id) { return Number(id) === 21 ? unlinked.messages[0].attachments[0] : null; },
    async findMessageById(id) {
      return [
        ...unlinked.messages,
        ...opportunityThreads.flatMap((item) => item.messages || [])
      ].find((message) => Number(message.id) === Number(id)) || null;
    }
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
    inquiryRepository: { async listInquiries() { return []; } },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return teamMembers; } },
    quotationPackageRepository: {
      async listByOpportunity() { return []; },
      async getPackageDetail() { return null; },
      async listApprovedEmailAttachmentChoices() { return approvedOpportunityFiles; }
    }
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

test('sales manager sees shared mailbox pending threads without a rule-category filter and plain-text escaped message content', async () => {
  let listFilter = null;
  const agent = await createAgent({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    language: 'zh',
    linkableOpportunities: [{ id: 20, opportunityNo: '800020', title: 'Mixer Project' }],
    onListThreads(filter) { listFilter = filter; }
  });
  const list = await agent.get('/email-center');
  assert.equal(list.status, 200);
  assert.match(list.text, /邮件中心/);
  assert.doesNotMatch(list.text, /业务邮件和附件永久保存在 CRM 归档中/);
  assert.doesNotMatch(list.text, /当前连接状态/);
  assert.match(list.text, /公共邮箱 · sales@sunkaier\.com/);
  assert.equal(listFilter?.archiveDisposition, 'active');
  assert.equal(listFilter?.direction, 'inbound');
  assert.equal(listFilter?.triageStatus, 'pending');
  assert.equal(listFilter?.triageStatuses, undefined);
  assert.match(list.text, /class="email-folder-tab is-active"[^>]*aria-current="page"[^>]*>待处理<\/a>/);
  assert.match(list.text, />收件箱<\/a>/);
  assert.match(list.text, />已发件箱<\/a>/);
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
  assert.match(list.text, />非业务邮件<\/a>/);
  assert.doesNotMatch(list.text, />已关联<\/a>|>已归档<\/a>/);
  assert.doesNotMatch(list.text, /<label for="email-category">规则分类<\/label>/);
  assert.doesNotMatch(list.text, /<form class="email-category-filter"/);
  assert.match(list.text, /class="email-category-badge">潜在询价<\/span>/);
  assert.match(list.text, /\.email-mailbox-picker label\s*\{[^}]*white-space:\s*nowrap;/);
  assert.doesNotMatch(list.text, /\.email-category-filter\s*\{/);
  assert.match(list.text, /\.email-folder-tabs\s*\{[^}]*gap:\s*16px;/);
  assert.match(list.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; RFQ/);
  assert.doesNotMatch(list.text, /<script>alert\(1\)<\/script>/);

  const detail = await agent.get('/email-center/threads/1');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /<main class="app-main email-reader-page">/);
  assert.match(detail.text, /class="email-reader-shell"[\s\S]*class="email-reader-head"[\s\S]*class="email-reader-scroll" tabindex="0"/);
  assert.match(detail.text, /\.app-main\.email-reader-page\s*\{[^}]*display:\s*flex;[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/);
  assert.match(detail.text, /\.email-reader-scroll\s*\{[^}]*overflow-y:\s*auto;/);
  assert.match(detail.text, /href="\/email-center\?mailbox=sales%40sunkaier\.com&folder=pending">← 返回邮件列表<\/a>/);
  assert.doesNotMatch(detail.text, /name="assignedUserId"|\/assignment/);
  assert.match(detail.text, /<button type="submit">关联商机<\/button>[\s\S]*?<select name="opportunityId"/);
  assert.match(detail.text, /class="email-pending-actions-row"[\s\S]*?关联商机[\s\S]*?选择商机[\s\S]*?新建线索[\s\S]*?标记为垃圾邮件/);
  assert.match(detail.text, /href="\/lead-submissions\/new\?emailThreadId=1"/);
  assert.doesNotMatch(detail.text, /新建商机|标记为非业务邮件/);
  assert.doesNotMatch(detail.text, /关联询价|转为询价|name="inquiryId"|convert-inquiry/);
  assert.doesNotMatch(detail.text, /<summary>其他处理<\/summary>/);
  assert.match(detail.text, /class="email-conversation-list"/);
  assert.match(detail.text, /<details class="email-conversation-item email-message-inbound" open>/);
  assert.match(detail.text, /class="email-conversation-summary"/);
  assert.match(detail.text, /class="email-message-details"/);
  assert.match(detail.text, /class="email-html-body" src="\/email-center\/messages\/11\/content" sandbox="allow-same-origin"/);
  assert.match(detail.text, /class="email-plain-body email-reading-body"/);
  assert.match(detail.text, /\.email-reading-body\s*\{[^}]*max-width:\s*none;/);
  assert.match(detail.text, /@media[\s\S]*\.email-conversation-body\s*\{[^}]*padding:\s*14px;/);
  assert.match(detail.text, /class="email-attachment-chip" href="\/email-center\/attachments\/21\/download"/);
  assert.match(detail.text, /class="email-attachment-integrity"/);
  assert.match(detail.text, /&lt;script&gt;alert\(2\)&lt;\/script&gt; Need quote/);
  assert.doesNotMatch(detail.text, /tracker\.example\/pixel/);
  assert.match(detail.text, new RegExp('a'.repeat(64)));

  const htmlContent = await agent.get('/email-center/messages/11/content');
  assert.equal(htmlContent.status, 200);
  assert.match(htmlContent.headers['content-security-policy'], /sandbox allow-same-origin; default-src 'none'; img-src 'self' data:/);
  assert.match(htmlContent.headers['content-security-policy'], /script-src 'none'/);
  assert.equal(htmlContent.headers['referrer-policy'], 'no-referrer');
  assert.match(htmlContent.text, /src="\/email-center\/attachments\/21\/inline"/);
  assert.match(htmlContent.text, /src="\/assets\/sunkaier-logo-email\.png"/);
  assert.doesNotMatch(htmlContent.text, /cid:spec@example\.com/);
  assert.match(htmlContent.text, /https:\/\/tracker\.example\/pixel/);

  assert.equal((await agent.post('/email-center/threads/1/inquiry')).status, 404);
  assert.equal((await agent.post('/email-center/threads/1/convert-inquiry')).status, 404);
});

test('inbox provides server-side search and preserves the query on return', async () => {
  let listFilter = null;
  const agent = await createAgent({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    language: 'zh',
    onListThreads(filter) { listFilter = filter; }
  });

  const list = await agent.get(
    '/email-center?mailbox=sales%40sunkaier.com&folder=inbox&category=newsletter&q=%20buyer%40example.com%20'
  );

  assert.equal(list.status, 200);
  assert.equal(listFilter?.classificationCategory, '');
  assert.equal(listFilter?.searchTerm, 'buyer@example.com');
  assert.doesNotMatch(list.text, /<form class="email-category-filter"/);
  assert.doesNotMatch(list.text, /<label for="email-category">规则分类<\/label>/);
  assert.match(list.text, /<div class="email-center-toolbar is-sticky">/);
  assert.match(list.text, /\.email-center-toolbar\.is-sticky\s*\{[^}]*position: sticky;[^}]*top: 0;/);
  assert.match(list.text, /<form class="email-search-filter has-inbox-search" method="get" action="\/email-center">/);
  assert.match(list.text, /<label for="email-search">搜索<\/label>/);
  assert.match(list.text, /name="q" type="search" value="buyer@example\.com"[^>]*placeholder="发件人、邮箱、主题、商机号等"/);
  assert.match(list.text, /<button type="submit">查询<\/button>/);
  assert.match(list.text, /<span class="email-search-total">邮件总数： <strong>2<\/strong><\/span>/);
  const searchInputPosition = list.text.indexOf('id="email-search"');
  const searchButtonPosition = list.text.indexOf('<button type="submit">查询</button>', searchInputPosition);
  const totalPosition = list.text.indexOf('class="email-search-total"', searchButtonPosition);
  const categoryPosition = list.text.indexOf('id="email-product-category"', searchButtonPosition);
  assert.ok(searchInputPosition > 0 && searchButtonPosition > searchInputPosition && totalPosition > searchButtonPosition && categoryPosition > totalPosition);
  assert.match(list.text, /href="\/email-center\?mailbox=sales%40sunkaier\.com&folder=inbox">清除筛选<\/a>/);
  assert.match(list.text, /from=inbox&amp;q=buyer%40example\.com/);
  assert.doesNotMatch(list.text, /folder=inbox(?:&|&amp;)category=/);

  const detail = await agent.get(
    '/email-center/threads/2?mailbox=sales%40sunkaier.com&from=inbox&category=newsletter&q=800020'
  );
  assert.equal(detail.status, 200);
  assert.match(detail.text, /href="\/email-center\?mailbox=sales%40sunkaier\.com&folder=inbox&amp;q=800020">← 返回邮件列表<\/a>/);
  assert.doesNotMatch(detail.text, /folder=inbox(?:&|&amp;)category=/);
});

test('pending and sent folder links remain available and preserve their source folder', async () => {
  const agent = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh' });
  for (const retainedFolder of ['pending', 'sent']) {
    const detail = await agent.get(`/email-center/threads/1?mailbox=sales%40sunkaier.com&from=${retainedFolder}`);
    assert.equal(detail.status, 200);
    assert.match(
      detail.text,
      new RegExp(`href="\\/email-center\\?mailbox=sales%40sunkaier\\.com&folder=${retainedFolder}">← 返回邮件列表<\\/a>`)
    );
  }
});

test('email content restores a historically truncated body from immutable raw EML', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-content-'));
  try {
    const storedPath = 'email-raw/truncated.eml';
    const raw = Buffer.from([
      'Message-ID: <complete@example.com>',
      'From: Buyer <buyer@example.com>',
      'To: sales@sunkaier.com',
      'Subject: Complete body',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>Beginning</p><table><tr><td>RECOVERED-END-OF-MESSAGE</td></tr></table></body></html>'
    ].join('\r\n'));
    await mkdir(path.join(uploadDir, 'email-raw'), { recursive: true });
    await writeFile(path.join(uploadDir, storedPath), raw);
    const originalMessage = thread().messages[0];
    const agent = await createAgent({
      userId: 2,
      roles: [ROLES.SALES_MANAGER],
      uploadDir,
      unlinkedOverrides: {
        messages: [{
          ...originalMessage,
          textBody: 'Beginning\n[truncated]',
          htmlBody: '<html><body><p>Beginning<!-- truncated -->',
          rawEmlStoredPath: storedPath,
          rawEmlSha256: createHash('sha256').update(raw).digest('hex'),
          attachments: []
        }]
      }
    });

    const content = await agent.get('/email-center/messages/11/content');
    assert.equal(content.status, 200);
    assert.equal(content.headers['x-email-content-source'], 'raw-archive');
    assert.match(content.text, /RECOVERED-END-OF-MESSAGE/);
    assert.doesNotMatch(content.text, /<!-- truncated -->/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
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
    unlinkedOverrides: { triageStatus: 'spam', archiveDisposition: 'spam' },
    linkedOverrides: { triageStatus: 'spam', archiveDisposition: 'spam' },
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
  assert.doesNotMatch(adminSpam.text, /管理员可永久删除当前垃圾邮件列表/);
  assert.doesNotMatch(adminSpam.text, /可永久删除的垃圾邮件会话/);
  assert.doesNotMatch(adminSpam.text, /3\.0 MB/);
  assert.match(adminSpam.text, /class="form-panel email-spam-cleanup is-compact"/);
  assert.match(adminSpam.text, /<span>输入：DELETE<\/span>/);
  assert.match(adminSpam.text, /name="confirmation"[^>]*pattern="DELETE"/);
  assert.match(adminSpam.text, /<button class="danger-action" type="submit">确认永久删除<\/button>/);
  assert.match(adminSpam.text, /class="danger-action email-spam-row-delete" href="\/email-center\/threads\/1[^>]*>永久删除<\/a>/);
  assert.doesNotMatch(adminSpam.text, /href="\/email-center\/threads\/2[^>]*#email-delete/);
  assert.match(adminSpam.text, /email-spam-row-delete" type="button" disabled>永久删除<\/button>/);
  assert.match(adminSpam.text, /请先删除关联商机/);

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

test('pending and sent no longer expose the advisory rule-category filter while every folder ignores the retired query', async () => {
  let listFilter = null;
  const manager = await createAgent({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    language: 'zh',
    onListThreads(filter) { listFilter = filter; },
    unlinkedOverrides: {
      classificationCategory: 'marketing_spam',
      triageStatus: 'spam',
      archiveDisposition: 'spam'
    }
  });

  for (const folder of ['pending', 'inbox', 'sent', 'spam', 'non_business']) {
    const response = await manager.get(
      `/email-center?mailbox=sales%40sunkaier.com&folder=${folder}&category=marketing_spam`
    );

    assert.equal(response.status, 200);
    assert.equal(listFilter?.classificationCategory, '');
    assert.doesNotMatch(response.text, /<form class="email-category-filter"/);
    assert.doesNotMatch(response.text, /<label for="email-category">规则分类<\/label>/);
    assert.doesNotMatch(response.text, new RegExp(`folder=${folder}&category=`));
    assert.match(response.text, /class="email-category-badge">营销垃圾邮件<\/span>/);
    assert.match(response.text, />待处理<\/a>/);
    assert.match(response.text, />已发件箱<\/a>/);
  }
});

test('administrator can clean eligible non-business mail and restore a mistaken classification', async () => {
  const purgeCalls = [];
  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh',
    nonBusinessCleanupSummary: {
      eligibleThreads: 1,
      messages: 1,
      attachments: 1,
      attachmentBytes: 1048576,
      rawMessages: 1,
      rawMessageBytes: 1048576
    },
    nonBusinessPurgeCandidates: [{ threadId: 1, subject: 'System notice' }],
    onPurgeThread: (input) => purgeCalls.push(input)
  });

  const marked = await administrator.post('/email-center/threads/1/disposition').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'inbox',
    action: 'non_business'
  });
  assert.equal(marked.status, 302);

  const list = await administrator.get('/email-center?mailbox=sales%40sunkaier.com&folder=non_business');
  assert.equal(list.status, 200);
  assert.doesNotMatch(list.text, /管理员可永久删除符合条件的非业务邮件/);
  assert.doesNotMatch(list.text, /可永久删除的非业务邮件会话/);
  assert.doesNotMatch(list.text, /2\.0 MB/);
  assert.match(list.text, /<span>输入：DELETE<\/span>/);
  assert.match(list.text, /action="\/email-center\/non_business\/purge"/);
  assert.match(list.text, /<button class="danger-action" type="submit">确认永久删除<\/button>/);
  assert.match(list.text, /href="\/email-center\/threads\/1\?mailbox=sales%40sunkaier\.com&from=non_business[^>]*>永久删除<\/a>/);

  const detail = await administrator.get('/email-center/threads/1?mailbox=sales%40sunkaier.com&from=non_business');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /如果该邮件实际与客户业务有关/);
  assert.match(detail.text, /name="action" value="restore"/);

  const restored = await administrator.post('/email-center/threads/1/disposition').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'non_business',
    action: 'restore'
  });
  assert.equal(restored.status, 302);

  const remade = await administrator.post('/email-center/threads/1/disposition').type('form').send({
    action: 'non_business'
  });
  assert.equal(remade.status, 302);
  const purged = await administrator.post('/email-center/non_business/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    confirmation: 'DELETE'
  });
  assert.equal(purged.status, 302);
  assert.match(purged.headers.location, /folder=non_business/);
  assert.equal(purgeCalls.length, 1);
});

test('administrator can delete unlinked non-business mail while opportunity-linked mail stays blocked', async () => {
  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh',
    unlinkedOverrides: {
      triageStatus: 'archived',
      archiveDisposition: 'archived',
      purgeBlockedReason: 'has_outbound_message'
    },
    linkedOverrides: {
      triageStatus: 'archived',
      archiveDisposition: 'archived',
      purgeBlockedReason: 'linked_opportunity'
    }
  });

  const list = await administrator.get('/email-center?mailbox=sales%40sunkaier.com&folder=non_business');

  assert.equal(list.status, 200);
  assert.match(list.text, /<span>输入：DELETE<\/span>/);
  assert.match(list.text, /name="confirmation"[^>]*pattern="DELETE"/);
  assert.doesNotMatch(list.text, /name="confirmation"[^>]*disabled/);
  assert.match(list.text, /<button class="danger-action" type="submit">确认永久删除<\/button>/);
  assert.doesNotMatch(list.text, /当前列表没有符合永久删除条件的邮件/);
  assert.equal((list.text.match(/email-spam-row-delete" href=/g) || []).length, 1);
  assert.equal((list.text.match(/email-spam-row-delete" type="button" disabled/g) || []).length, 1);
  assert.match(list.text, /href="\/email-center\/threads\/1[^>]*#email-delete"/);
  assert.doesNotMatch(list.text, /href="\/email-center\/threads\/2[^>]*#email-delete"/);
  assert.match(list.text, /请先删除关联商机/);

  const linkedDetail = await administrator.get('/email-center/threads/2?mailbox=sales%40sunkaier.com&from=non_business');
  assert.equal(linkedDetail.status, 200);
  assert.doesNotMatch(linkedDetail.text, /id="email-delete"/);
  assert.doesNotMatch(linkedDetail.text, /彻底删除邮件|请先删除关联商机，再永久删除该邮件/);
});

test('administrator can move an orphaned converted inquiry from Inbox to Spam for permanent cleanup', async () => {
  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    unlinkedOverrides: {
      triageStatus: 'converted_inquiry',
      archiveDisposition: 'active',
      inquiryId: null,
      opportunityId: null,
      customerId: null,
      contactId: null
    }
  });

  const inboxDetail = await administrator.get('/email-center/threads/1?mailbox=sales%40sunkaier.com&from=inbox');
  assert.equal(inboxDetail.status, 200);
  assert.match(inboxDetail.text, /email-orphaned-inquiry-spam-panel/);
  assert.match(inboxDetail.text, /name="action" value="spam"/);
  assert.doesNotMatch(inboxDetail.text, /href="\/lead-submissions\/new\?emailThreadId=1"/);

  const marked = await administrator.post('/email-center/threads/1/disposition').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'inbox',
    action: 'spam'
  });
  assert.equal(marked.status, 302);
  assert.equal(marked.headers.location, '/email-center/threads/1?mailbox=sales%40sunkaier.com&from=inbox');

  const spamDetail = await administrator.get('/email-center/threads/1?mailbox=sales%40sunkaier.com&from=spam');
  assert.equal(spamDetail.status, 200);
  assert.match(spamDetail.text, /action="\/email-center\/threads\/1\/purge"/);
  assert.match(spamDetail.text, /name="confirmation"[^>]*pattern="DELETE"/);
});

test('orphaned converted mail with historical business dependencies cannot be marked as spam', async () => {
  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    unlinkedOverrides: {
      triageStatus: 'converted_inquiry',
      archiveDisposition: 'active',
      orphanedSpamEligible: false
    }
  });
  const detail = await administrator.get('/email-center/threads/1');
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /email-orphaned-inquiry-spam-panel/);
  const attempted = await administrator.post('/email-center/threads/1/disposition')
    .type('form').send({ action: 'spam' });
  assert.equal(attempted.status, 409);
});

test('administrator can delete active inbox mail without reclassification but opportunity-linked mail stays protected', async () => {
  const manager = await createAgent({ userId: 2, roles: [ROLES.SALES_MANAGER], language: 'zh' });
  const managerDetail = await manager.get('/email-center/threads/1');
  assert.equal(managerDetail.status, 200);
  assert.doesNotMatch(managerDetail.text, /彻底删除邮件/);

  const purgeCalls = [];
  const administrator = await createAgent({
    userId: 1,
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh',
    linkableOpportunities: [{ id: 20, opportunityNo: '800020', title: 'Mixer Project' }],
    onPurgeThread: (input) => purgeCalls.push(input)
  });
  const unlinkedDetail = await administrator.get('/email-center/threads/1');
  assert.equal(unlinkedDetail.status, 200);
  assert.match(unlinkedDetail.text, /action="\/email-center\/threads\/1\/purge"/);
  assert.match(unlinkedDetail.text, /id="email-delete"/);
  assert.match(unlinkedDetail.text, /class="email-pending-actions-row"[\s\S]*?关联商机[\s\S]*?选择商机[\s\S]*?新建线索[\s\S]*?标记为垃圾邮件[\s\S]*?placeholder="DELETE"[\s\S]*?永久删除/);
  assert.doesNotMatch(unlinkedDetail.text, /管理员可永久删除未关联商机的邮件会话|受保护的未关联邮件|标记为非业务邮件/);

  const linkedDetail = await administrator.get('/email-center/threads/2?from=inbox');
  assert.equal(linkedDetail.status, 200);
  assert.doesNotMatch(linkedDetail.text, /action="\/email-center\/threads\/2\/purge"/);
  assert.doesNotMatch(linkedDetail.text, /id="email-delete"/);
  assert.doesNotMatch(linkedDetail.text, /彻底删除邮件|请先删除关联商机/);

  const rejected = await administrator.post('/email-center/threads/1/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'inbox',
    confirmation: 'delete'
  });
  assert.equal(rejected.status, 400);

  const deletedInbox = await administrator.post('/email-center/threads/1/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'inbox',
    q: 'old sender',
    confirmation: 'DELETE'
  });
  assert.equal(deletedInbox.status, 302);
  assert.equal(deletedInbox.headers.location, '/email-center?mailbox=sales%40sunkaier.com&folder=inbox&q=old+sender');

  const blockedLinked = await administrator.post('/email-center/threads/2/purge').type('form').send({
    mailbox: 'sales@sunkaier.com',
    from: 'inbox',
    confirmation: 'DELETE'
  });
  assert.equal(blockedLinked.status, 409);
  assert.equal(purgeCalls.length, 1);
  assert.match(purgeCalls[0].reason, /unrestricted permanent deletion/);
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
  const inbox = await agent.get('/email-center?folder=inbox');
  assert.equal(inbox.status, 200);
  assert.match(inbox.text, /<span class="email-search-total">Total emails: <strong>1<\/strong><\/span>/);
  assert.match(list.text, /Shared mailbox · sales@sunkaier\.com/);
  assert.doesNotMatch(list.text, /Personal mailbox/);
  assert.match(list.text, /\/email-center\/threads\/2\?mailbox=sales%40sunkaier\.com&from=pending/);
  assert.doesNotMatch(list.text, /Mixer Project|C000010|Acme Co|CT000020|Alice/);
  assert.doesNotMatch(list.text, /Protected unlinked email/);
  assert.equal((await agent.get('/email-center/threads/1')).status, 403);
  const detail = await agent.get('/email-center/threads/2');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /C000010 · Acme Co/);
  assert.match(detail.text, /CT000020 · Alice/);
});

test('an opportunity stakeholder can open linked personal-mail history while unlinked personal mail remains private', async () => {
  const personalMailbox = {
    mailboxKey: 'user7@sunkaier.com',
    mailboxKeys: ['user7@sunkaier.com'],
    mailboxOwnerUserId: 7,
    mailboxOwnerUserIds: [7],
    hasSharedMailboxDelivery: false
  };
  const manager = await createAgent({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    unlinkedOverrides: personalMailbox,
    linkedOverrides: personalMailbox
  });

  assert.equal((await manager.get('/email-center/threads/1')).status, 403);
  const linkedDetail = await manager.get('/email-center/threads/2');
  assert.equal(linkedDetail.status, 200);
  assert.match(linkedDetail.text, /Mixer Project/);
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

    const inline = await manager.get('/email-center/attachments/21/inline');
    assert.equal(inline.status, 200);
    assert.match(inline.headers['content-disposition'], /^inline;.*spec\.pdf/);
    assert.equal(inline.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(inline.headers['x-archive-sha256'], 'a'.repeat(64));

    const salesperson = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON], uploadDir });
    assert.equal((await salesperson.get('/email-center/attachments/21/download')).status, 403);
    assert.equal((await salesperson.get('/email-center/attachments/21/inline')).status, 403);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('compose route is separately disabled until customer SMTP sending is enabled', async () => {
  const agent = await createAgent({ userId: 7, roles: [ROLES.SALESPERSON] });
  assert.equal((await agent.get('/email-center/compose?opportunityId=20')).status, 404);
});

test('compose page shows send only to an authorized opportunity member and remains bilingual', async () => {
  const salesperson = await createAgent({
    userId: 7,
    roles: [ROLES.SALESPERSON],
    sendingEnabled: true,
    approvedOpportunityFiles: [{
      token: 'technical_document:61', category: 'technical', versionLabel: 'TS-V2',
      fileType: 'datasheet', originalName: 'Mixer_Datasheet.pdf', byteSize: 4096
    }, {
      token: 'opportunity_attachment:71', category: 'commercial', versionLabel: 'CQ-V3',
      fileType: 'commercial_quote', originalName: 'Commercial_Quote.pdf', byteSize: 8192
    }]
  });
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
  assert.match(salesCompose.text, /class="email-html-body" src="\/email-center\/messages\/11\/content" sandbox="allow-same-origin"/);
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
  assert.match(salesCompose.text, />Upload local files</);
  assert.match(salesCompose.text, />Choose from opportunity files</);
  assert.doesNotMatch(salesCompose.text, /Only approved files from this opportunity are available/);
  assert.match(salesCompose.text, /name="approvedOpportunityFileTokens" value="technical_document:61"/);
  assert.match(salesCompose.text, /name="approvedOpportunityFileTokens" value="opportunity_attachment:71"/);
  assert.match(salesCompose.text, /Mixer_Datasheet\.pdf/);
  assert.match(salesCompose.text, /Commercial_Quote\.pdf/);
  assert.match(salesCompose.text, /25 MB total across all attachments/);
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
  assert.match(supportingCompose.text, />上传本地文件</);
  assert.match(supportingCompose.text, />从商机文件选择</);
  assert.match(supportingCompose.text, /25 MB，全部附件合计/);
  assert.match(supportingCompose.text, />未选择任何文件</);
  assert.match(supportingCompose.text, /value="draft"/);
  assert.doesNotMatch(supportingCompose.text, /value="send"/);
});

test('reply entry requires choosing a conversation when an opportunity has multiple email threads', async () => {
  const secondThread = thread({
    id: 3,
    opportunityId: 20,
    opportunityNo: '800020',
    opportunityTitle: 'Mixer Project',
    customerId: 10,
    contactId: 20,
    subject: 'Commercial terms',
    triageStatus: 'linked_opportunity',
    lastMessageAt: '2026-09-04T01:00:00Z',
    lastFromAddress: 'buyer@example.com',
    messages: [{
      id: 13,
      threadId: 3,
      direction: 'inbound',
      messageId: 'commercial-terms@example.com',
      inReplyTo: '',
      referenceIds: [],
      fromAddress: 'buyer@example.com',
      fromName: 'Buyer',
      toRecipients: [{ address: 'sales@sunkaier.com' }],
      ccRecipients: [],
      subject: 'Commercial terms',
      textBody: 'Please confirm payment terms.',
      htmlBody: '',
      deliveryStatus: 'received',
      receivedAt: '2026-09-04T01:00:00Z',
      attachments: [],
      deliveryAttempts: []
    }]
  });
  const agent = await createAgent({
    userId: 7,
    roles: [ROLES.SALESPERSON],
    sendingEnabled: true,
    additionalOpportunityThreads: [secondThread]
  });

  const selection = await agent.get('/email-center/compose?opportunityId=20&chooseThread=1');
  assert.equal(selection.status, 200);
  assert.match(selection.text, /Select an email conversation before replying/);
  assert.match(selection.text, /href="\/email-center\/compose\?threadId=2"/);
  assert.match(selection.text, /href="\/email-center\/compose\?threadId=3"/);
  assert.doesNotMatch(selection.text, /<form class="form-panel" method="post" action="\/email-center\/messages"/);

  const selected = await agent.get('/email-center/compose?threadId=3');
  assert.equal(selected.status, 200);
  assert.match(selected.text, /<input type="hidden" name="threadId" value="3">/);
  assert.match(selected.text, /<form class="form-panel" method="post" action="\/email-center\/messages"/);
});
