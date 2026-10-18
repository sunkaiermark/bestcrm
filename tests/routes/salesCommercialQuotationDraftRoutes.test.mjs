import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createAgent({ userId = 7, username = `user${userId}`, roles = [ROLES.SALESPERSON], archivedAt = null, commercialManagerId = null, quotationEngineerId = 3, sourceAvailable = true, existingDraft = null, standardTerms = [], formalVersions = [], customerContacts, quotationPreviewPdfRenderer, quotationSigning } = {}) {
  const user = {
    id: userId, username, displayName: 'Test User',
    passwordHash: await hashPassword('ChangeMe123!'), isActive: true, roles,
    phone: '+65 6000 0000', emailSignatureName: 'Test Sales',
    representedCompanyCode: 'sunkaier_apac'
  };
  const opportunity = {
    id: 20, opportunityNo: '800020', title: 'Mixer Project', customerId: 30, customerName: 'Acme',
    customerCoordinatorUserId: 7,
    primaryContactId: 501, primaryContactName: 'Alex', salespersonId: 7, quotationEngineerId, status: 'technical_solution_in_progress',
    salespersonDisplayName: 'Sales Owner', commercialManagerId, archivedAt, teamMembers: []
  };
  const source = {
    technicalDraftId: 41, technicalDraftRevisionNo: 2, attachmentId: 51,
    originalName: 'internal-technical-quote.pdf', sha256: 'a'.repeat(64), technicalStatus: 'ready'
  };
  const calls = [];
  const contacts = customerContacts || [
    { id: 501, contactCode: 'L000501', customerId: 30, name: 'Alex', title: 'Purchasing', phone: '+1 555 0101', email: 'alex@example.com' },
    { id: 502, contactCode: 'L000502', customerId: 30, name: 'Casey', title: 'Director', phone: '+1 555 0102', email: 'casey@example.com' }
  ];
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
    contactRepository: {
      async listContacts(filter) {
        return contacts.filter((contact) => Number(contact.customerId) === Number(filter.customerId));
      }
    },
    quotationPreviewPdfRenderer,
    ...(quotationSigning ? { quotationSigning } : {}),
    salesCommercialQuotationDraftRepository: {
      async getByOpportunity() { return existingDraft; },
      async listFormalVersions() { return formalVersions; },
      async getFormalVersion(id) { return formalVersions.find((version) => version.id === Number(id)) || null; },
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
  const balancePaymentTerm = { id: 92, key: 'payment', language: 'en', revisionNo: 2, title: 'Deposit and balance', body: 'Approved staged payment text' };
  const { agent, calls } = await createAgent({ standardTerms: [paymentTerm, balancePaymentTerm] });
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
  assert.match(page.text, /<span>Quote date<\/span><strong class="draft-pending">Not issued<\/strong>/);
  assert.match(page.text, /<h2 class="draft-section-title">CUSTOMER<\/h2>[\s\S]*<h2 class="draft-section-title">SUPPLIER<\/h2>/);
  assert.match(page.text, /<th scope="row">Company<\/th><td>Acme<\/td>/);
  const attentionSelect = page.text.match(/<select name="customerContactId"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(attentionSelect);
  assert.match(attentionSelect, /value="501" data-phone="\+1 555 0101" data-email="alex@example\.com" selected>L000501 · Alex · Purchasing/);
  assert.match(attentionSelect, /value="502" data-phone="\+1 555 0102" data-email="casey@example\.com" >L000502 · Casey · Director/);
  assert.match(page.text, /<th scope="row">Telephone<\/th><td data-customer-contact-phone class="">\+1 555 0101<\/td>/);
  assert.match(page.text, /<th scope="row">Email<\/th><td data-customer-contact-email class="">alex@example\.com<\/td>/);
  assert.doesNotMatch(page.text, /<th scope="row">Valid until<\/th>/);
  assert.match(page.text, /name="sellerEntityCode" form="sales-quote-draft-form"/);
  assert.match(page.text, /江苏胜开尔工业技术有限公司/);
  assert.match(page.text, /SUNKAIER ASIA PACIFIC PTE\. LTD\./);
  assert.match(page.text, /value="sunkaier_apac"[^>]*selected/);
  assert.match(page.text, /<th scope="row">Contact<\/th><td class="">Test Sales<\/td>/);
  assert.match(page.text, /<th scope="row">Telephone<\/th><td[^>]*>\+65 6000 0000<\/td>/);
  assert.match(page.text, /<th scope="row">Email<\/th><td>sales@sunkaier\.com<\/td>/);
  assert.match(page.text, /2 Venture Drive, #10-30, Vision Exchange, Singapore 608526/);
  assert.match(page.text, /https:\/\/www\.sunkaier\.com/);
  assert.doesNotMatch(page.text.split('<div class="draft-parties">')[1].split('</section>')[0], /<th scope="row">Project<\/th>/);
  assert.match(page.text, /<h2 class="draft-section-title">SUPPLIER<\/h2>[\s\S]*<div class="draft-project-info">[\s\S]*<tr class="draft-project-row"><th scope="row">Project<\/th><td>Mixer Project<\/td>[\s\S]*<h2 class="draft-section-title">Quoted items<\/h2>/);
  assert.match(page.text, /<th scope="row">Currency<\/th><td>[\s\S]*<select name="currency" form="sales-quote-draft-form"/);
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
  assert.match(page.text, /data-term-edit-button[^>]*>Edit<\/button>/);
  assert.match(page.text, /name="term_payment_body" form="sales-quote-draft-form" data-term-body-input/);
  assert.match(page.text, /data-term-editor hidden/);
  assert.match(page.text, />Approved example text<\/option>/);
  assert.match(page.text, />Approved staged payment text<\/option>/);
  assert.match(page.text, />Delivery shall be made within \[Delivery Period\] after receipt of the advance payment and approval of the technical documents\.<\/option>/);
  assert.doesNotMatch(page.text, /Internal preparation source/);
  assert.match(page.text, /<table class="draft-lines-table">[\s\S]*<thead><tr><th scope="col">No\.<\/th><th scope="col">Description<\/th><th scope="col">Qty<\/th><th scope="col">Unit<\/th><th scope="col">Unit price<\/th><th scope="col">Amount<\/th><th scope="col"><span class="visually-hidden">Actions<\/span><\/th>/);
  assert.doesNotMatch(page.text, /Include in total|name="includeInTotal"/);
  assert.match(page.text, /class="secondary-action draft-remove-row"[^>]*aria-label="Remove this row"[^>]*>&minus;<\/button>/);
  assert.match(page.text, /data-draft-subtotal/);
  assert.match(page.text, /name="taxRate"/);
  assert.match(page.text, /data-draft-tax-amount/);
  assert.match(page.text, /data-draft-grand-total/);
  assert.match(page.text, />30% advance, 70% before shipment<\/option>/);
  assert.doesNotMatch(page.text, />30\/70 —|>FOB —|>Tax Exclusive —/);
  assert.doesNotMatch(page.text, /Built-in standard|内置标准|draft-standard-term-body/);
  assert.match(page.text, /Commercial terms[\s\S]*Customer attachments[\s\S]*Signatory[\s\S]*Electronic signature[\s\S]*Company stamp/);
  assert.match(page.text, /Electronic signature[\s\S]*Not signed[\s\S]*Company stamp[\s\S]*Not stamped/);
  assert.doesNotMatch(page.text, /During this test phase/);
  assert.doesNotMatch(page.text, /Applied when MarkYang personally issues|Singapore company stamp applied|Submitting freezes the exact draft version|Before submitting, confirm/);
  assert.doesNotMatch(page.text, /Internal preparation only|Saving does not submit for review/);
  assert.doesNotMatch(page.text, /quotation-packages\/.*submit/);
  const save = await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on', currency: 'USD', taxRate: '9',
    sellerEntityCode: 'sunkaier_apac', customerContactId: '502', term_payment: '91',
    description: ['Mixer', 'Seal'], quantity: ['1', '2'],
    unit: ['set', 'each'], unitPrice: ['100', '20']
  });
  assert.equal(save.status, 302);
  assert.match(save.headers.location, /saved=1/);
  assert.equal(calls[0].lineItems.length, 2);
  assert.equal(calls[0].sellerEntityName, 'SUNKAIER ASIA PACIFIC PTE. LTD.');
  assert.equal(calls[0].customerContactId, 502);
  assert.equal(calls[0].customerContactName, 'Casey');
  assert.equal(calls[0].customerContactPhone, '+1 555 0102');
  assert.equal(calls[0].customerContactEmail, 'casey@example.com');
  assert.equal(calls[0].taxRate, '9');
  assert.deepEqual(calls[0].termSelections.payment, {
    id: 91, revisionNo: 1, language: 'en', title: 'Approved payment',
    templateBody: 'Approved example text', body: 'Approved example text'
  });
  assert.deepEqual(calls[0].lineItems.map((line) => line.includeInTotal), ['included', 'included']);
});

