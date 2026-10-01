import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesCommercialQuotationDraftRepository } from '../../src/repositories/salesCommercialQuotationDraftRepository.mjs';

test('internal sales quotation source query is scoped to active uploaded files from one opportunity', async () => {
  const calls = [];
  const repository = createSalesCommercialQuotationDraftRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }
  });
  assert.deepEqual(await repository.listTechnicalSources(20), []);
  assert.match(calls[0].sql, /draft\.opportunity_id = \$1/);
  assert.match(calls[0].sql, /draft\.source_kind = 'uploaded_file'/);
  assert.match(calls[0].sql, /draft\.status IN \('ready', 'pending', 'approved'\)/);
  assert.match(calls[0].sql, /attachment\.retired_at IS NULL/);
  assert.deepEqual(calls[0].values, [20]);
});

test('saveDraft uses an optimistic revision check and never changes frozen language', async () => {
  const calls = [];
  const repository = createSalesCommercialQuotationDraftRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }
  });
  const saved = await repository.saveDraft({
    opportunityId: 20, source: {
      technicalDraftId: 41, attachmentId: 51,
      sha256: 'a'.repeat(64), originalName: 'technical-offer.pdf'
    }, language: 'en', currency: 'USD', sellerEntityCode: 'sunkaier_apac',
    sellerEntityName: 'SUNKAIER ASIA PACIFIC PTE. LTD.', lineItems: [],
    termSelections: { payment: { id: 91, body: 'Approved text' } }, actorUserId: 7, expectedRevisionNo: 2
  });
  assert.equal(saved, null);
  assert.match(calls[0].sql, /ON CONFLICT \(opportunity_id\) DO UPDATE/);
  assert.match(calls[0].sql, /WHERE sales_commercial_quotation_drafts\.draft_revision_no = \$13/);
  assert.match(calls[0].sql, /seller_entity_name = EXCLUDED\.seller_entity_name/);
  assert.match(calls[0].sql, /term_selections = EXCLUDED\.term_selections/);
  assert.doesNotMatch(calls[0].sql, /SET[\s\S]*language = EXCLUDED\.language/);
  assert.equal(calls[0].values[12], 2);
  assert.equal(calls[0].values[8], 'SUNKAIER ASIA PACIFIC PTE. LTD.');
  assert.deepEqual(JSON.parse(calls[0].values[10]), { payment: { id: 91, body: 'Approved text' } });
});

test('only currently published standard terms in the draft language are selectable', async () => {
  const calls = [];
  const repository = createSalesCommercialQuotationDraftRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: '91', term_key: 'payment', language: 'zh', revision_no: 2, title: '付款条件', body: '批准正文' }] };
    }
  });
  assert.deepEqual(await repository.listPublishedStandardTerms('zh'), [
    { id: 91, key: 'payment', language: 'zh', revisionNo: 2, title: '付款条件', body: '批准正文' }
  ]);
  assert.match(calls[0].sql, /status = 'published'[\s\S]*published_at <= now\(\)[\s\S]*retired_at IS NULL/);
  assert.deepEqual(calls[0].values, ['zh']);
});
