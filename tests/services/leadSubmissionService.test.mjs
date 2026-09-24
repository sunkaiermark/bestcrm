import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import {
  approveSalesLead,
  canEditLeadSubmission,
  canReassignLeadReviewer,
  canResubmitLeadSubmission,
  canReviewLeadSubmission,
  canSubmitNewLead,
  canViewLeadSubmission,
  leadSubmissionListFilterFor,
  listEligibleQuotationEngineers,
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
const engineer = { id: 3, displayName: 'Engineer One', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] };
const supportingEngineer = { id: 9, displayName: 'Engineer Two', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] };

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
    companyWebsite: ' https://acme.example ',
    requirementText: 'Need a 6 t/h dryer'
  });

  assert.equal(updated.status, 'new');
  assert.equal(updated.companyName, 'Acme corrected');
  assert.equal(updated.companyWebsite, 'https://acme.example');
  assert.equal(updated.requirementText, 'Need a 6 t/h dryer');
  assert.equal(events[0].eventType, 'creator_edited');
  assert.equal(events[0].fromStatus, 'new');
  assert.equal(events[0].toStatus, 'new');

  await assert.rejects(
    () => updatePendingSalesLead(dependencies, salesperson, 11, {
      assignedUserId: '2',
      contactPhone: '  '
    }),
    /Phone is required/
  );
  assert.equal(events.length, 1);

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
    salesperson,
    engineer,
    supportingEngineer,
    { id: 10, isActive: false, roles: [ROLES.QUOTATION_ENGINEER] }
  ];
  assert.deepEqual(listEligibleReviewManagers(users).map((user) => user.id), [2]);
  assert.deepEqual(listEligibleSalespeople(users).map((user) => user.id), [7]);
  assert.deepEqual(listEligibleQuotationEngineers(users).map((user) => user.id), [3, 9]);
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
    companyWebsite: ' https://acme.example ',
    contactName: ' Alice ',
    contactEmail: 'BUYER@EXAMPLE.COM ',
    contactPhone: ' +65 6123 4567 ',
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
    companyWebsite: 'https://acme.example',
    contactName: 'Alice',
    contactEmail: 'buyer@example.com',
    contactPhone: '+65 6123 4567',
    country: '',
    productInterest: 'Dryer',
    productCategoryCode: '',
    confirmedProductCategoryCodes: [],
    productCategoryReviewedBy: 7,
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