test('commercial terms stay compact while allowing quotation-specific wording to be edited and saved', async () => {
  const existingDraft = {
    draftRevisionNo: 2, sourceAttachmentId: 51, sourceSha256: 'a'.repeat(64), language: 'en',
    currency: 'USD', sellerEntityCode: 'sunkaier_apac', customerContactId: 501,
    customerContactName: 'Alex', customerContactPhone: '+1 555 0101', customerContactEmail: 'alex@example.com',
    lineItems: [], termSelections: {
      delivery: {
        id: 'builtin:price:price_basis_incoterms_2020:14', revisionNo: 1, language: 'en', title: 'FOB',
        templateBody: 'FOB [Named Port of Shipment], Incoterms® 2020.',
        body: 'FOB Shanghai Port, China, Incoterms® 2020.'
      }
    }
  };
  const { agent, calls } = await createAgent({ existingDraft });
  const page = await agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  const deliverySelect = page.text.match(/<select name="term_delivery"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(deliverySelect);
  assert.match(deliverySelect, /value="builtin:price:price_basis_incoterms_2020:14"[^>]* selected/);
  assert.match(deliverySelect, />FOB Shanghai Port, China, Incoterms® 2020\.<\/option>/);
  assert.match(page.text, /name="term_delivery_body"[^>]*>FOB Shanghai Port, China, Incoterms® 2020\.<\/textarea>/);
  assert.match(page.text, /data-term-edit-button[^>]*>Edit<\/button>/);
  const save = await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    sourceAttachmentId: '51', expectedRevisionNo: '2', confirmSourceVersion: 'on',
    currency: 'USD', taxRate: '0', sellerEntityCode: 'sunkaier_apac', customerContactId: '501',
    term_delivery: 'builtin:price:price_basis_incoterms_2020:14',
    term_delivery_body: 'FOB Busan Port, Korea, Incoterms® 2020.'
  });
  assert.equal(save.status, 302);
  assert.equal(calls[0].termSelections.delivery.body, 'FOB Busan Port, Korea, Incoterms® 2020.');
  assert.equal(calls[0].termSelections.delivery.templateBody, 'FOB [Named Port of Shipment], Incoterms® 2020.');
});

