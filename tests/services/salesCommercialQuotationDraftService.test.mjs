import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canEditSalesCommercialQuotationDraft,
  loadSalesCommercialQuotationDraft,
  saveSalesCommercialQuotationDraft
} from '../../src/services/salesCommercialQuotationDraftService.mjs';

const owner = { id: 7, roles: [ROLES.SALESPERSON] };
const quotationEngineer = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };
const opportunity = {
  id: 20, salespersonId: 7, quotationEngineerId: 3,
  status: 'technical_solution_in_progress', archivedAt: null
};
const source = {
  technicalDraftId: 41, technicalDraftRevisionNo: 2, attachmentId: 51,
  originalName: 'technical-offer.pdf', sha256: 'a'.repeat(64), technicalStatus: 'ready'
};

test('sales owner saves an internal quote draft from a ready uploaded file before technical approval', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return [{
      id: 91, key: 'payment', language: 'zh', revisionNo: 2,
      title: '已批准付款条款', body: '经批准的付款文案'
    }]; },
    async saveDraft(input) { calls.push(input); return { id: 10, draftRevisionNo: 1, ...input }; }
  };
  const result = await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'zh', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on', currency: 'usd', taxRate: '7.50',
    sellerEntityCode: 'sunkaier_china', term_payment: '91',
    description: ['Mixer', 'Spare seal'], quantity: ['2', '1'],
    unit: ['set', 'pc'], unitPrice: ['1000.00', '20.00']
  });
  assert.equal(result.id, 10);
  assert.equal(calls[0].language, 'zh');
  assert.equal(calls[0].source.sha256, 'a'.repeat(64));
  assert.equal(calls[0].currency, 'USD');
  assert.equal(calls[0].taxRate, '7.50');
  assert.equal(calls[0].sellerEntityName, '江苏胜开尔工业技术有限公司');
  assert.deepEqual(calls[0].termSelections.payment, {
    id: 91, revisionNo: 2, language: 'zh', title: '已批准付款条款',
    templateBody: '经批准的付款文案', body: '经批准的付款文案'
  });
  assert.equal(calls[0].lineItems.length, 2);
  assert.equal(calls[0].lineItems[1].description, 'Spare seal');
  assert.deepEqual(calls[0].lineItems.map((line) => line.includeInTotal), ['included', 'included']);
});

test('a legacy inclusion field cannot exclude a retained quotation row', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    description: ['Mixer', 'Spare seal'], quantity: ['1', '1'],
    unit: ['set', 'pc'], unitPrice: ['100', '20'], includeInTotal: ['excluded', 'excluded']
  });
  assert.deepEqual(calls[0].lineItems.map((line) => line.includeInTotal), ['included', 'included']);
});

test('assigned salesperson or quotation engineer can write the internal quote, but unrelated users and archived opportunities cannot', async () => {
  const repository = { async getTechnicalSource() { throw new Error('must not read'); } };
  assert.equal(canEditSalesCommercialQuotationDraft(owner, opportunity), true);
  assert.equal(canEditSalesCommercialQuotationDraft(quotationEngineer, opportunity), true);
  assert.equal(canEditSalesCommercialQuotationDraft({ id: 8, roles: [ROLES.SALESPERSON] }, opportunity), false);
  assert.equal(canEditSalesCommercialQuotationDraft({ id: 8, roles: [ROLES.QUOTATION_ENGINEER] }, opportunity), false);
  assert.equal(canEditSalesCommercialQuotationDraft(owner, { ...opportunity, archivedAt: '2026-09-01' }), false);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, { id: 8, roles: [ROLES.SALESPERSON] }, opportunity, 'en', {}), { statusCode: 403 });
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, { id: 8, roles: [ROLES.QUOTATION_ENGINEER] }, opportunity, 'en', {}), { statusCode: 403 });
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, { ...opportunity, archivedAt: '2026-09-01' }, 'en', {}), { statusCode: 403 });
});

