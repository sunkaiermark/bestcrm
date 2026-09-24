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
  submission_type: 'standard',
  source_channel: 'email',
  source_reference: 'msg-1',
  source_received_at: '2026-07-30T08:00:00.000Z',
  subject: 'Need evaporator quote',
  company_name: 'Acme Co',
  company_website: 'https://acme.example',
  contact_name: 'Alice',
  contact_email: 'alice@example.com',
  contact_phone: '+1 555',
  country: 'United States',
  product_interest: 'Evaporator',
  opportunity_type: 'Expansion',
  requirement_text: 'Need wastewater evaporation package.',
  raw_payload: { messageId: 'msg-1' },
  priority: 'high',
  status: 'new',
  assigned_user_id: '7',
  assigned_display_name: 'Sales One',
  recommended_salesperson_id: '7',
  recommended_salesperson_display_name: 'Sales One',
  matched_customer_id: '20',
  matched_customer_name: 'Acme Co',
  matched_customer_website: 'https://current-acme.example',
  matched_contact_id: '30',
  matched_contact_code: 'CT000030',
  matched_contact_name: 'Alice',
  converted_opportunity_id: null,
  converted_opportunity_no: null,
  converted_opportunity_title: null,
  converted_salesperson_id: null,
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
    submissionType: 'standard',
    sourceChannel: 'email',
    sourceReference: 'msg-1',
    sourceReceivedAt: '2026-07-30T08:00:00.000Z',
    subject: 'Need evaporator quote',
    companyName: 'Acme Co',
    companyWebsite: 'https://acme.example',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '+1 555',
    country: 'United States',
    productInterest: 'Evaporator',
    productCategoryCode: '',
    confirmedProductCategoryCodes: [],
    productCategoryReviewedBy: null,
    productCategoryReviewedAt: null,
    opportunityType: 'Expansion',
    requirementText: 'Need wastewater evaporation package.',
    rawPayload: { messageId: 'msg-1' },
    priority: 'high',
    status: 'new',
    assignedUserId: 7,
    assignedDisplayName: 'Sales One',
    recommendedSalespersonId: 7,
    recommendedSalespersonDisplayName: 'Sales One',
    matchedCustomerId: 20,
    matchedCustomerName: 'Acme Co',
    matchedCustomerWebsite: 'https://current-acme.example',
    matchedContactId: 30,
    matchedContactCode: 'CT000030',
    matchedContactName: 'Alice',
    convertedOpportunityId: null,
    convertedOpportunityNo: '',
    convertedOpportunityTitle: '',
    convertedSalespersonId: null,
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
  assert.match(queryTarget.queries[0].sql, /matched_contact\.contact_code AS matched_contact_code/);
  assert.match(queryTarget.queries[0].sql, /i\.company_website/);
  assert.match(queryTarget.queries[0].sql, /matched_customer\.website AS matched_customer_website/);
  assert.match(queryTarget.queries[0].sql, /i\.status = \$1/);
  assert.match(queryTarget.queries[0].sql, /i\.source = \$2/);
  assert.match(queryTarget.queries[0].sql, /i\.assigned_user_id = \$3 OR i\.created_by = \$3/);
  assert.deepEqual(queryTarget.queries[0].params, ['new', 'email', 7]);
});

test('inquiry repository excludes filtered statuses when requested', async () => {
  const queryTarget = createFakeQueryTarget([inquiryRow]);
  const repository = createInquiryRepository(queryTarget);

  await repository.listInquiries({ excludeStatuses: ['spam', 'archived'] });

  assert.match(queryTarget.queries[0].sql, /i\.status NOT IN \(\$1, \$2\)/);
  assert.deepEqual(queryTarget.queries[0].params, ['spam', 'archived']);
});

