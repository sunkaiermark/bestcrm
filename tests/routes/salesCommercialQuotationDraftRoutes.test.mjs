import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createAgent({ userId = 7, roles = [ROLES.SALESPERSON], archivedAt = null, sourceAvailable = true, existingDraft = null, standardTerms = [] } = {}) {
  const user = {
    id: userId, username: `user${userId}`, displayName: 'Test User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles
  };
  const opportunity = {
    id: 20, opportunityNo: '800020', title: 'Mixer Project', customerName: 'Acme',
    primaryContactName: 'Alex', salespersonId: 7, status: 'technical_solution_in_progress',
    salespersonDisplayName: 'Sales Owner', archivedAt, teamMembers: []
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
      async getByOpportunity() { return existingDraft; },
      async listPublishedStandardTerms(language) { return standardTerms.filter((term) => term.language === language); },
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
  const paymentTerm = { id: 91, key: 'payment', language: 'en', revisionNo: 1, title: 'Approved payment', body: 'Approved example text' };
  const { agent, calls } = await createAgent({ standardTerms: [paymentTerm] });
  const page = await agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>QUOTATION - BESTCRM<\/title>/);
  assert.match(page.text, /<h1>QUOTATION<\/h1><span class="draft-status-tag">Draft · Not issued<\/span>/);
  assert.doesNotMatch(page.text, /Internal Commercial Quotation Draft/);
  assert.match(page.text, /font: 20px\/1\.45 "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif;/);
  assert.match(page.text, /\.sales-quote-draft \.form-panel\s*\{[^}]*max-width:\s*none;[^}]*width:\s*100%;/);
  assert.match(page.text, /800020/);
  assert.match(page.text, /internal-technical-quote\.pdf/);
  assert.match(page.text, /Add row/);
  assert.match(page.text, /QUOTATION/);
  assert.match(page.text, /<div class="draft-document-title"><strong>QUOTATION<\/strong><\/div>/);
  assert.doesNotMatch(page.text, /Draft layout · not an issued quotation/);
  assert.match(page.text, /<span>Quote No\.<\/span><strong class="draft-pending">Not issued<\/strong>/);
  assert.match(page.text, /<span>Ref\.<\/span><strong>800020<\/strong>/);
  assert.match(page.text, /<h2 class="draft-section-title">CUSTOMER<\/h2>[\s\S]*<h2 class="draft-section-title">SUPPLIER<\/h2>/);
  assert.match(page.text, /<th scope="row">Company<\/th><td>Acme<\/td>/);
  assert.match(page.text, /<th scope="row">Attention<\/th><td>Alex<\/td>/);
  assert.match(page.text, /name="sellerEntityCode" form="sales-quote-draft-form"/);
  assert.match(page.text, /江苏胜开尔工业技术有限公司/);
  assert.match(page.text, /SUNKAIER ASIA PACIFIC PTE\. LTD\./);
  assert.match(page.text, /<th scope="row">Contact<\/th><td class="">Sales Owner<\/td>/);
  assert.match(page.text, /<th scope="row">Email<\/th><td>sales@sunkaier\.com<\/td>/);
  assert.doesNotMatch(page.text.split('<div class="draft-parties">')[1].split('</section>')[0], /<th scope="row">Project<\/th>/);
  assert.match(page.text, /<h2 class="draft-section-title">SUPPLIER<\/h2>[\s\S]*<div class="draft-project-info">[\s\S]*<tr class="draft-project-row"><th scope="row">Project<\/th><td>Mixer Project<\/td>[\s\S]*<h2 class="draft-section-title">Quoted items<\/h2>/);
  assert.match(page.text, /<th scope="row">Currency<\/th><td>[\s\S]*<input name="currency" form="sales-quote-draft-form"/);
  assert.doesNotMatch(page.text.split('<div class="draft-project-info">')[1].split('</div>')[0], /<th scope="row">Currency code \(draft\)<\/th>/);
  assert.match(page.text, /<h2 class="draft-section-title">Project information<\/h2>/);
  const projectTable = page.text.match(/<div class="draft-project-info">[\s\S]*?<table class="draft-detail-table"><tbody>([\s\S]*?)<\/tbody><\/table>/)?.[1];
  assert.ok(projectTable);
  assert.match(projectTable, /Technical quotation source[\s\S]*Version confirmation[\s\S]*<tr class="draft-project-row"><th scope="row">Project<\/th>/);
  assert.match(page.text, /\.draft-project-info \.draft-detail-table \{[^}]*table-layout: auto;/);
  assert.match(page.text, /\.draft-project-info \.draft-detail-table th \{[^}]*white-space: nowrap; width: 1%; \}/);
  assert.match(page.text, /\.draft-project-info \.draft-detail-table td \{ width: 99%; \}/);
  assert.match(page.text, /\.draft-commercial-terms \{ table-layout: auto; \}/);
  assert.match(page.text, /\.draft-commercial-terms th \{[^}]*white-space: nowrap; width: 1%; \}/);
  assert.match(page.text, /\.draft-commercial-terms td \{ width: 99%; \}/);
  assert.match(page.text, /<div class="draft-terms-scroll"><table class="draft-detail-table draft-commercial-terms">/);
  assert.match(page.text, /<table class="draft-detail-table draft-commercial-terms">/);
  assert.match(page.text, /name="term_payment" form="sales-quote-draft-form" data-standard-term-select/);
  assert.match(page.text, /Approved payment · R1/);
  assert.match(page.text, /No published standard wording/);
  assert.doesNotMatch(page.text, /Internal preparation source/);
  assert.match(page.text, /<table class="draft-lines-table">[\s\S]*<thead><tr><th scope="col">No\.<\/th><th scope="col">Description<\/th><th scope="col">Qty<\/th><th scope="col">Unit<\/th><th scope="col">Unit price<\/th><th scope="col">Amount<\/th><th scope="col">Include in total<\/th><th scope="col">Actions<\/th>/);
  assert.match(page.text, /data-draft-subtotal/);
  assert.match(page.text, /Commercial terms[\s\S]*Customer attachments[\s\S]*Signatory[\s\S]*Electronic signature/);
  assert.doesNotMatch(page.text, /Internal preparation only|Saving does not submit for review/);
  assert.doesNotMatch(page.text, /quotation-packages\/.*submit/);
  const save = await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on', currency: 'USD',
    sellerEntityCode: 'sunkaier_apac', term_payment: '91',
    description: ['Mixer', 'Seal'], quantity: ['1', '2'],
    unit: ['set', 'piece'], unitPrice: ['100', '20'], includeInTotal: ['included', 'excluded']
  });
  assert.equal(save.status, 302);
  assert.match(save.headers.location, /saved=1/);
  assert.equal(calls[0].lineItems.length, 2);
  assert.equal(calls[0].sellerEntityName, 'SUNKAIER ASIA PACIFIC PTE. LTD.');
  assert.deepEqual(calls[0].termSelections.payment, {
    id: 91, revisionNo: 1, language: 'en', title: 'Approved payment', body: 'Approved example text'
  });
  assert.deepEqual(calls[0].lineItems.map((line) => line.includeInTotal), ['included', 'excluded']);
});

