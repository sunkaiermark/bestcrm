import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  approveSalesLead,
  canEditLeadSubmission,
  canReassignLeadReviewer,
  canResubmitLeadSubmission,
  canReviewLeadSubmission,
  canSubmitNewLead,
  canViewLeadSubmission,
  leadSubmissionListFilterFor,
  listEligibleReviewManagers,
  listEligibleSalespeople,
  reassignLeadReviewer,
  rejectSalesLead,
  resubmitSalesLead,
  returnSalesLead,
  submitSalesLead,
  updatePendingSalesLead
} from '../../src/services/leadSubmissionService.mjs';

const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };
const manager = { id: 2, displayName: 'Sales Manager', isActive: true, roles: [ROLES.SALES_MANAGER] };

test('salespeople see their own leads while managers can use the shared lead list', () => {
  assert.equal(canSubmitNewLead(salesperson), true);
  assert.equal(canSubmitNewLead(manager), true);
  assert.equal(canViewLeadSubmission(salesperson, {
    submissionType: 'sales_lead',
    createdBy: 7
  }), true);
  assert.equal(canViewLeadSubmission(salesperson, {
    submissionType: 'sales_lead',
    createdBy: 8
  }), false);
  assert.equal(canViewLeadSubmission(manager, {
    submissionType: 'sales_lead',
    createdBy: 8
  }), true);
  assert.deepEqual(leadSubmissionListFilterFor(salesperson), {
    createdBy: 7,
    submissionType: 'sales_lead',
    statuses: ['new', 'returned']
  });
  assert.deepEqual(leadSubmissionListFilterFor(manager), {
    submissionType: 'sales_lead',
    statuses: ['new', 'returned']
  });
  assert.deepEqual(leadSubmissionListFilterFor(manager, 'processed'), {
    submissionType: 'sales_lead',
    statuses: ['converted', 'rejected']
  });
});

test('every active CRM user can submit while only the assigned sales manager can decide', () => {
  const engineer = { id: 9, isActive: true, roles: [ROLES.QUOTATION_ENGINEER] };
  const assignedLead = {
    submissionType: 'sales_lead',
    status: 'new',
    assignedUserId: 2,
    createdBy: 9
  };
  assert.equal(canSubmitNewLead(engineer), true);
  assert.equal(canSubmitNewLead({ ...engineer, isActive: false }), false);
  assert.equal(canReviewLeadSubmission(manager, assignedLead), true);
  assert.equal(canReviewLeadSubmission({ ...manager, id: 3 }, assignedLead), false);
  assert.equal(canResubmitLeadSubmission(engineer, { ...assignedLead, status: 'returned' }), true);
  assert.equal(canEditLeadSubmission(engineer, assignedLead), true);
  assert.equal(canEditLeadSubmission(engineer, { ...assignedLead, status: 'returned' }), true);
  assert.equal(canEditLeadSubmission(engineer, { ...assignedLead, status: 'converted' }), false);
  assert.equal(canReassignLeadReviewer({ id: 1, isActive: true, roles: [ROLES.ADMINISTRATOR] }, assignedLead), true);
  assert.equal(canReviewLeadSubmission({
    id: 2,
    isActive: true,
    roles: [ROLES.ADMINISTRATOR]
  }, assignedLead), false);
});

test('creator can edit a pending lead without changing its status and the edit is audited', async () => {
  let lead = workflowLead();
  const events = [];
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; },
      async updatePendingLead(id, input) {
        lead = { ...lead, ...input, status: 'new' };
        return lead;
      },
      async createLeadReviewEvent(input) { events.push(input); return input; }
    },
    userRepository: {
      async listUsersWithRoles() { return [manager, salesperson]; }
    }
  };

  const updated = await updatePendingSalesLead(dependencies, salesperson, 11, {
    sourceChannel: 'referral',
    assignedUserId: '2',
    companyName: 'Acme corrected',
    requirementText: 'Need a 6 t/h dryer'
  });

  assert.equal(updated.status, 'new');
  assert.equal(updated.companyName, 'Acme corrected');
  assert.equal(updated.requirementText, 'Need a 6 t/h dryer');
  assert.equal(events[0].eventType, 'creator_edited');
  assert.equal(events[0].fromStatus, 'new');
  assert.equal(events[0].toStatus, 'new');

  await assert.rejects(
    () => updatePendingSalesLead(dependencies, { ...salesperson, id: 8 }, 11, {
      assignedUserId: '2',
      companyName: 'Wrong owner',
      requirementText: 'Must not update'
    }),
    /Forbidden/
  );
});

