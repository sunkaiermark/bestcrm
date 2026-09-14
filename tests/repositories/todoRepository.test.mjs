import test from 'node:test';
import assert from 'node:assert/strict';
import { createTodoRepository } from '../../src/repositories/todoRepository.mjs';

function queryTargetWithRows(rowsByCall) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      const rows = rowsByCall[this.calls.length - 1] || [];
      return { rows, rowCount: rows.length };
    }
  };
}

test('todo creation also creates one unified workflow work item with a measurable KPI', async () => {
  const target = queryTargetWithRows([[{ id: '55' }], [], []]);
  const repository = createTodoRepository(target);

  const todo = await repository.create({
    opportunityId: 30,
    assigneeUserId: 7,
    title: 'Prepare technical solution',
    dueAt: '2026-09-16T23:59:59+08:00',
    estimatedHours: 12.5,
    workloadLevel: 'high'
  }, 3);

  assert.equal(todo.id, 55);
  assert.match(target.calls[0].sql, /INSERT INTO todos/);
  assert.match(target.calls[1].sql, /UPDATE work_items/);
  assert.match(target.calls[1].sql, /status = 'cancelled'/);
  assert.match(target.calls[2].sql, /INSERT INTO work_items/);
  assert.deepEqual(target.calls[1].params, [30, 7, 'prepare_technical_solution', 3]);
  assert.deepEqual(target.calls[2].params.slice(0, 7), [
    30,
    7,
    3,
    55,
    'prepare_technical_solution',
    'technical',
    'Prepare technical solution'
  ]);
  assert.equal(target.calls[2].params[10], 12.5);
  assert.equal(target.calls[2].params[11], 'high');
  assert.equal(target.calls[2].params[12], 'submit_technical_solution');
});

test('closing workflow todos closes their unified work items without deleting history', async () => {
  const target = queryTargetWithRows([[{ id: '55' }, { id: '56' }], []]);
  const repository = createTodoRepository(target);

  await repository.closePendingForOpportunity(30, 'completed', 9);

  assert.match(target.calls[0].sql, /UPDATE todos/);
  assert.match(target.calls[0].sql, /RETURNING id/);
  assert.match(target.calls[1].sql, /UPDATE work_items/);
  assert.match(target.calls[1].sql, /source_record_id = ANY/);
  assert.deepEqual(target.calls[1].params, [[55, 56], 'completed', 'completed', 9]);
  assert.match(target.calls[1].sql, /updated_by_user_id = \$4/);
  assert.doesNotMatch(target.calls[1].sql, /DELETE FROM/);
});
