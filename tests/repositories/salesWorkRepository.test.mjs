import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesWorkRepository } from '../../src/repositories/salesWorkRepository.mjs';

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

const planRow = {
  id: '11',
  salesperson_user_id: '7',
  salesperson_display_name: 'Sales One',
  plan_date: '2026-06-24',
  customer_id: '20',
  customer_name: 'Acme',
  contact_id: '30',
  contact_name: 'Buyer One',
  opportunity_id: '40',
  opportunity_no: '800010',
  opportunity_title: 'WAO system',
  activity_type: 'visit',
  subject: 'Visit customer',
  objective: 'Confirm wastewater requirement',
  planned_action: 'Meet production manager',
  status: 'planned',
  result_summary: null,
  next_step: 'Prepare technical discussion',
  created_at: '2026-06-24T08:00:00.000Z',
  updated_at: '2026-06-24T08:00:00.000Z'
};

const logRow = {
  id: '21',
  salesperson_user_id: '7',
  salesperson_display_name: 'Sales One',
  log_date: '2026-06-24',
  customer_id: '20',
  customer_name: 'Acme',
  contact_id: '30',
  contact_name: 'Buyer One',
  opportunity_id: '40',
  opportunity_no: '800010',
  opportunity_title: 'WAO system',
  activity_type: 'meeting',
  subject: 'Technical meeting',
  content: 'Discussed COD and salt concentration.',
  customer_feedback: 'Customer wants reference cases.',
  result: 'Need budgetary quote',
  next_step: 'Send reference list',
  next_plan_date: '2026-06-25',
  created_at: '2026-06-24T09:00:00.000Z',
  updated_at: '2026-06-24T09:00:00.000Z'
};

test('sales work repository creates plan records', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '11', created_at: '2026-06-24T08:00:00.000Z', updated_at: '2026-06-24T08:00:00.000Z' }]);
  const repository = createSalesWorkRepository(queryTarget);

  const plan = await repository.createPlan({
    salespersonUserId: 7,
    planDate: '2026-06-24',
    customerId: 20,
    contactId: 30,
    opportunityId: 40,
    activityType: 'visit',
    subject: 'Visit customer',
    objective: 'Confirm wastewater requirement',
    plannedAction: 'Meet production manager',
    nextStep: 'Prepare technical discussion'
  });

  assert.equal(plan.id, 11);
  assert.equal(plan.status, 'planned');
  assert.equal(plan.salespersonUserId, 7);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO sales_work_plans/);
  assert.deepEqual(queryTarget.queries[0].params, [
    7,
    '2026-06-24',
    20,
    30,
    40,
    'visit',
    'Visit customer',
    'Confirm wastewater requirement',
    'Meet production manager',
    'Prepare technical discussion'
  ]);
});