test('only active sales managers can review a submitted lead', () => {
  const users = [
    manager,
    { id: 3, isActive: false, roles: [ROLES.SALES_MANAGER] },
    salesperson
  ];
  assert.deepEqual(listEligibleReviewManagers(users).map((user) => user.id), [2]);
  assert.deepEqual(listEligibleSalespeople(users).map((user) => user.id), [7]);
});

test('salesperson submission becomes a manager-assigned inquiry with salesperson recommendation', async () => {
  const calls = [];
  const inquiry = await submitSalesLead({
    inquiryRepository: {
      async createInquiry(input) {
        calls.push(input);
        return { id: 11, ...input };
      }
    },
    userRepository: {
      async listUsersWithRoles() {
        return [manager, salesperson];
      }
    }
  }, salesperson, {
    submissionToken: '123e4567-e89b-12d3-a456-426614174000',
    assignedUserId: '2',
    sourceChannel: 'exhibition',
    companyName: ' Acme ',
    contactEmail: 'BUYER@EXAMPLE.COM ',
    productInterest: ' Dryer ',
    opportunityType: ' New project ',
    requirementText: ' Need a drying line ',
    priority: 'high'
  });

  assert.equal(inquiry.id, 11);
  assert.deepEqual(calls, [{
    source: 'manual',
    submissionType: 'sales_lead',
    sourceChannel: 'exhibition',
    sourceReference: 'sales-lead:7:123e4567-e89b-12d3-a456-426614174000',
    sourceReceivedAt: null,
    subject: '',
    companyName: 'Acme',
    contactName: '',
    contactEmail: 'buyer@example.com',
    contactPhone: '',
    country: '',
    productInterest: 'Dryer',
    opportunityType: 'New project',
    requirementText: 'Need a drying line',
    rawPayload: { intakeKind: 'sales_lead', sourceChannel: 'exhibition' },
    priority: 'high',
    status: 'new',
    assignedUserId: 2,
    recommendedSalespersonId: 7,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: 7,
    reviewNote: ''
  }]);
});

test('lead submission rejects missing identity and non-manager assignment', async () => {
  const dependencies = {
    inquiryRepository: { async createInquiry() { assert.fail('must not create'); } },
    userRepository: { async listUsersWithRoles() { return [manager]; } }
  };
  const base = {
    submissionToken: '123e4567-e89b-12d3-a456-426614174000',
    assignedUserId: '2',
    requirementText: 'Need quote'
  };
  await assert.rejects(() => submitSalesLead(dependencies, salesperson, base), /Company or contact is required/);
  await assert.rejects(() => submitSalesLead(dependencies, salesperson, {
    ...base,
    companyName: 'Acme',
    assignedUserId: '99'
  }), /Sales manager is required/);
});

function workflowLead(overrides = {}) {
  return {
    id: 11,
    submissionType: 'sales_lead',
    sourceChannel: 'other',
    rawPayload: {},
    subject: 'Dryer lead',
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '',
    country: 'Singapore',
    productInterest: 'Dryer',
    opportunityType: 'New project',
    requirementText: 'Need a dryer',
    priority: 'normal',
    status: 'new',
    assignedUserId: 2,
    recommendedSalespersonId: 7,
    matchedCustomerId: 20,
    matchedContactId: 30,
    createdBy: 7,
    ...overrides
  };
}

