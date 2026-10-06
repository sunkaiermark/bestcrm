import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesQuotationStandardTermRepository } from '../../src/repositories/salesQuotationStandardTermRepository.mjs';

test('standard wording repository creates revisions without seeding or publishing them', async () => {
  const calls = [];
  const repository = createSalesQuotationStandardTermRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [{ id: '91', term_key: 'payment', language: 'en', revision_no: 2, title: 'Payment', body: 'Text', status: 'draft', created_by: '7' }] }; }
  });
  const term = await repository.createDraft({ key: 'payment', language: 'en', title: 'Payment', body: 'Text', actorUserId: 7 });
  assert.equal(term.revisionNo, 2);
  assert.equal(term.status, 'draft');
  assert.match(calls[0].sql, /COALESCE\(MAX\(revision_no\), 0\) \+ 1/);
  assert.deepEqual(calls[0].values, ['payment', 'en', 'Payment', 'Text', 7]);
});

test('publication is conditional on unchanged reviewed text and another author', async () => {
  const calls = [];
  const repository = createSalesQuotationStandardTermRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }
  });
  assert.equal(await repository.publish({ id: 91, actorUserId: 8, expectedTitle: 'Payment', expectedBody: 'Text' }), null);
  assert.match(calls[0].sql, /status = 'draft' AND created_by <> \$2/);
  assert.match(calls[0].sql, /title = \$3 AND body = \$4/);
  assert.deepEqual(calls[0].values, [91, 8, 'Payment', 'Text']);
});

test('retirement records the actor without deleting approved text', async () => {
  const calls = [];
  const repository = createSalesQuotationStandardTermRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }
  });
  await repository.retire({ id: 91, actorUserId: 8 });
  assert.match(calls[0].sql, /status = 'retired', retired_at = now\(\), retired_by = \$2/);
  assert.deepEqual(calls[0].values, [91, 8]);
});
