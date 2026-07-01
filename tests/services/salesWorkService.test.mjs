import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessSalesWork,
  canMaintainSalesWorkRecord,
  canViewSalesWorkRecord,
  createSalesWorkLog,
  createSalesWorkPlan,
  listSalesWorkLogs,
  listSalesWorkPlans,
  summarizeSalesWork,
  updateSalesWorkLog,
  updateSalesWorkPlan,
  updateSalesWorkPlanStatus
} from '../../src/services/salesWorkService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

function buildRepositories({ customer = null, contact = null, opportunity = null } = {}) {
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
      async getOpportunityDetail(id) {
        calls.push(['getOpportunity', Number(id)]);
        return opportunity;
      }
    },
    salesWorkRepository: {
      async createPlan(input) {
        calls.push(['createPlan', input]);
        return { id: 11, ...input, status: 'planned' };
      },
      async listPlans(filter) {
        calls.push(['listPlans', filter]);
        return [];
      },
      async updatePlanStatus(id, input) {
        calls.push(['updatePlanStatus', Number(id), input]);
        return { id: Number(id), ...input };
      },
      async updatePlan(id, input) {
        calls.push(['updatePlan', Number(id), input]);
        return { id: Number(id), ...input };
      },
      async createLog(input) {
        calls.push(['createLog', input]);
        return { id: 21, ...input };
      },
      async listLogs(filter) {
        calls.push(['listLogs', filter]);
        return [];
      },
      async updateLog(id, input) {
        calls.push(['updateLog', Number(id), input]);
        return { id: Number(id), ...input };
      },
      async summarizeSalesWork(filter) {
        calls.push(['summarizeSalesWork', filter]);
        return [];
      }
    }
  };
}

const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };
const otherSalesperson = { id: 8, roles: [ROLES.SALESPERSON] };
const salesManager = { id: 2, roles: [ROLES.SALES_MANAGER] };
const administrator = { id: 99, roles: [ROLES.ADMINISTRATOR] };
const quotationEngineer = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };

test('sales work access is limited to salesperson sales manager and administrator roles', () => {
  assert.equal(canAccessSalesWork(salesperson), true);
  assert.equal(canAccessSalesWork(salesManager), true);
  assert.equal(canAccessSalesWork(administrator), true);
  assert.equal(canAccessSalesWork(quotationEngineer), false);
});

test('salesperson views and maintains only own sales work records', () => {
  const ownRecord = { salespersonUserId: 7 };
  const otherRecord = { salespersonUserId: 8 };

  assert.equal(canViewSalesWorkRecord(salesperson, ownRecord), true);
  assert.equal(canViewSalesWorkRecord(salesperson, otherRecord), false);
  assert.equal(canMaintainSalesWorkRecord(salesperson, ownRecord), true);
  assert.equal(canMaintainSalesWorkRecord(salesperson, otherRecord), false);
});

test('sales manager views all sales work records but does not maintain them', () => {
  const record = { salespersonUserId: 7 };

  assert.equal(canViewSalesWorkRecord(salesManager, record), true);
  assert.equal(canMaintainSalesWorkRecord(salesManager, record), false);
});

test('administrator views and maintains all sales work records', () => {
  const record = { salespersonUserId: 7 };

  assert.equal(canViewSalesWorkRecord(administrator, record), true);
  assert.equal(canMaintainSalesWorkRecord(administrator, record), true);
});

test('salesperson plan and log lists are forced to their own user id', async () => {
  const repositories = buildRepositories();

  await listSalesWorkPlans(repositories.salesWorkRepository, salesperson, {
    salespersonUserId: 8,
    status: 'planned'
  });
  await listSalesWorkLogs(repositories.salesWorkRepository, salesperson, {
    salespersonUserId: 8,
    activityType: 'meeting'
  });

  assert.deepEqual(repositories.calls, [
    ['listPlans', { salespersonUserId: 7, status: 'planned' }],
    ['listLogs', { salespersonUserId: 7, activityType: 'meeting' }]
  ]);
});

