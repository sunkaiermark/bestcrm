import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommercialQuoteRepository } from '../../src/repositories/commercialQuoteRepository.mjs';

function createFakeQueryTarget(responses = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return responses.shift() || { rows: [], rowCount: 0 };
    }
  };
}

test('commercial quote repository creates quote header and line items', async () => {
  const queryTarget = createFakeQueryTarget([
    { rows: [{
      id: '99',
      opportunity_id: '10',
      version_no: '2',
      total_price: '2000',
      payment_terms: '30% advance, 70% before delivery',
      validity_date: '2026-07-31',
      remarks: 'quote ready',
      status: 'pending',
      submitted_by: '3',
      submitter_display_name: 'Quote Engineer',
      submitted_at: '2026-06-05T12:00:00.000Z',
      reviewed_by: null,
      reviewer_display_name: null,
      reviewed_at: null,
      review_comment: null
    }], rowCount: 1 },
    { rows: [{ id: '100' }], rowCount: 1 }
  ]);
  const repository = createCommercialQuoteRepository(queryTarget);

  const quote = await repository.createQuote({
    opportunityId: 10,
    totalPrice: 2000,
    paymentTerms: '30% advance, 70% before delivery',
    validityDate: '2026-07-31',
    remarks: 'quote ready',
    submittedBy: 3,
    items: [{
      itemName: 'Control cabinet',
      specification: 'PLC control set',
      unit: 'set',
      quantity: 2,
      unitPrice: 1000,
      subtotal: 2000
    }]
  });

  assert.equal(quote.id, 99);
  assert.equal(quote.opportunityId, 10);
  assert.equal(quote.versionNo, 2);
  assert.equal(quote.status, 'pending');
  assert.equal(quote.totalPrice, 2000);
  assert.equal(quote.submittedAt, '2026-06-05T12:00:00.000Z');
  assert.match(queryTarget.queries[0].sql, /INSERT INTO commercial_quotes/);
  assert.match(queryTarget.queries[0].sql, /COALESCE\(MAX\(version_no\), 0\) \+ 1/);
  assert.deepEqual(queryTarget.queries[0].params, [
    10,
    2000,
    '30% advance, 70% before delivery',
    '2026-07-31',
    'quote ready',
    3
  ]);
  assert.match(queryTarget.queries[1].sql, /INSERT INTO quote_items/);
  assert.deepEqual(queryTarget.queries[1].params, [
    99,
    'Control cabinet',
    'PLC control set',
    'set',
    2,
    1000,
    2000
  ]);
});

test('commercial quote repository lists quote versions by opportunity', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '99',
    opportunity_id: '10',
    version_no: '1',
    total_price: '2000',
    payment_terms: '30% advance, 70% before delivery',
    validity_date: '2026-07-31',
    remarks: 'quote ready',
    status: 'approved',
    submitted_by: '3',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-05T12:00:00.000Z',
    reviewed_by: '5',
    reviewer_display_name: 'Commercial Manager',
    reviewed_at: '2026-06-05T13:00:00.000Z',
    review_comment: 'approved',
    item_id: '100',
    item_name: 'Control cabinet',
    specification: 'PLC control set',
    unit: 'set',
    quantity: '2',
    unit_price: '1000',
    subtotal: '2000'
  }], rowCount: 1 }]);
  const repository = createCommercialQuoteRepository(queryTarget);

  const quotes = await repository.listByOpportunity(10);

  assert.deepEqual(quotes, [{
    id: 99,
    opportunityId: 10,
    versionNo: 1,
    totalPrice: 2000,
    paymentTerms: '30% advance, 70% before delivery',
    validityDate: '2026-07-31',
    remarks: 'quote ready',
    status: 'approved',
    submittedBy: 3,
    submitterDisplayName: 'Quote Engineer',
    submittedAt: '2026-06-05T12:00:00.000Z',
    reviewedBy: 5,
    reviewerDisplayName: 'Commercial Manager',
    reviewedAt: '2026-06-05T13:00:00.000Z',
    reviewComment: 'approved',
    items: [{
      id: 100,
      itemName: 'Control cabinet',
      specification: 'PLC control set',
      unit: 'set',
      quantity: 2,
      unitPrice: 1000,
      subtotal: 2000
    }]
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM commercial_quotes cq/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN quote_items qi/);
  assert.match(queryTarget.queries[0].sql, /WHERE cq\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY cq\.version_no ASC/);
});

test('commercial quote repository reviews latest pending quote version', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '100',
    opportunity_id: '10',
    version_no: '2',
    total_price: '2100',
    payment_terms: '40% advance, 60% before delivery',
    validity_date: '2026-08-31',
    remarks: 'price revised',
    status: 'rejected',
    submitted_by: '3',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-06T12:00:00.000Z',
    reviewed_by: '5',
    reviewer_display_name: 'Commercial Manager',
    reviewed_at: '2026-06-06T13:00:00.000Z',
    review_comment: 'revise payment terms'
  }], rowCount: 1 }]);
  const repository = createCommercialQuoteRepository(queryTarget);

  const quote = await repository.reviewLatestPending({
    opportunityId: 10,
    status: 'rejected',
    reviewedBy: 5,
    reviewComment: 'revise payment terms'
  });

  assert.equal(quote.status, 'rejected');
  assert.equal(quote.reviewedBy, 5);
  assert.match(queryTarget.queries[0].sql, /UPDATE commercial_quotes/);
  assert.match(queryTarget.queries[0].sql, /WHERE opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /status = 'pending'/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 'rejected', 5, 'revise payment terms']);
});