test('assigned Mark-style user with every role gets an enabled two-company seller dropdown', async () => {
  const { agent } = await createAgent({ username: 'MarkYang', roles: Object.values(ROLES) });
  const page = await agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  const select = page.text.match(/<select name="sellerEntityCode"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(select);
  assert.doesNotMatch(select.match(/^<select[^>]*>/)[0], /disabled/);
  assert.match(select, /value="sunkaier_china"/);
  assert.match(select, /value="sunkaier_apac"/);
});

test('internal A4 PDF preview requires a visible saved draft and never issues a formal quote', async () => {
  const pdf = Buffer.from('%PDF-1.7\ninternal-preview');
  const rendererCalls = [];
  const saved = await createAgent({
    existingDraft: { opportunityId: 20, draftRevisionNo: 2, sourceAttachmentId: 51,
      sourceSha256: 'a'.repeat(64), language: 'en', sellerEntityCode: 'sunkaier_apac', lineItems: [] },
    quotationPreviewPdfRenderer: async (input) => { rendererCalls.push(input); return pdf; }
  });
  const page = await saved.agent.get('/opportunities/20/commercial-quotation-draft');
  const workflow = page.text.match(/<section class="form-panel" aria-labelledby="formal-quotation-heading">[\s\S]*?<\/section>/)?.[0];
  assert.ok(workflow);
  assert.match(workflow, /Preview quotation layout/);
  assert.match(workflow, /Submit for approval/);
  assert.ok(workflow.indexOf('Preview quotation layout') < workflow.indexOf('Submit for approval'));
  const preview = await saved.agent.get('/opportunities/20/commercial-quotation-draft/preview.pdf');
  assert.equal(preview.status, 200);
  assert.match(preview.headers['content-type'], /application\/pdf/);
  assert.match(preview.headers['cache-control'], /no-store/);
  assert.equal(rendererCalls[0].draft.draftRevisionNo, 2);
  assert.equal(rendererCalls[0].sellerProfile.phone, '+65 6000 0000');
  assert.equal(rendererCalls[0].sellerProfile.address, '2 Venture Drive, #10-30, Vision Exchange, Singapore 608526');
  const absent = await createAgent({ quotationPreviewPdfRenderer: async () => pdf });
  assert.equal((await absent.agent.get('/opportunities/20/commercial-quotation-draft/preview.pdf')).status, 404);
  const unauthorized = await createAgent({ userId: 8, existingDraft: { opportunityId: 20 }, quotationPreviewPdfRenderer: async () => pdf });
  assert.equal((await unauthorized.agent.get('/opportunities/20/commercial-quotation-draft/preview.pdf')).status, 403);
});

test('Chinese quotation draft keeps QUOTATION as the title and aligns saved lines', async () => {
  const rendererCalls = [];
  const { agent } = await createAgent({ quotationPreviewPdfRenderer: async (input) => {
    rendererCalls.push(input);
    return Buffer.from('%PDF-1.7\npreview');
  }, existingDraft: {
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
  assert.match(page.text, /<th scope="col">序号<\/th>[\s\S]*<th scope="col">产品说明<\/th>[\s\S]*<th scope="col">数量<\/th>[\s\S]*<th scope="col">单位<\/th>[\s\S]*<th scope="col">单价<\/th>[\s\S]*<th scope="col">金额<\/th>/);
  assert.doesNotMatch(page.text, /计入总价|name="includeInTotal"/);
  assert.equal((await agent.get('/opportunities/20/commercial-quotation-draft/preview.pdf')).status, 200);
  assert.deepEqual(rendererCalls[0].draft.lineItems.map((line) => line.includeInTotal), ['included', 'included']);
  assert.match(page.text, /<h2 class="draft-section-title">客户<\/h2>[\s\S]*<h2 class="draft-section-title">供应商<\/h2>/);
  assert.doesNotMatch(page.text.split('<div class="draft-parties">')[1].split('</section>')[0], /<th scope="row">项目<\/th>/);
  assert.match(page.text, /<div class="draft-project-info">[\s\S]*<tr class="draft-project-row"><th scope="row">项目<\/th><td>Mixer Project<\/td>[\s\S]*<h2 class="draft-section-title">报价明细<\/h2>/);
  assert.match(page.text, /<th scope="row">币种<\/th><td>[\s\S]*<select name="currency" form="sales-quote-draft-form"/);
  assert.doesNotMatch(page.text.split('<div class="draft-project-info">')[1].split('</div>')[0], /<th scope="row">币种代码（草稿）<\/th>/);
  assert.match(page.text, /<h2 class="draft-section-title">项目信息<\/h2>/);
  assert.match(page.text, /<span>报价编号<\/span><strong class="draft-pending">未签发<\/strong>/);
  assert.doesNotMatch(page.text, /测试期允许未选择的条款/);
  assert.match(page.text, /<option value="custom:payment" data-term-custom="true"/);
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
  assert.equal((await agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    ...base, customerContactId: '999'
  })).status, 409);
  assert.equal(calls.length, 0);
});

test('assigned quotation engineer can create or modify a draft, while unrelated users remain denied', async () => {
  const other = await createAgent({ userId: 8 });
  assert.equal((await other.agent.get('/opportunities/20/commercial-quotation-draft')).status, 403);
  assert.equal((await other.agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({ sourceAttachmentId: '51', expectedRevisionNo: '0' })).status, 403);
  const unrelatedEngineer = await createAgent({
    userId: 8, roles: [ROLES.QUOTATION_ENGINEER], quotationEngineerId: 3
  });
  assert.equal((await unrelatedEngineer.agent.post('/opportunities/20/commercial-quotation-draft')
    .type('form').send({ sourceAttachmentId: '51', expectedRevisionNo: '0' })).status, 403);
  const engineer = await createAgent({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    existingDraft: { opportunityId: 20, draftRevisionNo: 1, sourceAttachmentId: 51,
      sourceSha256: 'a'.repeat(64), language: 'en', lineItems: [] }
  });
  const page = await engineer.agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  assert.match(page.text, /commercial-quotation-draft\/submit/);
  assert.match(page.text, />Submit for approval<\/button>/);
  const save = await engineer.agent.post('/opportunities/20/commercial-quotation-draft').type('form').send({
    sourceAttachmentId: '51', expectedRevisionNo: '1', confirmSourceVersion: 'on',
    currency: 'USD', sellerEntityCode: 'sunkaier_apac'
  });
  assert.equal(save.status, 302);
  assert.match(save.headers.location, /saved=1/);
  assert.equal(engineer.calls.length, 1);
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

test('formal quote routes deny unrelated submission, review and personal signing', async () => {
  const versions = [{ id: 81, opportunityId: 20, draftRevisionNo: 1, versionNo: 1,
    quotationNo: 'Q-800020-V1', status: 'pending', submittedBy: 7,
    submittedAt: new Date().toISOString() }];
  const unrelated = await createAgent({ userId: 8, formalVersions: versions });
  assert.equal((await unrelated.agent.post('/opportunities/20/commercial-quotation-draft/submit')
    .type('form').send({ expectedRevisionNo: '1' })).status, 403);
  assert.equal((await unrelated.agent.post('/opportunities/20/commercial-quotation-draft/versions/81/review')
    .type('form').send({ decision: 'approved' })).status, 403);
  versions[0].status = 'approved';
  assert.equal((await unrelated.agent.post('/opportunities/20/commercial-quotation-draft/versions/81/sign')
    .type('form').send({})).status, 403);
  assert.equal((await unrelated.agent.get('/opportunities/20/commercial-quotation-draft/versions/81.pdf')).status, 403);
  const owner = await createAgent({ formalVersions: versions });
  assert.equal((await owner.agent.get('/opportunities/20/commercial-quotation-draft/versions/81.pdf')).status, 404);
});

test('quotation page keeps frozen-version omissions and approval roles without test-phase copy', async () => {
  const { agent } = await createAgent({
    quotationSigning: { allowIncompleteFormal: true },
    existingDraft: { opportunityId: 20, draftRevisionNo: 2, sourceAttachmentId: 51,
      sourceSha256: 'a'.repeat(64), language: 'en', lineItems: [] },
    formalVersions: [{ id: 81, opportunityId: 20, draftRevisionNo: 2, versionNo: 1,
      quotationNo: 'Q-800020-V1', status: 'pending', submittedBy: 7,
      submittedAt: new Date().toISOString(), snapshot: {
        missingFields: ['seller.address', 'term.payment']
      } }]
  });
  const page = await agent.get('/opportunities/20/commercial-quotation-draft');
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /Test-phase incomplete issuance is enabled/);
  assert.doesNotMatch(page.text, /The issued PDF may still be sent to customers/);
  assert.match(page.text, /Omitted from this version: Seller address, Payment terms/);
  assert.doesNotMatch(page.text, /An assigned commercial manager other than the submitter reviews it/);
});

test('assigned Commercial Manager opens the exact frozen version with approval actions', async () => {
  const formalVersions = [{
    id: 81, opportunityId: 20, draftRevisionNo: 2, versionNo: 1,
    quotationNo: 'Q-800020-V1', status: 'pending', submittedBy: 7,
    submittedAt: new Date().toISOString(), snapshot: {}
  }];
  const { agent } = await createAgent({
    userId: 8,
    roles: [ROLES.COMMERCIAL_MANAGER],
    commercialManagerId: 8,
    formalVersions
  });

  const page = await agent.get('/opportunities/20/commercial-quotation-draft#quotation-version-81');
  assert.equal(page.status, 200);
  assert.match(page.text, /id="quotation-version-81"/);
  assert.match(page.text, /value="approved">Approve frozen version/);
  assert.match(page.text, /value="rejected"[^>]*>Return for changes/);
});

test('active assigned MarkYang can self-review a frozen version without a Commercial Manager role', async () => {
  const formalVersions = [{
    id: 81, opportunityId: 20, draftRevisionNo: 2, versionNo: 1,
    quotationNo: 'Q-800020-V1', status: 'pending', submittedBy: 7,
    submittedAt: new Date().toISOString(), snapshot: {}
  }];
  const { agent } = await createAgent({
    username: '杨胜华',
    roles: [ROLES.SALESPERSON],
    commercialManagerId: 7,
    formalVersions
  });

  const page = await agent.get('/opportunities/20/commercial-quotation-draft#quotation-version-81');
  assert.equal(page.status, 200);
  assert.match(page.text, /value="approved">Approve frozen version/);
  assert.match(page.text, /value="rejected"[^>]*>Return for changes/);
});