test('invalid source, row values and stale revision fail closed', async () => {
  const repository = {
    async getTechnicalSource(_opportunityId, attachmentId) { return attachmentId === 51 ? source : null; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft() { return null; }
  };
  const base = { sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on' };
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, confirmSourceVersion: '' }), /Confirm the exact/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, sourceAttachmentId: '999' }), { statusCode: 409 });
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, quantity: '1e4' }), /Quantity/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, unitPrice: '10.999' }), /Unit price/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, unit: "se't" }), /Select a unit/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, sellerEntityCode: 'other' }), /seller entity/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, taxRate: '101' }), /Tax rate/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, taxRate: '7.123' }), /Tax rate/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, term_payment: '91' }), { statusCode: 409 });
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', base), { statusCode: 409 });
});

test('built-in typical wording can be selected without a database-published duplicate', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_payment: 'builtin:payment:telegraphic_transfer:5'
  });
  assert.equal(calls[0].termSelections.payment.title, '30/70');
  assert.equal(calls[0].termSelections.payment.body, '30% advance, 70% before shipment');
});

test('built-in Chinese wording can be selected without a database-published duplicate', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'zh', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_payment: 'builtin:zh:payment:1'
  });
  assert.equal(calls[0].termSelections.payment.title, '30%预付款，70%发货前付清');
  assert.equal(calls[0].termSelections.payment.body, '合同生效后支付合同总价的30%作为预付款；卖方通知发货前，买方支付剩余70%货款。');
});

test('assigned quote editors can save custom commercial wording without changing the standard term library', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'zh', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_payment: 'custom:payment', term_payment_body: '付款方式：预付 30%，发货前付清余款。'
  });
  assert.deepEqual(calls[0].termSelections.payment, {
    id: 'custom:payment', revisionNo: 1, language: 'zh', title: '本次报价自定义付款条件',
    templateBody: '', body: '付款方式：预付 30%，发货前付清余款。'
  });
});

test('an unchanged typical-term selection saves edited quotation wording without changing its template', async () => {
  const calls = [];
  const existingDraft = { language: 'en', termSelections: {
    delivery: {
      id: 'builtin:price:price_basis_incoterms_2020:14', revisionNo: 1, language: 'en', title: 'FOB',
      templateBody: 'FOB [Named Port of Shipment], Incoterms® 2020.',
      body: 'FOB Shanghai Port, China, Incoterms® 2020.'
    }
  } };
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return existingDraft; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  const base = {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_delivery: 'builtin:price:price_basis_incoterms_2020:14'
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    ...base, term_delivery_body: '  FOB Busan Port, Korea, Incoterms® 2020.  '
  });
  assert.deepEqual(calls[0].termSelections.delivery, {
    id: 'builtin:price:price_basis_incoterms_2020:14', revisionNo: 1, language: 'en',
    title: 'FOB',
    templateBody: 'FOB [Named Port of Shipment], Incoterms® 2020.',
    body: 'FOB Busan Port, Korea, Incoterms® 2020.'
  });
  assert.equal(calls.length, 1);
});

test('quotation-specific wording may complete a dropdown template with placeholders', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_delivery_period: 'builtin:delivery:delivery_period_start:1',
    term_delivery_period_body: 'Delivery shall be made within sixteen (16) weeks after receipt of the advance payment and approval of the technical documents.'
  });
  assert.equal(
    calls[0].termSelections.delivery_period.body,
    'Delivery shall be made within sixteen (16) weeks after receipt of the advance payment and approval of the technical documents.'
  );
  assert.match(calls[0].termSelections.delivery_period.templateBody, /\[Delivery Period\]/);
});

test('quotation-specific wording still rejects unresolved template placeholders', async () => {
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft() { throw new Error('must not save'); }
  };
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_delivery_period: 'builtin:delivery:delivery_period_start:1',
    term_delivery_period_body: 'Delivery shall be made within [Delivery Period] after receipt of the purchase order.'
  }), /Replace all bracketed placeholders/);
});