test('assigned manager return and creator resubmission create immutable workflow events', async () => {
  let lead = workflowLead();
  const events = [];
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; },
      async returnLead(id, input) {
        lead = { ...lead, status: 'returned', reviewNote: input.reason };
        return lead;
      },
      async resubmitLead(id, input) {
        lead = { ...lead, ...input, status: 'new' };
        return lead;
      },
      async createLeadReviewEvent(input) { events.push(input); return input; }
    },
    userRepository: {
      async listUsersWithRoles() { return [manager, salesperson]; }
    }
  };

  await returnSalesLead(dependencies, manager, 11, 'Please add capacity');
  assert.equal(lead.status, 'returned');
  assert.equal(events[0].eventType, 'returned');

  await resubmitSalesLead(dependencies, salesperson, 11, {
    sourceChannel: 'referral',
    assignedUserId: '2',
    companyName: 'Acme',
    requirementText: 'Need a 5 t/h dryer',
    resubmissionNote: 'Capacity added'
  });
  assert.equal(lead.status, 'new');
  assert.equal(lead.requirementText, 'Need a 5 t/h dryer');
  assert.equal(events[1].eventType, 'resubmitted');
});

test('lead approval creates one opportunity without copying lead or email attachments', async () => {
  const lead = workflowLead();
  const events = [];
  let createdOpportunityInput;
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; },
      async markConverted(id, input) {
        return { ...lead, status: 'converted', convertedOpportunityId: input.convertedOpportunityId };
      },
      async createLeadReviewEvent(input) { events.push(input); return input; }
    },
    userRepository: {
      async listUsersWithRoles() { return [manager, salesperson]; }
    },
    customerRepository: {
      async getCustomerDetail() { return { id: 20, name: 'Acme', ownerUserId: 7 }; }
    },
    contactRepository: {
      async getContactDetail() { return { id: 30, customerId: 20, customerOwnerUserId: 7 }; }
    },
    opportunityRepository: {
      async createOpportunity(input) {
        createdOpportunityInput = input;
        return { id: 40, opportunityNo: '800040', ...input };
      }
    },
    inquiryAttachmentRepository: {
      async listByInquiry() { assert.fail('lead attachments must not be copied'); }
    },
    attachmentRepository: {
      async createAttachment() { assert.fail('opportunity attachment copy must not run'); }
    }
  };

  const opportunity = await approveSalesLead(dependencies, manager, 11, {
    customerId: '20',
    primaryContactId: '30',
    salespersonId: '7',
    title: 'Acme dryer',
    requirementText: 'Need a dryer'
  });

  assert.equal(opportunity.id, 40);
  assert.equal(createdOpportunityInput.originInquiryId, 11);
  assert.equal(events[0].eventType, 'approved');
  assert.deepEqual(events[0].details, { attachmentsCopied: false });
});