test('sales work repository lists plan records with linked CRM names', async () => {
  const queryTarget = createFakeQueryTarget([planRow]);
  const repository = createSalesWorkRepository(queryTarget);

  const plans = await repository.listPlans({
    salespersonUserId: 7,
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    status: 'planned'
  });

  assert.deepEqual(plans, [{
    id: 11,
    salespersonUserId: 7,
    salespersonDisplayName: 'Sales One',
    planDate: '2026-06-24',
    customerId: 20,
    customerName: 'Acme',
    contactId: 30,
    contactName: 'Buyer One',
    opportunityId: 40,
    opportunityNo: '800010',
    opportunityTitle: 'WAO system',
    activityType: 'visit',
    subject: 'Visit customer',
    objective: 'Confirm wastewater requirement',
    plannedAction: 'Meet production manager',
    status: 'planned',
    resultSummary: '',
    nextStep: 'Prepare technical discussion',
    createdAt: '2026-06-24T08:00:00.000Z',
    updatedAt: '2026-06-24T08:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM sales_work_plans swp/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN customers c/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN contacts ct/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN opportunities o/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY swp\.plan_date DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [7, '2026-06-01', '2026-06-30', 'planned']);
});

test('sales work repository finds one plan by id with linked CRM names', async () => {
  const queryTarget = createFakeQueryTarget([planRow]);
  const repository = createSalesWorkRepository(queryTarget);

  const plan = await repository.findPlanById(11);

  assert.equal(plan.id, 11);
  assert.equal(plan.customerName, 'Acme');
  assert.match(queryTarget.queries[0].sql, /FROM sales_work_plans swp/);
  assert.match(queryTarget.queries[0].sql, /WHERE swp\.id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [11]);
});

test('sales work repository updates plan status and result fields', async () => {
  const queryTarget = createFakeQueryTarget([{ ...planRow, status: 'completed', result_summary: 'Meeting completed' }]);
  const repository = createSalesWorkRepository(queryTarget);

  const plan = await repository.updatePlanStatus(11, {
    status: 'completed',
    resultSummary: 'Meeting completed',
    nextStep: 'Create technical proposal'
  });

  assert.equal(plan.status, 'completed');
  assert.equal(plan.resultSummary, 'Meeting completed');
  assert.match(queryTarget.queries[0].sql, /UPDATE sales_work_plans/);
  assert.match(queryTarget.queries[0].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[0].params, [
    'completed',
    'Meeting completed',
    'Create technical proposal',
    11
  ]);
});

test('sales work repository updates plan editable fields', async () => {
  const queryTarget = createFakeQueryTarget([{ ...planRow, subject: 'Updated visit', plan_date: '2026-06-25' }]);
  const repository = createSalesWorkRepository(queryTarget);

  const plan = await repository.updatePlan(11, {
    planDate: '2026-06-25',
    customerId: 20,
    contactId: 30,
    opportunityId: 40,
    activityType: 'meeting',
    subject: 'Updated visit',
    objective: 'Confirm final scope',
    plannedAction: 'Meet procurement',
    nextStep: 'Send meeting minutes'
  });

  assert.equal(plan.subject, 'Updated visit');
  assert.match(queryTarget.queries[0].sql, /UPDATE sales_work_plans/);
  assert.match(queryTarget.queries[0].sql, /plan_date = \$1/);
  assert.match(queryTarget.queries[0].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[0].params, [
    '2026-06-25',
    20,
    30,
    40,
    'meeting',
    'Updated visit',
    'Confirm final scope',
    'Meet procurement',
    'Send meeting minutes',
    11
  ]);
});

test('sales work repository creates and lists log records', async () => {
  const queryTarget = createFakeQueryTarget([
    [{ id: '21', created_at: '2026-06-24T09:00:00.000Z', updated_at: '2026-06-24T09:00:00.000Z' }],
    [logRow]
  ]);
  const repository = createSalesWorkRepository(queryTarget);

  const log = await repository.createLog({
    salespersonUserId: 7,
    logDate: '2026-06-24',
    customerId: 20,
    contactId: 30,
    opportunityId: 40,
    activityType: 'meeting',
    subject: 'Technical meeting',
    content: 'Discussed COD and salt concentration.',
    customerFeedback: 'Customer wants reference cases.',
    result: 'Need budgetary quote',
    nextStep: 'Send reference list',
    nextPlanDate: '2026-06-25'
  });

  assert.equal(log.id, 21);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO sales_work_logs/);

  const logs = await repository.listLogs({ salespersonUserId: 7, opportunityId: 40 });

  assert.equal(logs[0].id, 21);
  assert.equal(logs[0].content, 'Discussed COD and salt concentration.');
  assert.equal(logs[0].customerFeedback, 'Customer wants reference cases.');
  assert.equal(logs[0].nextPlanDate, '2026-06-25');
  assert.match(queryTarget.queries[1].sql, /FROM sales_work_logs swl/);
  assert.match(queryTarget.queries[1].sql, /WHERE swl\.salesperson_user_id = \$1/);
  assert.match(queryTarget.queries[1].sql, /swl\.opportunity_id = \$2/);
  assert.deepEqual(queryTarget.queries[1].params, [7, 40]);
});

test('sales work repository updates log editable fields', async () => {
  const queryTarget = createFakeQueryTarget([{ ...logRow, subject: 'Updated meeting' }]);
  const repository = createSalesWorkRepository(queryTarget);

  const log = await repository.updateLog(21, {
    logDate: '2026-06-25',
    customerId: 20,
    contactId: 30,
    opportunityId: 40,
    activityType: 'meeting',
    subject: 'Updated meeting',
    content: 'Confirmed technical scope.',
    customerFeedback: 'Need formal quotation.',
    result: 'Commercial quote required',
    nextStep: 'Upload quote',
    nextPlanDate: '2026-06-26'
  });

  assert.equal(log.subject, 'Updated meeting');
  assert.match(queryTarget.queries[0].sql, /UPDATE sales_work_logs/);
  assert.match(queryTarget.queries[0].sql, /log_date = \$1/);
  assert.match(queryTarget.queries[0].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[0].params, [
    '2026-06-25',
    20,
    30,
    40,
    'meeting',
    'Updated meeting',
    'Confirmed technical scope.',
    'Need formal quotation.',
    'Commercial quote required',
    'Upload quote',
    '2026-06-26',
    21
  ]);
});

test('sales work repository summarizes plans and logs for reports', async () => {
  const queryTarget = createFakeQueryTarget([{
    salesperson_user_id: '7',
    salesperson_display_name: 'Sales One',
    total_plans: '5',
    completed_plans: '3',
    cancelled_plans: '1',
    overdue_plans: '1',
    total_logs: '4',
    linked_customers: '2',
    linked_opportunities: '3'
  }]);
  const repository = createSalesWorkRepository(queryTarget);

  const report = await repository.summarizeSalesWork({
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
    salespersonUserId: 7
  });

  assert.deepEqual(report, [{
    salespersonUserId: 7,
    salespersonDisplayName: 'Sales One',
    totalPlans: 5,
    completedPlans: 3,
    cancelledPlans: 1,
    overduePlans: 1,
    totalLogs: 4,
    linkedCustomers: 2,
    linkedOpportunities: 3
  }]);
  assert.match(queryTarget.queries[0].sql, /WITH plan_summary AS/);
  assert.match(queryTarget.queries[0].sql, /log_summary AS/);
  assert.deepEqual(queryTarget.queries[0].params, ['2026-06-01', '2026-06-30', 7]);
});
