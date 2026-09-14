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

test('workbench repository lists unified open work ordered by deadline for current user', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      id: '91',
      opportunity_id: '30',
      opportunity_no: 'OPP-001',
      opportunity_title: 'Factory upgrade',
      customer_name: 'Acme Co',
      assignee_user_id: '7',
      source_type: 'workflow_todo',
      source_key: 'approve_opportunity_initiation',
      role_context: 'sales',
      title: 'Approve opportunity initiation',
      description: '',
      planned_start_at: '2026-06-05T10:00:00.000Z',
      due_at: '2026-06-06T10:00:00.000Z',
      estimated_hours: '12.50',
      workload_level: 'high',
      kpi_code: 'approve_on_time',
      kpi_target: '',
      status: 'pending',
      actual_started_at: null,
      actual_completed_at: null,
      created_at: '2026-06-05T10:00:00.000Z',
      updated_at: '2026-06-05T10:00:00.000Z'
    }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  const workItems = await repository.listOpenWorkItems(7, 20);

  assert.equal(workItems.length, 1);
  assert.equal(workItems[0].opportunityId, 30);
  assert.equal(workItems[0].title, 'Approve opportunity initiation');
  assert.equal(workItems[0].kpiCode, 'approve_on_time');
  assert.equal(workItems[0].plannedStartAt, '2026-06-05T10:00:00.000Z');
  assert.equal(workItems[0].dueAt, '2026-06-06T10:00:00.000Z');
  assert.equal(workItems[0].estimatedHours, 12.5);
  assert.equal(workItems[0].workloadLevel, 'high');
  assert.equal(workItems[0].estimateUrl, '/workbench/work-items/91/estimate');
  assert.equal(workItems[0].actionUrl, '/opportunities/30');
  assert.match(queryTarget.queries[0].sql, /FROM work_items item/);
  assert.match(queryTarget.queries[0].sql, /item\.assignee_user_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /item\.status IN \('pending', 'in_progress', 'waiting', 'review_pending'\)/);
  assert.match(queryTarget.queries[0].sql, /item\.due_at ASC NULLS LAST/);
  assert.deepEqual(queryTarget.queries[0].params, [7, 20]);
});

test('workbench repository loads and updates a work item estimate with actor audit identity', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      id: '91',
      opportunity_id: '30',
      opportunity_no: 'OPP-001',
      opportunity_title: 'Factory upgrade',
      customer_name: 'Acme Co',
      assignee_user_id: '7',
      source_type: 'workflow_todo',
      source_key: 'prepare_technical_solution',
      role_context: 'technical',
      title: 'Prepare technical solution',
      description: '',
      planned_start_at: '2026-06-05T10:00:00.000Z',
      due_at: '2026-06-06T10:00:00.000Z',
      estimated_hours: null,
      workload_level: null,
      kpi_code: 'submit_technical_solution',
      kpi_target: '',
      status: 'pending',
      actual_started_at: null,
      actual_completed_at: null,
      created_at: '2026-06-05T10:00:00.000Z',
      updated_at: '2026-06-05T10:00:00.000Z'
    }
  ], [{ id: '91' }]]);
  const repository = createWorkbenchRepository(queryTarget);

  const workItem = await repository.findWorkItemById(91);
  const updated = await repository.updateWorkItemEstimation(91, {
    estimatedHours: 6.5,
    workloadLevel: 'medium',
    actorUserId: 7
  });

  assert.equal(workItem.assigneeUserId, 7);
  assert.equal(workItem.estimatedHours, null);
  assert.equal(updated, true);
  assert.match(queryTarget.queries[0].sql, /WHERE item\.id = \$1/);
  assert.match(queryTarget.queries[1].sql, /estimated_hours = \$2/);
  assert.match(queryTarget.queries[1].sql, /workload_level = \$3/);
  assert.match(queryTarget.queries[1].sql, /updated_by_user_id = \$4/);
  assert.match(queryTarget.queries[1].sql, /status IN \('pending', 'in_progress', 'waiting', 'review_pending'\)/);
  assert.deepEqual(queryTarget.queries[1].params, [91, 6.5, 'medium', 7]);
});

test('workbench repository returns null for a missing work item', async () => {
  const queryTarget = createFakeQueryTarget([[]]);
  const repository = createWorkbenchRepository(queryTarget);

  assert.equal(await repository.findWorkItemById(999), null);
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
      sourceType: 'workflow_opportunity',
      sourceKey: 'submit_opportunity_initiation',
      roleContext: 'sales',
      plannedStartAt: '2026-06-05T10:00:00.000Z',
      dueAt: null,
      estimatedHours: null,
      workloadLevel: null,
      kpiCode: 'submit_opportunity_initiation',
      kpiTarget: '',
      createdAt: '2026-06-05T10:00:00.000Z',
      actionUrl: '/opportunities/30'
    },
    {
      id: 'opportunity-initiation-31',
      opportunityId: 31,
      opportunityNo: '800004',
      opportunityTitle: 'Line expansion',
      customerName: 'Beta Ltd',
      title: 'Revise and resubmit opportunity',
      status: 'pending',
      sourceType: 'workflow_opportunity',
      sourceKey: 'revise_opportunity_initiation',
      roleContext: 'sales',
      plannedStartAt: '2026-06-05T09:00:00.000Z',
      dueAt: null,
      estimatedHours: null,
      workloadLevel: null,
      kpiCode: 'resubmit_opportunity_initiation',
      kpiTarget: '',
      createdAt: '2026-06-05T09:00:00.000Z',
      actionUrl: '/opportunities/31'
    }
  ]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunities o/);
  assert.match(queryTarget.queries[0].sql, /o\.salesperson_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.status IN \(\$2, \$3\)/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY o\.updated_at DESC, o\.id DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [7, STATUSES.DRAFT, STATUSES.INITIATION_REJECTED, 5]);
});

test('workbench repository exposes Project Execution confirmation only to the configured authorized user', async () => {
  const queryTarget = createFakeQueryTarget([[
    {
      opportunity_id: '30',
      opportunity_no: '800003',
      opportunity_title: 'Factory upgrade',
      customer_name: 'Acme Co',
      archived_at: '2026-09-14T08:00:00.000Z',
      updated_at: '2026-09-14T08:00:00.000Z',
      role_code: 'sales_manager'
    }
  ]]);
  const repository = createWorkbenchRepository(queryTarget);

  const items = await repository.listProjectExecutionConfirmationItems(7, 8);

  assert.equal(items.length, 1);
  assert.equal(items[0].sourceType, 'project_execution_confirmation');
  assert.equal(items[0].actionUrl, '/opportunities/30/project-execution/confirm');
  assert.equal(items[0].kpiCode, 'confirm_project_execution_creation');
  assert.match(queryTarget.queries[0].sql, /aps\.setting_key = 'project_execution_creation'/);
  assert.match(queryTarget.queries[0].sql, /configured\.user_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /pe\.id IS NULL/);
  assert.deepEqual(queryTarget.queries[0].params, [7, STATUSES.CONTRACT_ARCHIVED, 8]);
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
