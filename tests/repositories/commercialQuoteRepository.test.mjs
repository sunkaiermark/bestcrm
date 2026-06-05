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
    { rows: [{ id: '99', submitted_at: '2026-06-05T12:00:00.000Z' }], rowCount: 1 },
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
  assert.equal(quote.totalPrice, 2000);
  assert.equal(quote.submittedAt, '2026-06-05T12:00:00.000Z');
  assert.match(queryTarget.queries[0].sql, /INSERT INTO commercial_quotes/);
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