test('lead submission requires company name, contact name, phone, and email independently', async () => {
  const dependencies = {
    inquiryRepository: { async createInquiry() { assert.fail('must not create'); } },
    userRepository: { async listUsersWithRoles() { return [manager]; } }
  };
  const base = {
    submissionToken: '123e4567-e89b-12d3-a456-426614174000',
    assignedUserId: '2',
    companyName: 'Acme',
    contactName: 'Alice',
    contactPhone: '+65 6123 4567',
    contactEmail: 'alice@example.com',
    requirementText: 'Need quote'
  };
  for (const [field, message] of [
    ['companyName', 'Company name is required'],
    ['contactName', 'Contact name is required'],
    ['contactPhone', 'Phone is required'],
    ['contactEmail', 'Email is required']
  ]) {
    await assert.rejects(
      () => submitSalesLead(dependencies, salesperson, { ...base, [field]: '  ' }),
      (error) => error.message === message
    );
  }
  await assert.rejects(() => submitSalesLead(dependencies, salesperson, {
    ...base,
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
    contactPhone: '+65 6123 4567',
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

  await assert.rejects(
    () => resubmitSalesLead(dependencies, salesperson, 11, {
      assignedUserId: '2',
      contactEmail: '  '
    }),
    /Email is required/
  );
  assert.equal(lead.status, 'returned');
  assert.equal(events.length, 1);

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

test('lead approval creates one active technical opportunity with assignments, todos, and audit events', async () => {
  const lead = workflowLead();
  const leadEvents = [];
  const workflowEvents = [];
  const todos = [];
  const teamAssignments = [];
  let createdOpportunityInput;
  let opportunity;
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; },
      async markConverted(id, input) {
        return { ...lead, status: 'converted', convertedOpportunityId: input.convertedOpportunityId };
      },
      async createLeadReviewEvent(input) { leadEvents.push(input); return input; }
    },
    userRepository: {
      async listUsersWithRoles() { return [manager, salesperson, engineer, supportingEngineer]; }
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
        opportunity = {
          id: 40,
          opportunityNo: '800040',
          ...input,
          salesManagerId: null,
          quotationEngineerId: null,
          technicalPlanSubmitDate: null,
          archivedAt: null
        };
        return opportunity;
      },
      async findById() { return opportunity; },
      async updateWorkflowState(id, changes) {
        opportunity = { ...opportunity, ...changes };
        return opportunity;
      }
    },
    inquiryAttachmentRepository: {
      async listByInquiry() { return []; }
    },
    attachmentRepository: {
      async listByOpportunity() { return []; },
      async createAttachment() { assert.fail('no attachment exists to reference'); }
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() { return []; },
      async addTeamMember(input) { teamAssignments.push(input); return { id: 1 }; },
      async removeTeamMember() { assert.fail('no existing assignment should be removed'); }
    },
    workflowEventRepository: {
      async create(input) { workflowEvents.push(input); return input; }
    },
    todoRepository: {
      async closePendingForOpportunity() { return []; },
      async create(input) { todos.push(input); return input; }
    }
  };

  const approved = await approveSalesLead(dependencies, manager, 11, {
    customerId: '20',
    primaryContactId: '30',
    salespersonId: '7',
    title: 'Acme dryer',
    requirementText: 'Need a dryer',
    quotationEngineerIds: ['3', '9'],
    quotationEngineerLeadId: '3',
    technicalPlanSubmitDate: '2026-10-06',
    reviewNote: 'Qualified project'
  });

  assert.equal(approved.id, 40);
  assert.equal(approved.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(approved.salesManagerId, 2);
  assert.equal(approved.quotationEngineerId, 3);
  assert.equal(approved.technicalPlanSubmitDate, '2026-10-06');
  assert.equal(createdOpportunityInput.originInquiryId, 11);
  assert.equal(workflowEvents[0].eventType, 'approve_initiation');
  assert.equal(workflowEvents[0].fromStatus, STATUSES.INITIATION_PENDING);
  assert.equal(workflowEvents[0].toStatus, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.deepEqual(todos.map((todo) => todo.assigneeUserId), [3, 9]);
  assert.ok(todos.every((todo) => todo.dueAt === '2026-10-06T23:59:59+08:00'));
  assert.deepEqual(teamAssignments.map((assignment) => assignment.userId), [9]);
  assert.equal(leadEvents[0].eventType, 'approved');
  assert.deepEqual(leadEvents[0].details, {
    attachmentsCopied: false,
    attachmentsReferenced: 0,
    opportunityInitialStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    quotationEngineerIds: [3, 9],
    technicalPlanSubmitDate: '2026-10-06'
  });
});

test('lead approval validates quotation engineers and plan date before creating an opportunity', async () => {
  const lead = workflowLead();
  const dependencies = {
    inquiryRepository: {
      async findLeadByIdForUpdate() { return lead; }
    },
    userRepository: {
      async listUsersWithRoles() { return [manager, salesperson, engineer]; }
    },
    opportunityRepository: {
      async createOpportunity() { assert.fail('invalid approval must not create an opportunity'); }
    }
  };
  const base = {
    customerId: '20',
    salespersonId: '7',
    title: 'Acme dryer',
    requirementText: 'Need a dryer',
    technicalPlanSubmitDate: '2026-10-06'
  };

  await assert.rejects(
    () => approveSalesLead(dependencies, manager, 11, base),
    /Quotation engineer is required/
  );
  await assert.rejects(
    () => approveSalesLead(dependencies, manager, 11, {
      ...base,
      quotationEngineerIds: '999'
    }),
    /Quotation engineer is invalid/
  );
  await assert.rejects(
    () => approveSalesLead(dependencies, manager, 11, {
      ...base,
      quotationEngineerIds: '3',
      technicalPlanSubmitDate: '2026-02-30'
    }),
    /Plan to Submit must be a valid date/
  );
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
  let opportunity;
  const opportunityRepository = {
    async createOpportunity(input) {
      opportunity = {
        id: 40,
        opportunityNo: '800040',
        ...input,
        salesManagerId: null,
        quotationEngineerId: null,
        technicalPlanSubmitDate: null,
        archivedAt: null
      };
      return opportunity;
    },
    async findById() { return opportunity; },
    async updateWorkflowState(id, changes) {
      opportunity = { ...opportunity, ...changes };
      return opportunity;
    }
  };
  const userRepository = {
    async listUsersWithRoles() { return [manager, salesperson, engineer]; }
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
    inquiryAttachmentRepository: { async listByInquiry() { return []; } },
    attachmentRepository: { async listByOpportunity() { return []; } },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() { return []; },
      async addTeamMember() { return { id: 1 }; },
      async removeTeamMember() { return null; }
    },
    workflowEventRepository: {
      async create(input) { calls.push(['workflowEvent', input]); return input; }
    },
    todoRepository: {
      async closePendingForOpportunity() { return []; },
      async create(input) { calls.push(['todo', input]); return input; }
    },
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
    requirementText: 'Need a dryer',
    quotationEngineerIds: '3',
    quotationEngineerLeadId: '3',
    technicalPlanSubmitDate: '2026-10-06'
  });

  assert.equal(transactionCalled, true);
  assert.deepEqual(calls.find((call) => call[0] === 'link'), ['link', 55, 40, 11]);
  assert.equal(calls.find((call) => call[0] === 'transition')[1].triageStatus, 'linked_opportunity');
  assert.equal(calls.find((call) => call[0] === 'emailEvent')[1].opportunityId, 40);
  assert.equal(calls.find((call) => call[0] === 'leadEvent')[1].opportunityId, 40);
  assert.equal(calls.find((call) => call[0] === 'workflowEvent')[1].eventType, 'approve_initiation');
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
