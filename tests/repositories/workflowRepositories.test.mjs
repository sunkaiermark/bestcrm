import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityRepository } from '../../src/repositories/opportunityRepository.mjs';
import { createTodoRepository } from '../../src/repositories/todoRepository.mjs';
import { createWorkflowEventRepository } from '../../src/repositories/workflowEventRepository.mjs';
import { ACTIONS } from '../../src/domain/workflow.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

test('opportunity repository maps rows and updates workflow fields', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '10',
    opportunity_no: 'OPP-10',
    title: 'Test opportunity',
    customer_id: '20',
    primary_contact_id: '30',
    requirement: 'Need solution',
    estimated_amount: '1000.50',
    project_type: 'integration',
    delivery_cycle: '30 days',
    expected_bid_date: '2026-06-30',
    status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    salesperson_id: '1',
    sales_manager_id: '2',
    quotation_engineer_id: '3',
    technical_manager_id: null,
    commercial_manager_id: null,
    final_deal_amount: null,
    lost_reason: null,
    won_description: null,
    archived_at: null
  }]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunity = await repository.findById(10);
  assert.equal(opportunity.id, 10);
  assert.equal(opportunity.opportunityNo, 'OPP-10');
  assert.equal(opportunity.quotationEngineerId, 3);

  await repository.updateWorkflowState(10, {
    status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    quotationEngineerId: 3
  });

  const updateQuery = queryTarget.queries[1];
  assert.match(updateQuery.sql, /UPDATE opportunities/);
  assert.match(updateQuery.sql, /quotation_engineer_id = \$2/);
  assert.match(updateQuery.sql, /updated_at = now\(\)/);
  assert.deepEqual(updateQuery.params, [STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, 3, 10]);
});

test('workflow event repository inserts timeline events', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '77' }]);
  const repository = createWorkflowEventRepository(queryTarget);

  const event = await repository.create({
    opportunityId: 10,
    eventType: ACTIONS.APPROVE_INITIATION,
    fromStatus: STATUSES.INITIATION_PENDING,
    toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    actorUserId: 2,
    targetUserId: 3,
    comment: 'approved'
  });

  assert.equal(event.id, 77);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO workflow_events/);
  assert.deepEqual(queryTarget.queries[0].params, [
    10,
    ACTIONS.APPROVE_INITIATION,
    STATUSES.INITIATION_PENDING,
    STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    2,
    3,
    'approved'
  ]);
});

test('todo repository creates and closes pending todos', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '88' }]);
  const repository = createTodoRepository(queryTarget);

  const todo = await repository.create({
    opportunityId: 10,
    assigneeUserId: 3,
    title: 'Prepare technical solution'
  });
  assert.equal(todo.id, 88);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO todos/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 3, 'Prepare technical solution']);

  await repository.closePendingForOpportunity(10, 'withdrawn');
  assert.match(queryTarget.queries[1].sql, /UPDATE todos/);
  assert.match(queryTarget.queries[1].sql, /status = \$2/);
  assert.match(queryTarget.queries[1].sql, /completed_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[1].params, [10, 'withdrawn']);
});