test('inquiry repository filters the active lead queue by an explicit status set', async () => {
  const queryTarget = createFakeQueryTarget([inquiryRow]);
  const repository = createInquiryRepository(queryTarget);

  await repository.listInquiries({
    submissionType: 'sales_lead',
    statuses: ['new', 'returned']
  });

  assert.match(queryTarget.queries[0].sql, /i\.submission_type = \$1/);
  assert.match(queryTarget.queries[0].sql, /i\.status IN \(\$2, \$3\)/);
  assert.match(queryTarget.queries[0].sql, /WHEN 'new' THEN 1/);
  assert.match(queryTarget.queries[0].sql, /WHEN 'returned' THEN 2/);
  assert.deepEqual(queryTarget.queries[0].params, ['sales_lead', 'new', 'returned']);
});

test('inquiry repository searches, date-filters, counts, and paginates inquiries', async () => {
  const queryTarget = createFakeQueryTarget([
    [inquiryRow],
    [{ count: 120 }]
  ]);
  const repository = createInquiryRepository(queryTarget);
  const filter = {
    assignedUserId: 7,
    searchTerm: 'Acme_100%',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31'
  };

  await repository.listInquiries({ ...filter, limit: 50, offset: 50 });
  const count = await repository.countInquiries(filter);

  assert.equal(count, 120);
  assert.match(queryTarget.queries[0].sql, /i\.subject ILIKE \$2 ESCAPE/);
  assert.match(queryTarget.queries[0].sql, /i\.contact_email ILIKE \$2 ESCAPE/);
  assert.match(queryTarget.queries[0].sql, /AT TIME ZONE 'Asia\/Singapore'\)?:?::date >= \$3::date/);
  assert.match(queryTarget.queries[0].sql, /AT TIME ZONE 'Asia\/Singapore'\)?:?::date <= \$4::date/);
  assert.match(queryTarget.queries[0].sql, /source_received_at > now\(\) \+ interval '1 day'/);
  assert.match(queryTarget.queries[0].sql, /LIMIT \$5 OFFSET \$6/);
  assert.deepEqual(queryTarget.queries[0].params, [7, '%Acme\\_100\\%%', '2026-07-01', '2026-07-31', 50, 50]);
  assert.match(queryTarget.queries[1].sql, /SELECT count\(\*\)::int AS count/);
  assert.doesNotMatch(queryTarget.queries[1].sql, /LIMIT/);
  assert.deepEqual(queryTarget.queries[1].params, [7, '%Acme\\_100\\%%', '2026-07-01', '2026-07-31']);
});

