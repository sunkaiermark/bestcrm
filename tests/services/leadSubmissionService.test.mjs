import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canSubmitNewLead,
  canViewOwnLeadSubmission,
  leadSubmissionListFilterFor,
  listEligibleReviewManagers,
  submitSalesLead
} from '../../src/services/leadSubmissionService.mjs';

const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };
const manager = { id: 2, displayName: 'Sales Manager', isActive: true, roles: [ROLES.SALES_MANAGER] };

test('salespeople use a private lead receipt instead of the inquiry inbox', () => {
  assert.equal(canSubmitNewLead(salesperson), true);
  assert.equal(canSubmitNewLead(manager), false);
  assert.equal(canViewOwnLeadSubmission(salesperson, {
    submissionType: 'sales_lead',
    createdBy: 7
  }), true);
  assert.equal(canViewOwnLeadSubmission(salesperson, {
    submissionType: 'sales_lead',
    createdBy: 8
  }), false);
  assert.deepEqual(leadSubmissionListFilterFor(salesperson), {
    createdBy: 7,
    submissionType: 'sales_lead'
  });
  assert.throws(() => leadSubmissionListFilterFor(manager), /Forbidden/);
});

test('only active sales managers can review a submitted lead', () => {
  const users = [
    manager,
    { id: 3, isActive: false, roles: [ROLES.SALES_MANAGER] },
    salesperson
  ];
  assert.deepEqual(listEligibleReviewManagers(users).map((user) => user.id), [2]);
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