test('Chinese quotation draft keeps QUOTATION as the title and aligns saved lines', async () => {
  const { agent } = await createAgent({ existingDraft: {
    draftRevisionNo: 2, sourceAttachmentId: 51, sourceSha256: 'a'.repeat(64),
    language: 'zh', currency: 'USD', lineItems: [
      { description: '设备', quantity: '1', unit: '套', unitPrice: '100', includeInTotal: 'included' },
      { description: '配件', quantity: '2', unit: '件', unitPrice: '20', includeInTotal: 'excluded' }
    ]
  } });
  await agent.get('/language?lang=zh&returnTo=/opportunities/20/commercial-quotation-draft');
  const page = await agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>QUOTATION<\/h1><span class="draft-status-tag">草稿 · 未签发<\/span>/);
  assert.doesNotMatch(page.text, /商务报价内部草稿/);
  assert.doesNotMatch(page.text, /仅供内部编制|保存不会提交审批/);
  assert.equal((page.text.match(/<tr class="draft-row">/g) || []).length, 2);
  assert.match(page.text, /<th scope="col">序号<\/th>[\s\S]*<th scope="col">产品说明<\/th>[\s\S]*<th scope="col">数量<\/th>[\s\S]*<th scope="col">单位<\/th>[\s\S]*<th scope="col">单价<\/th>[\s\S]*<th scope="col">金额<\/th>[\s\S]*<th scope="col">计入总价<\/th>/);
  assert.match(page.text, /<h2 class="draft-section-title">客户<\/h2>[\s\S]*<h2 class="draft-section-title">供应商<\/h2>/);
  assert.doesNotMatch(page.text.split('<div class="draft-parties">')[1].split('</section>')[0], /<th scope="row">项目<\/th>/);
  assert.match(page.text, /<div class="draft-project-info">[\s\S]*<tr class="draft-project-row"><th scope="row">项目<\/th><td>Mixer Project<\/td>[\s\S]*<h2 class="draft-section-title">报价明细<\/h2>/);
  assert.match(page.text, /<th scope="row">币种<\/th><td>[\s\S]*<input name="currency" form="sales-quote-draft-form"/);
  assert.doesNotMatch(page.text.split('<div class="draft-project-info">')[1].split('</div>')[0], /<th scope="row">币种代码（草稿）<\/th>/);
  assert.match(page.text, /<h2 class="draft-section-title">项目信息<\/h2>/);
  assert.match(page.text, /<span>报价编号<\/span><strong class="draft-pending">未签发<\/strong>/);
  assert.match(page.text, /正式签发仍须技术批准、公司已批准条款及电子签署/);
});

test('unknown seller or a standard term from another section cannot be saved', async () => {
  const { agent, calls } = await createAgent({ standardTerms: [
    { id: 91, key: 'payment', language: 'en', revisionNo: 1, title: 'Approved payment', body: 'Approved example text' }
  ] });
  const base = { sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on' };
  assert.equal((await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    ...base, sellerEntityCode: 'unknown'
  })).status, 400);
  assert.equal((await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    ...base, term_delivery: '91'
  })).status, 409);
  assert.equal(calls.length, 0);
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