test('sales manager and administrator can list and report all sales work', async () => {
  const repositories = buildRepositories();

  await listSalesWorkPlans(repositories.salesWorkRepository, salesManager, { salespersonUserId: 7 });
  await listSalesWorkLogs(repositories.salesWorkRepository, administrator, { salespersonUserId: 8 });
  await summarizeSalesWork(repositories.salesWorkRepository, salesManager, {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30'
  });

  assert.deepEqual(repositories.calls, [
    ['listPlans', { salespersonUserId: 7 }],
    ['listLogs', { salespersonUserId: 8 }],
    ['summarizeSalesWork', { dateFrom: '2026-06-01', dateTo: '2026-06-30' }]
  ]);
});

test('createSalesWorkPlan creates own salesperson plan after validating linked records', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 7 },
    contact: { id: 20, customerId: 10, customerOwnerUserId: 7 },
    opportunity: { id: 30, salespersonId: 7 }
  });

  const plan = await createSalesWorkPlan(repositories, salesperson, {
    salespersonUserId: 8,
    planDate: '2026-06-27',
    customerId: 10,
    contactId: 20,
    opportunityId: 30,
    activityType: 'visit',
    subject: 'Customer visit',
    objective: 'Confirm requirement',
    plannedAction: 'Visit plant',
    nextStep: 'Prepare summary'
  });

  assert.equal(plan.salespersonUserId, 7);
  assert.deepEqual(repositories.calls, [
    ['getCustomer', 10],
    ['getContact', 20],
    ['getOpportunity', 30],
    ['createPlan', {
      salespersonUserId: 7,
      planDate: '2026-06-27',
      customerId: 10,
      contactId: 20,
      opportunityId: 30,
      activityType: 'visit',
      subject: 'Customer visit',
      objective: 'Confirm requirement',
      plannedAction: 'Visit plant',
      nextStep: 'Prepare summary'
    }]
  ]);
});

test('createSalesWorkPlan rejects salesperson links outside their access', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 8 }
  });

  await assert.rejects(() => createSalesWorkPlan(repositories, salesperson, {
    planDate: '2026-06-27',
    customerId: 10,
    activityType: 'visit',
    subject: 'Customer visit'
  }), /Forbidden/);
});

test('sales manager cannot create or update sales work records for salespeople', async () => {
  const repositories = buildRepositories();

  await assert.rejects(() => createSalesWorkPlan(repositories, salesManager, {
    salespersonUserId: 7,
    planDate: '2026-06-27',
    activityType: 'visit',
    subject: 'Customer visit'
  }), /Forbidden/);

  await assert.rejects(() => updateSalesWorkPlanStatus(repositories.salesWorkRepository, salesManager, {
    id: 11,
    salespersonUserId: 7
  }, {
    status: 'completed',
    resultSummary: 'Done'
  }), /Forbidden/);
});

test('administrator can create a plan for a selected salesperson', async () => {
  const repositories = buildRepositories();

  const plan = await createSalesWorkPlan(repositories, administrator, {
    salespersonUserId: 7,
    planDate: '2026-06-27',
    activityType: 'call',
    subject: 'Manager assigned follow-up'
  });

  assert.equal(plan.salespersonUserId, 7);
  assert.deepEqual(repositories.calls, [
    ['createPlan', {
      salespersonUserId: 7,
      planDate: '2026-06-27',
      customerId: null,
      contactId: null,
      opportunityId: null,
      activityType: 'call',
      subject: 'Manager assigned follow-up',
      objective: '',
      plannedAction: '',
      nextStep: ''
    }]
  ]);
});

test('salesperson creates own log after validating linked opportunity access', async () => {
  const repositories = buildRepositories({
    opportunity: { id: 30, salespersonId: 7 }
  });

  const log = await createSalesWorkLog(repositories, salesperson, {
    salespersonUserId: 8,
    logDate: '2026-06-27',
    opportunityId: 30,
    activityType: 'meeting',
    subject: 'Technical discussion',
    content: 'Discussed COD loading.',
    customerFeedback: 'Need reference cases',
    result: 'Need budget quote',
    nextStep: 'Send cases',
    nextPlanDate: '2026-06-28'
  });

  assert.equal(log.salespersonUserId, 7);
  assert.deepEqual(repositories.calls, [
    ['getOpportunity', 30],
    ['createLog', {
      salespersonUserId: 7,
      logDate: '2026-06-27',
      customerId: null,
      contactId: null,
      opportunityId: 30,
      activityType: 'meeting',
      subject: 'Technical discussion',
      content: 'Discussed COD loading.',
      customerFeedback: 'Need reference cases',
      result: 'Need budget quote',
      nextStep: 'Send cases',
      nextPlanDate: '2026-06-28'
    }]
  ]);
});

