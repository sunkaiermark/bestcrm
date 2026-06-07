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

test('workbench repository lists draft and rejected opportunities as initiation todos', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      opportunity_id: '30',
      opportunity_no: '800003',
      opportunity_title: 'Factory upgrade',
      customer_name: 'Acme Co',
      opportunity_status: STATUSES.DRAFT,
      updated_at: '2026-06-05T10:00:00.000Z'
    },
    {
      opportunity_id: '31',
      opportunity_no: '800004',
      opportunity_title: 'Line expansion',
      customer_name: 'Beta Ltd',
      opportunity_status: STATUSES.INITIATION_REJECTED,
      updated_at: '2026-06-05T09:00:00.000Z'
    }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  const todos = await repository.listOpportunityInitiationTodos(7, 5);

  assert.deepEqual(todos, [
    {
      id: 'opportunity-initiation-30',
      opportunityId: 30,
      opportunityNo: '800003',
      opportunityTitle: 'Factory upgrade',
      customerName: 'Acme Co',
      title: 'Submit opportunity initiation',
      status: 'pending',
      createdAt: '2026-06-05T10:00:00.000Z'
    },
    {
      id: 'opportunity-initiation-31',
      opportunityId: 31,
      opportunityNo: '800004',
      opportunityTitle: 'Line expansion',
      customerName: 'Beta Ltd',
      title: 'Revise and resubmit opportunity',
      status: 'pending',
      createdAt: '2026-06-05T09:00:00.000Z'
    }
  ]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunities o/);
  assert.match(queryTarget.queries[0].sql, /o\.salesperson_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.status IN \(\$2, \$3\)/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY o\.updated_at DESC, o\.id DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [7, STATUSES.DRAFT, STATUSES.INITIATION_REJECTED, 5]);
});

test('workbench repository does not expose passive created or assigned opportunity list queries', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createWorkbenchRepository(queryTarget);

  assert.equal(repository.listCreatedOpportunities, undefined);
  assert.equal(repository.listAssignedOpportunities, undefined);
  assert.deepEqual(queryTarget.queries, []);
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
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_members om/);
  assert.match(queryTarget.queries[0].sql, /om\.is_active = true/);
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
