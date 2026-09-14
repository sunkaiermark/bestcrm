import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectExecutionRepository } from '../../src/repositories/projectExecutionRepository.mjs';

function fakeQueryTarget(rowsByCall) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      const rows = rowsByCall[this.calls.length - 1] || [];
      return { rows, rowCount: rows.length };
    }
  };
}

const detailRow = {
  id: '5',
  opportunity_id: '30',
  opportunity_no: '800030',
  opportunity_title: 'Factory upgrade',
  customer_name: 'Acme Co',
  contract_signed_on: '2026-09-14',
  status: 'planning',
  confirmed_by_user_id: '7',
  confirmed_by_display_name: 'Manager One',
  salesperson_id: '2',
  sales_manager_id: '7',
  quotation_engineer_id: '3',
  technical_manager_id: '4',
  commercial_manager_id: '5',
  created_at: '2026-09-14T08:00:00.000Z',
  updated_at: '2026-09-14T08:00:00.000Z'
};

test('project execution repository creates once and returns the joined record', async () => {
  const target = fakeQueryTarget([[{ id: '5' }], [detailRow]]);
  const repository = createProjectExecutionRepository(target);

  const result = await repository.createForOpportunity({
    opportunityId: 30,
    contractSignedOn: '2026-09-14',
    confirmedByUserId: 7
  });

  assert.equal(result.created, true);
  assert.equal(result.projectExecution.id, 5);
  assert.equal(result.projectExecution.opportunityId, 30);
  assert.equal(result.projectExecution.confirmedByDisplayName, 'Manager One');
  assert.match(target.calls[0].sql, /ON CONFLICT \(opportunity_id\) DO NOTHING/);
  assert.deepEqual(target.calls[0].params, [30, '2026-09-14', 7]);
  assert.match(target.calls[1].sql, /WHERE pe\.opportunity_id = \$1/);
});

test('project execution repository reports an existing one-to-one record without duplication', async () => {
  const target = fakeQueryTarget([[], [detailRow]]);
  const repository = createProjectExecutionRepository(target);

  const result = await repository.createForOpportunity({
    opportunityId: 30,
    contractSignedOn: '2026-09-14',
    confirmedByUserId: 7
  });

  assert.equal(result.created, false);
  assert.equal(result.projectExecution.id, 5);
});