test('email lead approval atomically links the unchanged canonical thread to the opportunity', async () => {
  const lead = workflowLead({
    sourceChannel: 'email',
    rawPayload: { emailThreadId: 55 }
  });
  const calls = [];
  const inquiryRepository = {
    async findLeadByIdForUpdate() { return lead; },
    async markConverted(id, input) {
      return { ...lead, status: 'converted', convertedOpportunityId: input.convertedOpportunityId };
    },
    async createLeadReviewEvent(input) { calls.push(['leadEvent', input]); return input; }
  };
  const customerRepository = {
    async getCustomerDetail() { return { id: 20, name: 'Acme', ownerUserId: 7 }; }
  };
  const contactRepository = {
    async getContactDetail() { return { id: 30, customerId: 20, customerOwnerUserId: 7 }; }
  };
  const opportunityRepository = {
    async createOpportunity(input) { return { id: 40, opportunityNo: '800040', ...input }; }
  };
  const userRepository = {
    async listUsersWithRoles() { return [manager, salesperson]; }
  };
  const emailArchiveRepository = {
    async findThreadById() {
      return { id: 55, inquiryId: 11, opportunityId: null, triageStatus: 'converted_lead' };
    },
    async linkThreadToOpportunity(threadId, opportunityId, expectedInquiryId) {
      calls.push(['link', threadId, opportunityId, expectedInquiryId]);
      return { id: threadId, inquiryId: expectedInquiryId, opportunityId };
    },
    async transitionThreadTriage(input) { calls.push(['transition', input]); return { id: 55 }; },
    async createTriageEvent(input) { calls.push(['emailEvent', input]); return input; }
  };
  let transactionCalled = false;
  const dependencies = {
    inquiryRepository,
    customerRepository,
    contactRepository,
    opportunityRepository,
    userRepository,
    emailArchiveRepository,
    emailArchiveTransaction: async (callback) => {
      transactionCalled = true;
      return callback({
        inquiryRepository,
        customerRepository,
        contactRepository,
        opportunityRepository,
        userRepository,
        emailArchiveRepository
      });
    }
  };

  await approveSalesLead(dependencies, manager, 11, {
    customerId: '20',
    primaryContactId: '30',
    salespersonId: '7',
    title: 'Acme dryer',
    requirementText: 'Need a dryer'
  });

  assert.equal(transactionCalled, true);
  assert.deepEqual(calls.find((call) => call[0] === 'link'), ['link', 55, 40, 11]);
  assert.equal(calls.find((call) => call[0] === 'transition')[1].triageStatus, 'linked_opportunity');
  assert.equal(calls.find((call) => call[0] === 'emailEvent')[1].opportunityId, 40);
  assert.equal(calls.find((call) => call[0] === 'leadEvent')[1].opportunityId, 40);
});

test('rejecting an email lead releases the canonical thread to the selected mailbox queue', async () => {
  const lead = workflowLead({
    sourceChannel: 'email',
    rawPayload: { emailThreadId: 55 }
  });
  const calls = [];
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; },
      async rejectLead() { return { ...lead, status: 'rejected' }; },
      async createLeadReviewEvent(input) { calls.push(['leadEvent', input]); return input; }
    },
    emailArchiveRepository: {
      async findThreadById() {
        return { id: 55, inquiryId: 11, opportunityId: null, triageStatus: 'converted_lead' };
      },
      async transitionThreadTriage(input) { calls.push(['transition', input]); return { id: 55 }; },
      async createTriageEvent(input) { calls.push(['emailEvent', input]); return input; },
      async releaseThreadFromInquiry(threadId, inquiryId) {
        calls.push(['release', threadId, inquiryId]);
        return { id: threadId, inquiryId: null };
      }
    }
  };

  await rejectSalesLead(dependencies, manager, 11, {
    reason: 'Not a business request',
    emailDisposition: 'non_business'
  });

  assert.equal(calls.find((call) => call[0] === 'transition')[1].triageStatus, 'archived');
  assert.deepEqual(calls.find((call) => call[0] === 'release'), ['release', 55, 11]);
  assert.equal(calls.find((call) => call[0] === 'leadEvent')[1].details.emailDisposition, 'non_business');
});

test('administrator can reassign but cannot approve without the assigned sales-manager role', async () => {
  const administrator = { id: 1, isActive: true, roles: [ROLES.ADMINISTRATOR] };
  const lead = workflowLead();
  const events = [];
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; },
      async reassignLeadReviewer(id, input) { return { ...lead, assignedUserId: input.assignedUserId }; },
      async createLeadReviewEvent(input) { events.push(input); return input; }
    },
    userRepository: {
      async listUsersWithRoles() { return [manager, salesperson]; }
    }
  };
  const reassigned = await reassignLeadReviewer(dependencies, administrator, 11, {
    assignedUserId: '2',
    reason: 'Workload balance'
  });
  assert.equal(reassigned.assignedUserId, 2);
  assert.equal(events[0].eventType, 'reviewer_reassigned');
  await assert.rejects(
    () => approveSalesLead(dependencies, administrator, 11, {}),
    /Forbidden/
  );
});