test('built-in warranty wording can be selected for a quotation', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on',
    term_warranty: 'builtin:warranty:warranty_period:1'
  });
  assert.equal(
    calls[0].termSelections.warranty.body,
    'The warranty period shall be twelve (12) months from the date of commissioning or eighteen (18) months from the date of shipment, whichever occurs first.'
  );
});

test('a standard term from another language is rejected even if the catalog adapter returns it', async () => {
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() {
      return [{ id: 93, key: 'payment', language: 'zh', revisionNo: 1, title: '付款条款', body: '正文' }];
    },
    async saveDraft() { throw new Error('must not save'); }
  };
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on', term_payment: '93'
  }), { statusCode: 409 });
});

test('newer uploaded technical revision is shown as a source reconfirmation warning', async () => {
  const repository = {
    async getByOpportunity() { return { sourceAttachmentId: 51, sourceSha256: source.sha256 }; },
    async listTechnicalSources() { return [{ ...source, technicalDraftRevisionNo: 3, attachmentId: 52 }, source]; },
    async listPublishedStandardTerms() { return []; }
  };
  const context = await loadSalesCommercialQuotationDraft(repository, owner, opportunity);
  assert.equal(context.sourceChanged, true);
});

test('loading an old draft includes every row without mutating stored data', async () => {
  const stored = { lineItems: [
    { description: 'Mixer', quantity: '1', unit: 'set', unitPrice: '100', includeInTotal: 'included' },
    { description: 'Seal', quantity: '2', unit: 'piece', unitPrice: '20', includeInTotal: 'excluded' }
  ] };
  const repository = {
    async getByOpportunity() { return stored; },
    async listTechnicalSources() { return []; },
    async listPublishedStandardTerms() { return []; }
  };
  const context = await loadSalesCommercialQuotationDraft(repository, owner, opportunity);
  assert.deepEqual(context.draft.lineItems.map((line) => line.includeInTotal), ['included', 'included']);
  assert.equal(stored.lineItems[1].includeInTotal, 'excluded');
});

test('standard wording is selected in the saved draft language, not a later login language', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return { language: 'zh' }; },
    async listPublishedStandardTerms(language) {
      calls.push(language);
      return [{ id: 92, key: 'warranty', language, revisionNo: 1, title: '质保条款', body: '批准正文' }];
    },
    async saveDraft(input) { calls.push(input); return input; }
  };
  await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', {
    sourceAttachmentId: '51', expectedRevisionNo: '1', confirmSourceVersion: 'on', term_warranty: '92'
  });
  assert.equal(calls[0], 'zh');
  assert.equal(calls[1].language, 'zh');
});

test('attention is snapshotted only from an active contact of the opportunity customer', async () => {
  const calls = [];
  const customerOpportunity = {
    ...opportunity, customerId: 30, primaryContactId: 501, primaryContactName: 'Primary Buyer'
  };
  const repository = {
    async getTechnicalSource() { return source; },
    async getByOpportunity() { return null; },
    async listPublishedStandardTerms() { return []; },
    async saveDraft(input) { calls.push(input); return input; }
  };
  const customerContacts = [
    { id: 501, customerId: 30, name: 'Primary Buyer', phone: '+1 555 0101', email: 'primary@example.com' },
    { id: 502, customerId: 30, name: 'Selected Buyer', phone: '+1 555 0102', email: 'selected@example.com' },
    { id: 900, customerId: 99, name: 'Other Customer Contact', phone: '+1 555 0900', email: 'other@example.com' }
  ];
  const base = { sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on' };
  await saveSalesCommercialQuotationDraft(repository, owner, customerOpportunity, 'en', {
    ...base, customerContactId: '502'
  }, { customerContacts });
  assert.equal(calls[0].customerContactId, 502);
  assert.equal(calls[0].customerContactName, 'Selected Buyer');
  assert.equal(calls[0].customerContactPhone, '+1 555 0102');
  assert.equal(calls[0].customerContactEmail, 'selected@example.com');
  await assert.rejects(() => saveSalesCommercialQuotationDraft(
    repository, owner, customerOpportunity, 'en', { ...base, customerContactId: '900' },
    { customerContacts }
  ), { statusCode: 409 });
});
