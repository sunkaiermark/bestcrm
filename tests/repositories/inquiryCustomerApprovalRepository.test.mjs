import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquiryCustomerApprovalRepository } from '../../src/repositories/inquiryCustomerApprovalRepository.mjs';

function createFakeQueryTarget(rowsByQuery = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      const rows = rowsByQuery.shift() || [];
      return { rows, rowCount: rows.length };
    }
  };
}

const approvalRow = {
  id: '80',
  inquiry_id: '11',
  customer_id: '20',
  customer_name: 'Acme',
  requested_by: '7',
  requester_display_name: 'Sales One',
  customer_owner_user_id: '8',
  customer_owner_display_name: 'Sales Two',
  reviewer_user_id: '2',
  reviewer_display_name: 'Sales Manager',
  status: 'pending',
  request_payload: { title: 'Acme project' },
  decision_note: '',
  decided_by: null,
  decided_by_display_name: null,
  decided_at: null,
  converted_opportunity_id: null,
  converted_opportunity_no: null,
  created_at: '2026-08-22T08:00:00.000Z',
  updated_at: '2026-08-22T08:00:00.000Z'
};

test('inquiry customer approval repository creates and maps a pending request', async () => {
  const queryTarget = createFakeQueryTarget([
    [{ id: '80' }],
    [approvalRow]
  ]);
  const repository = createInquiryCustomerApprovalRepository(queryTarget);

  const approval = await repository.createPending({
    inquiryId: 11,
    customerId: 20,
    requestedBy: 7,
    customerOwnerUserId: 8,
    reviewerUserId: 2,
    matchedContactId: null,
    requestPayload: { title: 'Acme project' }
  });

  assert.equal(approval.id, 80);
  assert.equal(approval.customerName, 'Acme');
  assert.equal(approval.requesterDisplayName, 'Sales One');
  assert.equal(approval.customerOwnerUserId, 8);
  assert.equal(approval.reviewerUserId, 2);
  assert.deepEqual(approval.requestPayload, { title: 'Acme project' });
  assert.match(queryTarget.queries[0].sql, /SET status = 'customer_approval_pending'/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO inquiry_customer_approvals/);
  assert.deepEqual(queryTarget.queries[0].params, [
    11,
    20,
    7,
    8,
    2,
    '{"title":"Acme project"}',
    null
  ]);
  assert.match(queryTarget.queries[1].sql, /WHERE approval\.id = \$1/);
});

test('approval completion locks the approval and inquiry and creates opportunity for requester', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      id: '40',
      opportunity_no: '800040',
      title: 'Acme project',
      customer_id: '20',
      primary_contact_id: '30',
      salesperson_id: '7'
    }
  ]]);
  const repository = createInquiryCustomerApprovalRepository(queryTarget);

  const opportunity = await repository.completeApproval(80, {
    decidedBy: 2,
    decisionNote: 'Approved',
    primaryContactId: null,
    newContactName: 'Alice',
    newContactTitle: 'Director',
    newContactPhone: '123',
    newContactEmail: 'alice@example.com',
    newContactNotes: 'Need quote',
    title: 'Acme project',
    requirement: 'Need quote',
    estimatedAmount: 1000,
    productInterest: 'Evaporator',
    projectType: 'Expansion',
    deliveryCycle: '90 days',
    expectedBidDate: '2026-10-01',
    allowAnyReviewer: false,
    inquiryId: 11
  });

  assert.deepEqual(opportunity, {
    id: 40,
    opportunityNo: '800040',
    title: 'Acme project',
    customerId: 20,
    primaryContactId: 30,
    salespersonId: 7
  });
  assert.match(queryTarget.queries[0].sql, /FOR UPDATE OF approval, inquiry/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO contacts/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunities/);
  assert.match(queryTarget.queries[0].sql, /request\.requested_by/);
  assert.match(queryTarget.queries[0].sql, /inquiry\.status = 'customer_approval_pending'/);
  assert.match(queryTarget.queries[0].sql, /SET status = 'approved'/);
  assert.deepEqual(queryTarget.queries[0].params, [
    80, 2, 'Approved', null, 'Alice', 'Director', '123', 'alice@example.com', 'Need quote',
    'Acme project', 'Need quote', 1000, 'Evaporator', 'Expansion', '90 days', '2026-10-01',
    false, 11
  ]);
});

test('approval rejection returns the inquiry to the requesting salesperson', async () => {
  const queryTarget = createFakeQueryTarget([[{ id: '11' }]]);
  const repository = createInquiryCustomerApprovalRepository(queryTarget);

  const rejected = await repository.rejectAndReturnInquiry(80, {
    decidedBy: 2,
    decisionNote: 'Wrong customer',
    allowAnyReviewer: false,
    inquiryId: 11
  });

  assert.equal(rejected, true);
  assert.match(queryTarget.queries[0].sql, /FOR UPDATE OF approval, inquiry/);
  assert.match(queryTarget.queries[0].sql, /SET status = 'rejected'/);
  assert.match(queryTarget.queries[0].sql, /SET status = 'reviewing'/);
  assert.match(queryTarget.queries[0].sql, /assigned_user_id = rejected\.requested_by/);
  assert.deepEqual(queryTarget.queries[0].params, [80, 2, 'Wrong customer', false, 11]);
});