test('inquiry repository creates review and conversion updates', async () => {
  const queryTarget = createFakeQueryTarget([
    [{ ...inquiryRow, id: '12' }],
    [{ ...inquiryRow, status: 'reviewing', review_note: 'Qualified' }],
    [{ ...inquiryRow, status: 'converted', converted_opportunity_id: '40' }],
    [{ ...inquiryRow, status: 'customer_saved' }],
    []
  ]);
  const repository = createInquiryRepository(queryTarget);

  await repository.createInquiry({
    source: 'manual',
    submissionType: 'standard',
    sourceChannel: 'manual',
    sourceReference: '',
    sourceReceivedAt: null,
    subject: 'Manual RFQ',
    companyName: 'Beta',
    companyWebsite: 'https://beta.example',
    contactName: 'Bob',
    contactEmail: 'bob@example.com',
    contactPhone: '',
    country: 'Singapore',
    productInterest: 'Dryer',
    opportunityType: 'New build',
    requirementText: 'Need dryer quote',
    rawPayload: {},
    priority: 'normal',
    status: 'new',
    assignedUserId: 7,
    recommendedSalespersonId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: 7,
    reviewNote: ''
  });
  assert.match(queryTarget.queries[0].sql, /INSERT INTO inquiries/);
  assert.match(queryTarget.queries[0].sql, /ON CONFLICT \(source, source_reference\)/);
  assert.equal(queryTarget.queries[0].params.length, 27);
  assert.equal(queryTarget.queries[0].params[24], '');
  assert.deepEqual(queryTarget.queries[0].params.slice(0, 6), ['manual', 'standard', 'manual', '', null, 'Manual RFQ']);
  assert.equal(queryTarget.queries[0].params[7], 'https://beta.example');
  assert.equal(queryTarget.queries[0].params[15], '{}');

  await repository.updateReview(12, {
    status: 'reviewing',
    priority: 'high',
    assignedUserId: 8,
    matchedCustomerId: 20,
    matchedContactId: 30,
    subject: 'Manual RFQ',
    companyName: 'Beta',
    contactName: 'Bob',
    contactEmail: 'bob@example.com',
    contactPhone: '',
    country: 'Singapore',
    productInterest: 'Dryer',
    opportunityType: 'New build',
    requirementText: 'Need dryer quote',
    reviewNote: 'Qualified',
    reviewedBy: 7
  });
  assert.match(queryTarget.queries[1].sql, /UPDATE inquiries/);
  assert.match(queryTarget.queries[1].sql, /reviewed_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[1].params, [
    'reviewing', 'high', 8, 20, 30,
    'Manual RFQ', 'Beta', 'Bob', 'bob@example.com', '', 'Singapore', 'Dryer', 'New build',
    'Need dryer quote', 'Qualified', 7, 12, '', [], 7
  ]);

  await repository.markConverted(12, {
    matchedCustomerId: 20,
    matchedContactId: 30,
    convertedOpportunityId: 40,
    reviewedBy: 7
  });
  assert.match(queryTarget.queries[2].sql, /status = 'converted'/);
  assert.deepEqual(queryTarget.queries[2].params, [20, 30, 40, 7, 12, '', []]);

  await repository.markDisposition(12, {
    status: 'customer_saved',
    matchedCustomerId: 20,
    matchedContactId: null,
    reviewNote: 'Customer only',
    reviewedBy: 7
  });
  assert.match(queryTarget.queries[3].sql, /status = \$1/);
  assert.match(queryTarget.queries[3].sql, /status IN \('new', 'reviewing'\)/);
  assert.deepEqual(queryTarget.queries[3].params, ['customer_saved', 20, null, 'Customer only', 7, 12]);

  assert.equal(await repository.deleteById(12), false);
  assert.match(queryTarget.queries[4].sql, /DELETE FROM inquiries/);
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
    opportunityType: '',
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

test('inquiry repository locks and transitions leads while recording immutable review history', async () => {
  const leadRow = { ...inquiryRow, submission_type: 'sales_lead', status: 'new' };
  const eventRow = {
    id: '91',
    inquiry_id: '11',
    event_type: 'reviewer_reassigned',
    from_status: 'returned',
    to_status: 'returned',
    actor_user_id: '1',
    actor_display_name: 'Administrator',
    assigned_user_id: '8',
    assigned_display_name: 'Sales Manager Two',
    opportunity_id: null,
    opportunity_no: null,
    reason: 'Coverage change',
    details: { previousAssignedUserId: 7 },
    created_at: '2026-09-22T01:00:00.000Z'
  };
  const queryTarget = createFakeQueryTarget([
    [leadRow],
    [{ ...leadRow, status: 'returned', review_note: 'Need more detail' }],
    [{ ...leadRow, status: 'rejected', review_note: 'Not a business lead' }],
    [{ ...leadRow, status: 'new', assigned_user_id: '8' }],
    [{ ...leadRow, status: 'returned', assigned_user_id: '8' }],
    [eventRow],
    [eventRow]
  ]);
  const repository = createInquiryRepository(queryTarget);

  const locked = await repository.findLeadByIdForUpdate(11);
  const returned = await repository.returnLead(11, {
    reason: 'Need more detail',
    actorUserId: 7
  });
  const rejected = await repository.rejectLead(11, {
    reason: 'Not a business lead',
    actorUserId: 7
  });
  const resubmitted = await repository.resubmitLead(11, {
    sourceChannel: 'email',
    subject: 'Updated RFQ',
    companyName: 'Acme Co',
    companyWebsite: 'https://updated-acme.example',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '+1 555',
    country: 'United States',
    productInterest: 'Evaporator',
    opportunityType: 'Expansion',
    requirementText: 'Updated requirement',
    priority: 'high',
    assignedUserId: 8,
    recommendedSalespersonId: 7,
    actorUserId: 7
  });
  const reassigned = await repository.reassignLeadReviewer(11, { assignedUserId: 8 });
  const createdEvent = await repository.createLeadReviewEvent({
    inquiryId: 11,
    eventType: 'reviewer_reassigned',
    fromStatus: 'returned',
    toStatus: 'returned',
    actorUserId: 1,
    assignedUserId: 8,
    reason: 'Coverage change',
    details: { previousAssignedUserId: 7 }
  });
  const events = await repository.listLeadReviewEvents(11);

  assert.equal(locked.submissionType, 'sales_lead');
  assert.equal(returned.status, 'returned');
  assert.equal(rejected.status, 'rejected');
  assert.equal(resubmitted.assignedUserId, 8);
  assert.equal(reassigned.status, 'returned');
  assert.equal(createdEvent.id, '91');
  assert.deepEqual(events, [{
    id: 91,
    inquiryId: 11,
    eventType: 'reviewer_reassigned',
    fromStatus: 'returned',
    toStatus: 'returned',
    actorUserId: 1,
    actorDisplayName: 'Administrator',
    assignedUserId: 8,
    assignedDisplayName: 'Sales Manager Two',
    opportunityId: null,
    opportunityNo: '',
    reason: 'Coverage change',
    details: { previousAssignedUserId: 7 },
    createdAt: '2026-09-22T01:00:00.000Z'
  }]);

  assert.match(queryTarget.queries[0].sql, /submission_type = 'sales_lead'/);
  assert.match(queryTarget.queries[0].sql, /FOR UPDATE OF i/);
  assert.match(queryTarget.queries[1].sql, /status = 'returned'/);
  assert.match(queryTarget.queries[1].sql, /assigned_user_id = \$3/);
  assert.deepEqual(queryTarget.queries[1].params, [11, 'Need more detail', 7]);
  assert.match(queryTarget.queries[2].sql, /status = 'rejected'/);
  assert.deepEqual(queryTarget.queries[2].params, [11, 'Not a business lead', 7]);
  assert.match(queryTarget.queries[3].sql, /status = 'returned'/);
  assert.match(queryTarget.queries[3].sql, /company_website = \$5/);
  assert.match(queryTarget.queries[3].sql, /created_by = \$16/);
  assert.equal(queryTarget.queries[3].params[4], 'https://updated-acme.example');
  assert.equal(queryTarget.queries[3].params[15], 7);
  assert.match(queryTarget.queries[4].sql, /status IN \('new', 'returned'\)/);
  assert.deepEqual(queryTarget.queries[4].params, [11, 8]);
  assert.match(queryTarget.queries[5].sql, /INSERT INTO lead_review_events/);
  assert.deepEqual(queryTarget.queries[5].params, [
    11,
    'reviewer_reassigned',
    'returned',
    'returned',
    1,
    8,
    null,
    'Coverage change',
    '{"previousAssignedUserId":7}'
  ]);
  assert.match(queryTarget.queries[6].sql, /ORDER BY event\.id/);
  assert.deepEqual(queryTarget.queries[6].params, [11]);
});

test('pending lead update persists the customer website without changing its owner guard', async () => {
  const queryTarget = createFakeQueryTarget([{ ...inquiryRow, submission_type: 'sales_lead' }]);
  const repository = createInquiryRepository(queryTarget);

  await repository.updatePendingLead(11, {
    sourceChannel: 'email',
    subject: 'Updated RFQ',
    companyName: 'Acme Co',
    companyWebsite: 'https://new-acme.example',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '+1 555',
    country: 'United States',
    productInterest: 'Evaporator',
    opportunityType: 'Expansion',
    requirementText: 'Updated requirement',
    priority: 'high',
    assignedUserId: 8,
    recommendedSalespersonId: 7,
    actorUserId: 7
  });

  assert.match(queryTarget.queries[0].sql, /company_website = \$5/);
  assert.match(queryTarget.queries[0].sql, /created_by = \$16/);
  assert.equal(queryTarget.queries[0].params[4], 'https://new-acme.example');
  assert.equal(queryTarget.queries[0].params[15], 7);
});
