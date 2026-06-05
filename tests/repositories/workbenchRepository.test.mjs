import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchRepository } from '../../src/repositories/workbenchRepository.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';

function createFakeQueryTarget(rowsByCall) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      const rows = rowsByCall[this.queries.length - 1] || [];
      return { rows, rowCount: rows.length };
    }
  };
}

test('workbench repository lists pending todos assigned to current user', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      id: '10',
      opportunity_id: '30',
      opportunity_no: 'OPP-001',
      opportunity_title: 'Factory upgrade',
      customer_name: 'Acme Co',
      title: 'Approve opportunity initiation',
      status: 'pending',
      created_at: '2026-06-05T10:00:00.000Z'
    }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  const todos = await repository.listPendingTodos(7, 5);

  assert.deepEqual(todos, [{
    id: 10,
    opportunityId: 30,
    opportunityNo: 'OPP-001',
    opportunityTitle: 'Factory upgrade',
    customerName: 'Acme Co',
    title: 'Approve opportunity initiation',
    status: 'pending',
    createdAt: '2026-06-05T10:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM todos t/);
  assert.match(queryTarget.queries[0].sql, /t\.assignee_user_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /t\.status = 'pending'/);
  assert.deepEqual(queryTarget.queries[0].params, [7, 5]);
});

test('workbench repository lists opportunities assigned through workflow roles and contract review steps', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      id: '31',
      opportunity_no: 'OPP-002',
      title: 'Contract review',
      customer_name: 'Beta Ltd',
      status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      estimated_amount: '50000.00',
      updated_at: '2026-06-05T11:00:00.000Z'
    }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  const opportunities = await repository.listAssignedOpportunities(6, 8);

  assert.deepEqual(opportunities, [{
    id: 31,
    opportunityNo: 'OPP-002',
    title: 'Contract review',
    customerName: 'Beta Ltd',
    status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
    estimatedAmount: 50000,
    updatedAt: '2026-06-05T11:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /o\.sales_manager_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.quotation_engineer_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /cas\.reviewer_user_id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [6, 8]);
});

test('workbench repository counts visible opportunities by workflow state', async () => {
  const queryTarget = createFakeQueryTarget([[
    { status: STATUSES.DRAFT, count: '2' },
    { status: STATUSES.INITIATION_PENDING, count: '1' }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  const counts = await repository.countByWorkflowState(7, false);

  assert.deepEqual(counts, [
    { status: STATUSES.DRAFT, count: 2 },
    { status: STATUSES.INITIATION_PENDING, count: 1 }
  ]);
  assert.match(queryTarget.queries[0].sql, /GROUP BY o\.status/);
  assert.match(queryTarget.queries[0].sql, /o\.salesperson_id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [7]);
});

test('workbench repository does not restrict state counts for administrators', async () => {
  const queryTarget = createFakeQueryTarget([[
    { status: STATUSES.DRAFT, count: '5' }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  await repository.countByWorkflowState(1, true);

  assert.doesNotMatch(queryTarget.queries[0].sql, /WHERE/);
  assert.deepEqual(queryTarget.queries[0].params, []);
});