test('salesperson updates own plan status only', async () => {
  const repositories = buildRepositories();

  await updateSalesWorkPlanStatus(repositories.salesWorkRepository, salesperson, {
    id: 11,
    salespersonUserId: 7
  }, {
    status: 'completed',
    resultSummary: 'Meeting completed',
    nextStep: 'Send quotation request'
  });

  await assert.rejects(() => updateSalesWorkPlanStatus(repositories.salesWorkRepository, salesperson, {
    id: 12,
    salespersonUserId: 8
  }, {
    status: 'cancelled'
  }), /Forbidden/);

  assert.deepEqual(repositories.calls, [
    ['updatePlanStatus', 11, {
      status: 'completed',
      resultSummary: 'Meeting completed',
      nextStep: 'Send quotation request'
    }]
  ]);
});

test('salesperson updates own plan fields after validating changed links', async () => {
  const repositories = buildRepositories({
    customer: { id: 10, ownerUserId: 7 },
    contact: { id: 20, customerId: 10, customerOwnerUserId: 7 },
    opportunity: { id: 30, salespersonId: 7 }
  });

  await updateSalesWorkPlan(repositories, salesperson, {
    id: 11,
    salespersonUserId: 7
  }, {
    planDate: '2026-06-28',
    customerId: 10,
    contactId: 20,
    opportunityId: 30,
    activityType: 'meeting',
    subject: 'Scope meeting',
    objective: 'Confirm scope',
    plannedAction: 'Meet customer',
    nextStep: 'Send summary'
  });

  await assert.rejects(() => updateSalesWorkPlan(repositories, otherSalesperson, {
    id: 11,
    salespersonUserId: 7
  }, {
    subject: 'Illegal update'
  }), /Forbidden/);

  assert.deepEqual(repositories.calls, [
    ['getCustomer', 10],
    ['getContact', 20],
    ['getOpportunity', 30],
    ['updatePlan', 11, {
      salespersonUserId: 7,
      planDate: '2026-06-28',
      customerId: 10,
      contactId: 20,
      opportunityId: 30,
      activityType: 'meeting',
      subject: 'Scope meeting',
      objective: 'Confirm scope',
      plannedAction: 'Meet customer',
      nextStep: 'Send summary'
    }]
  ]);
});

test('salesperson updates own log fields only', async () => {
  const repositories = buildRepositories({
    opportunity: { id: 30, salespersonId: 7 }
  });

  await updateSalesWorkLog(repositories, salesperson, {
    id: 21,
    salespersonUserId: 7
  }, {
    logDate: '2026-06-28',
    opportunityId: 30,
    activityType: 'meeting',
    subject: 'Follow-up meeting',
    content: 'Customer confirmed scope.',
    customerFeedback: 'Need price quickly',
    result: 'Quote required',
    nextStep: 'Prepare quote',
    nextPlanDate: '2026-06-29'
  });

  await assert.rejects(() => updateSalesWorkLog(repositories, salesManager, {
    id: 21,
    salespersonUserId: 7
  }, {
    subject: 'Manager edit'
  }), /Forbidden/);

  assert.deepEqual(repositories.calls, [
    ['getOpportunity', 30],
    ['updateLog', 21, {
      salespersonUserId: 7,
      logDate: '2026-06-28',
      customerId: null,
      contactId: null,
      opportunityId: 30,
      activityType: 'meeting',
      subject: 'Follow-up meeting',
      content: 'Customer confirmed scope.',
      customerFeedback: 'Need price quickly',
      result: 'Quote required',
      nextStep: 'Prepare quote',
      nextPlanDate: '2026-06-29'
    }]
  ]);
});

test('other roles cannot list sales work', async () => {
  const repositories = buildRepositories();

  await assert.rejects(() => listSalesWorkPlans(repositories.salesWorkRepository, quotationEngineer, {}), /Forbidden/);
  await assert.rejects(() => summarizeSalesWork(repositories.salesWorkRepository, quotationEngineer, {}), /Forbidden/);
});
