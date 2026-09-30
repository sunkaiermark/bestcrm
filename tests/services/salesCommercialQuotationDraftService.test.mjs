import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canEditSalesCommercialQuotationDraft,
  loadSalesCommercialQuotationDraft,
  saveSalesCommercialQuotationDraft
} from '../../src/services/salesCommercialQuotationDraftService.mjs';

const owner = { id: 7, roles: [ROLES.SALESPERSON] };
const opportunity = { id: 20, salespersonId: 7, status: 'technical_solution_in_progress', archivedAt: null };
const source = {
  technicalDraftId: 41, technicalDraftRevisionNo: 2, attachmentId: 51,
  originalName: 'technical-offer.pdf', sha256: 'a'.repeat(64), technicalStatus: 'ready'
};

test('sales owner saves an internal quote draft from a ready uploaded file before technical approval', async () => {
  const calls = [];
  const repository = {
    async getTechnicalSource() { return source; },
    async saveDraft(input) { calls.push(input); return { id: 10, draftRevisionNo: 1, ...input }; }
  };
  const result = await saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'zh', {
    sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on', currency: 'usd',
    description: ['Mixer', 'Spare seal'], quantity: ['2', '1'],
    unit: ['set', 'piece'], unitPrice: ['1000.00', '20.00']
  });
  assert.equal(result.id, 10);
  assert.equal(calls[0].language, 'zh');
  assert.equal(calls[0].source.sha256, 'a'.repeat(64));
  assert.equal(calls[0].currency, 'USD');
  assert.equal(calls[0].lineItems.length, 2);
  assert.equal(calls[0].lineItems[1].description, 'Spare seal');
});

test('non-owner and archived opportunities cannot write the internal quote', async () => {
  const repository = { async getTechnicalSource() { throw new Error('must not read'); } };
  assert.equal(canEditSalesCommercialQuotationDraft(owner, opportunity), true);
  assert.equal(canEditSalesCommercialQuotationDraft({ id: 8, roles: [ROLES.SALESPERSON] }, opportunity), false);
  assert.equal(canEditSalesCommercialQuotationDraft(owner, { ...opportunity, archivedAt: '2026-09-01' }), false);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, { id: 8, roles: [ROLES.SALESPERSON] }, opportunity, 'en', {}), { statusCode: 403 });
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, { ...opportunity, archivedAt: '2026-09-01' }, 'en', {}), { statusCode: 403 });
});

test('invalid source, row values and stale revision fail closed', async () => {
  const repository = {
    async getTechnicalSource(_opportunityId, attachmentId) { return attachmentId === 51 ? source : null; },
    async saveDraft() { return null; }
  };
  const base = { sourceAttachmentId: '51', expectedRevisionNo: '0', confirmSourceVersion: 'on' };
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, confirmSourceVersion: '' }), /Confirm the exact/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, sourceAttachmentId: '999' }), { statusCode: 409 });
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, quantity: '1e4' }), /Quantity/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', { ...base, unitPrice: '10.999' }), /Unit price/);
  await assert.rejects(() => saveSalesCommercialQuotationDraft(repository, owner, opportunity, 'en', base), { statusCode: 409 });
});

test('newer uploaded technical revision is shown as a source reconfirmation warning', async () => {
  const repository = {
    async getByOpportunity() { return { sourceAttachmentId: 51, sourceSha256: source.sha256 }; },
    async listTechnicalSources() { return [{ ...source, technicalDraftRevisionNo: 3, attachmentId: 52 }, source]; }
  };
  const context = await loadSalesCommercialQuotationDraft(repository, owner, opportunity);
  assert.equal(context.sourceChanged, true);
});
