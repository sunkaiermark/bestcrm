import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductCategoryRepository } from '../../src/repositories/productCategoryRepository.mjs';

test('category report reads confirmed arrays only and deduplicates customers within each category', async () => {
  const calls = [];
  const repository = createProductCategoryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return calls.length === 1
        ? { rows: [{
          code: 'pumps', customer_count: '2', opportunity_count: '3',
          inquiry_count: '4', email_thread_count: '5', unlinked_count: '1'
        }] }
        : { rows: [{
          id: '12', customer_code: 'C000012', name: 'Acme',
          opportunity_count: '2', inquiry_count: '1', email_thread_count: '3',
          last_activity_at: '2026-09-24T00:00:00.000Z'
        }] };
    }
  });

  assert.deepEqual(await repository.categorySummary({ year: 2026 }), [{
    code: 'pumps', customerCount: 2, opportunityCount: 3,
    inquiryCount: 4, emailThreadCount: 5, unlinkedCount: 1
  }]);
  assert.deepEqual(await repository.customersForCategory('pumps', { year: 2026 }), [{
    customerId: 12, customerCode: 'C000012', customerName: 'Acme',
    opportunityCount: 2, inquiryCount: 1, emailThreadCount: 3,
    lastActivityAt: '2026-09-24T00:00:00.000Z'
  }]);
  assert.match(calls[0].sql, /unnest\(opportunity\.confirmed_product_category_codes\)/);
  assert.match(calls[0].sql, /unnest\(inquiry\.confirmed_product_category_codes\)/);
  assert.match(calls[0].sql, /unnest\(thread\.confirmed_product_category_codes\)/);
  assert.match(calls[0].sql, /count\(DISTINCT customer_id\)/);
  assert.doesNotMatch(calls[0].sql, /product_category_code\b/);
  assert.deepEqual(calls[0].params, [2026]);
  assert.match(calls[1].sql, /JOIN customers customer ON customer\.id = evidence\.customer_id/);
  assert.deepEqual(calls[1].params, ['pumps', 2026]);
});

test('confirmation uses whitelisted tables and records explicit review even with no categories', async () => {
  const calls = [];
  const repository = createProductCategoryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        id: params[0], confirmed_product_category_codes: params[1],
        product_category_reviewed_at: '2026-09-24T00:00:00.000Z'
      }] };
    }
  });
  await assert.rejects(repository.setConfirmed('email_messages', 4, ['pumps'], 7),
    /Invalid product category record type/);
  const saved = await repository.setConfirmed('email_thread', 40, [], 7);
  assert.deepEqual(saved.confirmed_product_category_codes, []);
  assert.match(calls[0].sql, /UPDATE email_threads/);
  assert.match(calls[0].sql, /product_category_reviewed_at = now\(\)/);
  assert.deepEqual(calls[0].params, [40, [], 7]);
});

test('historical email review is paged and uses recent inbound text without changing the archive', async () => {
  const calls = [];
  const repository = createProductCategoryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return calls.length === 1
        ? { rows: [{ total: '31' }] }
        : { rows: [{
          id: '40', subject: 'Pump RFQ',
          last_message_at: '2026-09-24T00:00:00.000Z',
          body_text: 'Need a pump'
        }] };
    }
  });
  const pending = await repository.pendingEmailReview({ limit: 30, offset: 30 });
  assert.equal(pending.total, 31);
  assert.deepEqual(pending.rows[0], {
    id: 40, subject: 'Pump RFQ',
    lastMessageAt: '2026-09-24T00:00:00.000Z', bodyText: 'Need a pump'
  });
  assert.match(calls[1].sql, /message\.direction = 'inbound'/);
  assert.match(calls[1].sql, /message\.canonical_message_id IS NULL/);
  assert.match(calls[1].sql, /LIMIT 4/);
  assert.deepEqual(calls[1].params, [30, 30]);
  assert.doesNotMatch(calls[1].sql, /UPDATE|DELETE/);
});

test('unreviewed leads, inquiries and opportunities remain in a paged review queue', async () => {
  const calls = [];
  const repository = createProductCategoryRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return calls.length === 1
        ? { rows: [{ total: '1' }] }
        : { rows: [{
          record_type: 'inquiry', id: '11', subject: 'Mixer RFQ',
          product_interest: 'Mixer', requirement_text: 'Need a mixer',
          occurred_at: '2026-09-24T00:00:00.000Z', submission_type: 'sales_lead'
        }] };
    }
  });
  const pending = await repository.pendingBusinessReview({ limit: 30, offset: 60 });
  assert.equal(pending.total, 1);
  assert.deepEqual(pending.rows[0], {
    recordType: 'inquiry', id: 11, subject: 'Mixer RFQ',
    productInterest: 'Mixer', requirementText: 'Need a mixer',
    occurredAt: '2026-09-24T00:00:00.000Z', submissionType: 'sales_lead'
  });
  assert.match(calls[1].sql, /inquiry\.product_category_reviewed_at IS NULL/);
  assert.match(calls[1].sql, /opportunity\.product_category_reviewed_at IS NULL/);
  assert.deepEqual(calls[1].params, [30, 60]);
});
