import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationPackageRepository } from '../../src/repositories/quotationPackageRepository.mjs';

function fakeTarget(responses = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return responses.shift() || { rows: [], rowCount: 0 };
    }
  };
}

function packageRow(overrides = {}) {
  return {
    id: '51', opportunity_id: '20', source_package_id: null, review_source_package_id: null,
    workspace_id: null, commercial_draft_id: null, commercial_draft_version_no: null,
    draft_revision_no: '1', version_no: null,
    status: 'draft', technical_solution_version_id: '41', technical_solution_version_no: '2',
    commercial_quote_id: '31', commercial_quote_version_no: '3', currency: 'USD', total_price: '120000',
    delivery_period: '16 weeks', payment_terms: '30/60/10', valid_until: '2026-12-31',
    commercial_line_items: [{ itemName: 'Mixer', quantity: 1 }], inclusions: 'FAT', exclusions: 'Civil work',
    technical_assumptions: 'Clean utilities', revision_reason: null, change_summary: null,
    created_by: '7', creator_display_name: 'Sales One', created_at: '2026-09-03', submitted_by: null,
    submitter_display_name: '', submitted_at: null, reviewed_by: null, reviewer_display_name: '', reviewed_at: null,
    review_comment: null, sent_by: null, sender_display_name: '', sent_at: null, accepted_by: null,
    accepter_display_name: '', accepted_at: null, superseded_at: null, updated_by: '7', updated_at: '2026-09-03',
    ...overrides
  };
}

test('quotation package draft numbering is serialized per opportunity', async () => {
  const target = fakeTarget([{ rows: [packageRow()] }]);
  const repository = createQuotationPackageRepository(target);
  const created = await repository.createDraft({
    opportunityId: 20, technicalSolutionVersionId: 41, commercialQuoteId: 31,
    currency: 'USD', totalPrice: 120000, deliveryPeriod: '16 weeks', paymentTerms: '30/60/10',
    validUntil: '2026-12-31', commercialLineItems: [{ itemName: 'Mixer' }], inclusions: 'FAT',
    exclusions: 'Civil work', technicalAssumptions: 'Clean utilities', actorUserId: 7
  });
  assert.equal(created.label, 'QP-D1');
  assert.match(target.queries[0].sql, /pg_advisory_xact_lock/);
  assert.match(target.queries[0].sql, /MAX\(draft_revision_no\)/);
  assert.match(target.queries[0].sql, /INSERT INTO quotation_package_events/);
  assert.equal(target.queries[0].params.length, 16);
});

test('approval allocates the formal QP version under the opportunity lock', async () => {
  const target = fakeTarget([{ rows: [packageRow({ status: 'approved', version_no: '2' })] }]);
  const repository = createQuotationPackageRepository(target);
  const approved = await repository.approvePending({ packageId: 51, actorUserId: 9, comment: 'Approved' });
  assert.equal(approved.label, 'QP-V2');
  assert.match(target.queries[0].sql, /pg_advisory_xact_lock\(opportunity_id\)/);
  assert.match(target.queries[0].sql, /MAX\(qp\.version_no\)/);
  assert.deepEqual(target.queries[0].params, [51, 9, 'Approved']);
  assert.match(target.queries[0].sql, /submitted_by <> \$2/);
});

test('repository detects an opportunity already governed by Bid Center', async () => {
  const target = fakeTarget([{ rows: [{ exists: true }] }]);
  const repository = createQuotationPackageRepository(target);
  assert.equal(await repository.hasBidWorkspace(20), true);
  assert.match(target.queries[0].sql, /FROM opportunity_bid_workspaces/);
  assert.deepEqual(target.queries[0].params, [20]);
});

test('bid-center package mapping retains frozen workspace and commercial-version bindings', async () => {
  const target = fakeTarget([
    { rows: [packageRow({ workspace_id: '40', commercial_draft_id: '42', commercial_draft_version_no: '3', review_source_package_id: '49' })] },
    { rows: [] },
    { rows: [] }
  ]);
  const repository = createQuotationPackageRepository(target);
  const detail = await repository.getPackageDetail(51);
  assert.equal(detail.workspaceId, 40);
  assert.equal(detail.commercialDraftId, 42);
  assert.equal(detail.commercialDraftVersionNo, 3);
  assert.equal(detail.reviewSourcePackageId, 49);
});

test('sent transition supersedes the former sent package and acceptance links opportunity', async () => {
  const target = fakeTarget([
    { rows: [packageRow({ status: 'sent', version_no: '2', sent_by: '7', sent_at: '2026-09-03' })] },
    { rows: [packageRow({ status: 'accepted', version_no: '2', sent_by: '7', sent_at: '2026-09-03', accepted_by: '7', accepted_at: '2026-09-04' })] }
  ]);
  const repository = createQuotationPackageRepository(target);
  await repository.markSent({ packageId: 51, actorUserId: 7, comment: 'Email evidence', sentEmailMessageId: 81 });
  await repository.acceptSent({ packageId: 51, actorUserId: 7, comment: 'PO received' });
  assert.match(target.queries[0].sql, /status = 'superseded'/);
  assert.match(target.queries[0].sql, /replacementPackageId/);
  assert.match(target.queries[0].sql, /sent_email_message_id = \$4/);
  assert.equal(target.queries[0].params[3], 81);
  assert.match(target.queries[1].sql, /accepted_quotation_package_id = updated\.id/);
});
