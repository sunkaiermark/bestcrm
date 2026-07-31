import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquiryRepository } from '../../src/repositories/inquiryRepository.mjs';

function createFakeQueryTarget(rowsByQuery = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      const rows = Array.isArray(rowsByQuery[0]) ? rowsByQuery.shift() : rowsByQuery;
      return { rows, rowCount: rows.length };
    }
  };
}

const inquiryRow = {
  id: '11',
  source: 'email',
  source_reference: 'msg-1',
  source_received_at: '2026-07-30T08:00:00.000Z',
  subject: 'Need evaporator quote',
  company_name: 'Acme Co',
  contact_name: 'Alice',
  contact_email: 'alice@example.com',
  contact_phone: '+1 555',
  country: 'United States',
  product_interest: 'Evaporator',
  requirement_text: 'Need wastewater evaporation package.',
  raw_payload: { messageId: 'msg-1' },
  priority: 'high',
  status: 'new',
  assigned_user_id: '7',
  assigned_display_name: 'Sales One',
  matched_customer_id: '20',
  matched_customer_name: 'Acme Co',
  matched_contact_id: '30',
  matched_contact_name: 'Alice',
  converted_opportunity_id: null,
  converted_opportunity_no: null,
  converted_opportunity_title: null,
  created_by: '7',
  created_by_display_name: 'Sales One',
  reviewed_by: null,
  reviewed_by_display_name: null,
  reviewed_at: null,
  review_note: '',
  created_at: '2026-07-30T08:01:00.000Z',
  updated_at: '2026-07-30T08:01:00.000Z'
};

test('inquiry repository lists mapped inquiries with visibility filter', async () => {
  const queryTarget = createFakeQueryTarget([inquiryRow]);
  const repository = createInquiryRepository(queryTarget);

  const inquiries = await repository.listInquiries({ visibleToUserId: 7, status: 'new', source: 'email' });

  assert.deepEqual(inquiries, [{
    id: 11,
    source: 'email',
    sourceReference: 'msg-1',
    sourceReceivedAt: '2026-07-30T08:00:00.000Z',
    subject: 'Need evaporator quote',
    companyName: 'Acme Co',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '+1 555',
    country: 'United States',
    productInterest: 'Evaporator',
    requirementText: 'Need wastewater evaporation package.',
    rawPayload: { messageId: 'msg-1' },
    priority: 'high',
    status: 'new',
    assignedUserId: 7,
    assignedDisplayName: 'Sales One',
    matchedCustomerId: 20,
    matchedCustomerName: 'Acme Co',
    matchedContactId: 30,
    matchedContactName: 'Alice',
    convertedOpportunityId: null,
    convertedOpportunityNo: '',
    convertedOpportunityTitle: '',
    createdBy: 7,
    createdByDisplayName: 'Sales One',
    reviewedBy: null,
    reviewedByDisplayName: '',
    reviewedAt: null,
    reviewNote: '',
    createdAt: '2026-07-30T08:01:00.000Z',
    updatedAt: '2026-07-30T08:01:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM inquiries i/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users assigned/);
  assert.match(queryTarget.queries[0].sql, /i\.status = \$1/);
  assert.match(queryTarget.queries[0].sql, /i\.source = \$2/);
  assert.match(queryTarget.queries[0].sql, /i\.assigned_user_id = \$3 OR i\.created_by = \$3/);
  assert.deepEqual(queryTarget.queries[0].params, ['new', 'email', 7]);
});

test('inquiry repository creates review and conversion updates', async () => {
  const queryTarget = createFakeQueryTarget([
    [{ ...inquiryRow, id: '12' }],
    [{ ...inquiryRow, status: 'reviewing', review_note: 'Qualified' }],
    [{ ...inquiryRow, status: 'converted', converted_opportunity_id: '40' }]
  ]);
  const repository = createInquiryRepository(queryTarget);

  await repository.createInquiry({
    source: 'manual',
    sourceReference: '',
    sourceReceivedAt: null,
    subject: 'Manual RFQ',
    companyName: 'Beta',
    contactName: 'Bob',
    contactEmail: 'bob@example.com',
    contactPhone: '',
    country: 'Singapore',
    productInterest: 'Dryer',
    requirementText: 'Need dryer quote',
    rawPayload: {},
    priority: 'normal',
    status: 'new',
    assignedUserId: 7,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: 7,
    reviewNote: ''
  });
  assert.match(queryTarget.queries[0].sql, /INSERT INTO inquiries/);
  assert.match(queryTarget.queries[0].sql, /ON CONFLICT \(source, source_reference\)/);
  assert.deepEqual(queryTarget.queries[0].params.slice(0, 4), ['manual', '', null, 'Manual RFQ']);
  assert.equal(queryTarget.queries[0].params[11], '{}');

  await repository.updateReview(12, {
    status: 'reviewing',
    priority: 'high',
    assignedUserId: 8,
    matchedCustomerId: 20,
    matchedContactId: 30,
    reviewNote: 'Qualified',
    reviewedBy: 7
  });
  assert.match(queryTarget.queries[1].sql, /UPDATE inquiries/);
  assert.match(queryTarget.queries[1].sql, /reviewed_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[1].params, ['reviewing', 'high', 8, 20, 30, 'Qualified', 7, 12]);

  await repository.markConverted(12, {
    matchedCustomerId: 20,
    matchedContactId: 30,
    convertedOpportunityId: 40,
    reviewedBy: 7
  });
  assert.match(queryTarget.queries[2].sql, /status = 'converted'/);
  assert.deepEqual(queryTarget.queries[2].params, [20, 30, 40, 7, 12]);
});

test('inquiry repository returns an existing inquiry for duplicate source reference', async () => {
  const queryTarget = createFakeQueryTarget([
    [],
    [{ ...inquiryRow, source: 'website', source_reference: 'form-1' }]
  ]);
  const repository = createInquiryRepository(queryTarget);

  const inquiry = await repository.createInquiry({
    source: 'website',
    sourceReference: 'form-1',
    sourceReceivedAt: null,
    subject: 'Website RFQ',
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '',
    country: 'Singapore',
    productInterest: 'Dryer',
    requirementText: 'Need dryer quote',
    rawPayload: {},
    priority: 'normal',
    status: 'new',
    assignedUserId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: null,
    reviewNote: ''
  });

  assert.equal(inquiry.id, 11);
  assert.equal(inquiry.source, 'website');
  assert.equal(inquiry.sourceReference, 'form-1');
  assert.equal(inquiry.wasDuplicate, true);
  assert.match(queryTarget.queries[1].sql, /i\.source = \$1 AND i\.source_reference = \$2/);
  assert.deepEqual(queryTarget.queries[1].params, ['website', 'form-1']);
});
