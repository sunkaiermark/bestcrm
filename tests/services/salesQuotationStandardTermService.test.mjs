import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  SalesQuotationStandardTermError,
  createSalesQuotationStandardTerm,
  publishSalesQuotationStandardTerm,
  retireSalesQuotationStandardTerm,
  salesQuotationStandardTermFingerprint,
  updateSalesQuotationStandardTerm
} from '../../src/services/salesQuotationStandardTermService.mjs';

const author = { id: 7, roles: [ROLES.COMMERCIAL_MANAGER] };
const reviewer = { id: 8, roles: [ROLES.GENERAL_MANAGER] };
const term = { id: 91, key: 'payment', language: 'en', title: 'Payment', body: 'Approved company text', status: 'draft', createdBy: 7 };

test('standard wording validates section, language and body before storing a draft', async () => {
  const calls = [];
  const repository = { async createDraft(input) { calls.push(input); return { id: 91, ...input }; } };
  await assert.rejects(() => createSalesQuotationStandardTerm(repository, { id: 2, roles: [ROLES.SALESPERSON] }, { termKey: 'payment', language: 'en', title: 'A', body: 'B' }), (error) => error.statusCode === 403);
  await assert.rejects(() => createSalesQuotationStandardTerm(repository, { id: 3, roles: [ROLES.ADMINISTRATOR] }, { termKey: 'payment', language: 'en', title: 'A', body: 'B' }), (error) => error.statusCode === 403);
  await assert.rejects(() => createSalesQuotationStandardTerm(repository, author, { termKey: 'bank_account', language: 'en', title: 'A', body: 'B' }), (error) => error.statusCode === 400);
  const created = await createSalesQuotationStandardTerm(repository, author, { termKey: 'payment', language: 'en', title: ' Payment ', body: ' Draft text ' });
  assert.equal(created.id, 91);
  assert.deepEqual(calls[0], { key: 'payment', language: 'en', title: 'Payment', body: 'Draft text', actorUserId: 7 });
});

test('retiring a published wording is reviewer-only and leaves historical snapshots untouched', async () => {
  const calls = [];
  const repository = { async retire(input) { calls.push(input); return { id: input.id, status: 'retired' }; } };
  await assert.rejects(() => retireSalesQuotationStandardTerm(repository, author, 91), (error) => error.statusCode === 403);
  const retired = await retireSalesQuotationStandardTerm(repository, reviewer, 91);
  assert.equal(retired.status, 'retired');
  assert.deepEqual(calls, [{ id: 91, actorUserId: 8 }]);
});

test('publication needs a different authorized account and exact reviewed content', async () => {
  const calls = [];
  const repository = {
    async findById() { return term; },
    async publish(input) { calls.push(input); return { ...term, status: 'published' }; }
  };
  await assert.rejects(() => publishSalesQuotationStandardTerm(repository, author, 91, salesQuotationStandardTermFingerprint(term)), (error) => error.statusCode === 403);
  await assert.rejects(() => publishSalesQuotationStandardTerm(repository, { id: 9, roles: [ROLES.ADMINISTRATOR] }, 91, salesQuotationStandardTermFingerprint(term)), (error) => error.statusCode === 403);
  await assert.rejects(() => publishSalesQuotationStandardTerm(repository, { id: 7, roles: [ROLES.COMMERCIAL_MANAGER, ROLES.GENERAL_MANAGER] }, 91, salesQuotationStandardTermFingerprint(term)), (error) => error.statusCode === 403);
  await assert.rejects(() => publishSalesQuotationStandardTerm(repository, reviewer, 91, 'stale'), (error) => error.statusCode === 409);
  const published = await publishSalesQuotationStandardTerm(repository, reviewer, 91, salesQuotationStandardTermFingerprint(term));
  assert.equal(published.status, 'published');
  assert.deepEqual(calls, [{ id: 91, actorUserId: 8, expectedTitle: 'Payment', expectedBody: 'Approved company text' }]);
});

test('only the author can edit an unpublished draft', async () => {
  const repository = {
    async findById() { return term; },
    async updateDraft(input) { return input; }
  };
  await assert.rejects(() => updateSalesQuotationStandardTerm(repository, reviewer, 91, { title: 'New', body: 'New' }), (error) => error.statusCode === 403);
  const updated = await updateSalesQuotationStandardTerm(repository, author, 91, { title: 'Revised', body: 'Revised body', termKey: 'scope' });
  assert.equal(updated.key, 'payment');
  assert.equal(updated.body, 'Revised body');
  assert.ok(SalesQuotationStandardTermError);
});
