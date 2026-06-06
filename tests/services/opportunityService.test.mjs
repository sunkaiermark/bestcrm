import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageOpportunityResponsibility,
  canEditOpportunity,
  canViewOpportunity,
  createOpportunityDraft,
  updateOpportunity
} from '../../src/services/opportunityService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';

function buildRepositories({ customer, contact }) {
  const calls = [];
  return {
    calls,
    customerRepository: {
      async getCustomerDetail(id) {
        calls.push(['getCustomer', Number(id)]);
        return customer;
      }
    },
    contactRepository: {
      async getContactDetail(id) {
        calls.push(['getContact', Number(id)]);
        return contact;
      }
    },
    opportunityRepository: {
      async createOpportunity(input) {
        calls.push(['createOpportunity', input]);
        return { id: 30, ...input };
      },
      async updateOpportunity(id, input) {
        calls.push(['updateOpportunity', Number(id), input]);
        return { id: Number(id), ...input };
      }
    }
  };
}

test('salesperson creates draft opportunity referencing owned customer and contact', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 7 },
    contact: { id: 20, customerId: 10, customerOwnerUserId: 7 }
  });

  const opportunity = await createOpportunityDraft(repositories, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    title: 'Factory upgrade',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production line',
    estimatedAmount: '120000.50',
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10'
  });

  assert.equal(opportunity.status, STATUSES.DRAFT);
  assert.equal(opportunity.customerId, 10);
  assert.equal(opportunity.primaryContactId, 20);
  assert.equal(opportunity.salespersonId, 7);
  assert.equal(opportunity.opportunityNo, null);
  assert.deepEqual(repositories.calls, [
    ['getCustomer', 10],
    ['getContact', 20],
    ['createOpportunity', {
      opportunityNo: null,
      title: 'Factory upgrade',
      customerId: 10,
      primaryContactId: 20,
      requirement: 'Upgrade production line',
      estimatedAmount: 120000.50,
      projectType: 'automation',
      deliveryCycle: '45 days',
      expectedBidDate: '2026-07-10',
      status: STATUSES.DRAFT,
      salespersonId: 7
    }]
  ]);
});

test('createOpportunityDraft rejects contact from another customer', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 7 },
    contact: { id: 20, customerId: 11, customerOwnerUserId: 7 }
  });

  await assert.rejects(() => createOpportunityDraft(repositories, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    title: 'Factory upgrade',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production line'
  }), /Contact does not belong to customer/);
});

test('createOpportunityDraft rejects customers outside salesperson ownership', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 8 },
    contact: null
  });

  await assert.rejects(() => createOpportunityDraft(repositories, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    title: 'Factory upgrade',
    customerId: 10,
    requirement: 'Upgrade production line'
  }), /Forbidden/);
});

test('canViewOpportunity allows owner assignees and administrator', () => {
  const opportunity = {
    salespersonId: 1,
    salesManagerId: 2,
    quotationEngineerId: 3,
    technicalManagerId: 4,
    commercialManagerId: 5
  };

  assert.equal(canViewOpportunity({ id: 1, roles: [ROLES.SALESPERSON] }, opportunity), true);
  assert.equal(canViewOpportunity({ id: 3, roles: [ROLES.QUOTATION_ENGINEER] }, opportunity), true);
  assert.equal(canViewOpportunity({ id: 99, roles: [ROLES.ADMINISTRATOR] }, opportunity), true);
  assert.equal(canViewOpportunity({ id: 9, roles: [ROLES.SALESPERSON] }, opportunity), false);
});

test('canViewOpportunity allows active opportunity team members', () => {
  const opportunity = {
    salespersonId: 1,
    salesManagerId: null,
    quotationEngineerId: null,
    technicalManagerId: null,
    commercialManagerId: null,
    teamMembers: [
      { userId: 8, isActive: true },
      { userId: 9, isActive: false }
    ]
  };

  assert.equal(canViewOpportunity({ id: 8, roles: [ROLES.SALESPERSON] }, opportunity), true);
  assert.equal(canViewOpportunity({ id: 9, roles: [ROLES.SALESPERSON] }, opportunity), false);
});

test('owner salesperson updates opportunity fields', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 7 },
    contact: { id: 20, customerId: 10, customerOwnerUserId: 7 }
  });

  const opportunity = await updateOpportunity(repositories, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    id: 30,
    salespersonId: 7
  }, {
    title: 'Factory upgrade revised',
    customerId: '10',
    primaryContactId: '20',
    requirement: 'Upgrade production and packing lines',
    estimatedAmount: '180000',
    projectType: 'automation',
    deliveryCycle: '60 days',
    expectedBidDate: '2026-08-01'
  });

  assert.equal(opportunity.id, 30);
  assert.deepEqual(repositories.calls, [
    ['getCustomer', 10],
    ['getContact', 20],
    ['updateOpportunity', 30, {
      title: 'Factory upgrade revised',
      customerId: 10,
      primaryContactId: 20,
      requirement: 'Upgrade production and packing lines',
      estimatedAmount: 180000,
      projectType: 'automation',
      deliveryCycle: '60 days',
      expectedBidDate: '2026-08-01'
    }]
  ]);
});

test('canEditOpportunity only allows administrator or owner salesperson', () => {
  const opportunity = { salespersonId: 7 };

  assert.equal(canEditOpportunity({ id: 7, roles: [ROLES.SALESPERSON] }, opportunity), true);
  assert.equal(canEditOpportunity({ id: 99, roles: [ROLES.ADMINISTRATOR] }, opportunity), true);
  assert.equal(canEditOpportunity({ id: 8, roles: [ROLES.SALESPERSON] }, opportunity), false);
});

test('canManageOpportunityResponsibility allows administrators and Sales Managers only', () => {
  assert.equal(canManageOpportunityResponsibility({ id: 1, roles: [ROLES.ADMINISTRATOR] }), true);
  assert.equal(canManageOpportunityResponsibility({ id: 2, roles: [ROLES.SALES_MANAGER] }), true);
  assert.equal(canManageOpportunityResponsibility({ id: 7, roles: [ROLES.SALESPERSON] }), false);
});

test('updateOpportunity rejects non-owner salesperson', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 8 },
    contact: null
  });

  await assert.rejects(() => updateOpportunity(repositories, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    id: 30,
    salespersonId: 8
  }, {
    title: 'Factory upgrade revised',
    customerId: 10,
    requirement: 'Upgrade production line'
  }), /Forbidden/);

  assert.deepEqual(repositories.calls, []);
});
