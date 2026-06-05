import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequirementUpdateRepository } from '../../src/repositories/requirementUpdateRepository.mjs';

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

test('requirement update repository creates supplemental requirement records', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '41', created_at: '2026-06-06T08:00:00.000Z' }]);
  const repository = createRequirementUpdateRepository(queryTarget);

  const update = await repository.create({
    opportunityId: 30,
    requirementText: 'Customer added corrosion proof cabinet requirement',
    reason: 'Customer site has salt fog environment',
    createdBy: 7
  });

  assert.equal(update.id, 41);
  assert.equal(update.opportunityId, 30);
  assert.equal(update.requirementText, 'Customer added corrosion proof cabinet requirement');
  assert.equal(update.reason, 'Customer site has salt fog environment');
  assert.equal(update.createdBy, 7);
  assert.equal(update.createdAt, '2026-06-06T08:00:00.000Z');
  assert.match(queryTarget.queries[0].sql, /INSERT INTO requirement_updates/);
  assert.deepEqual(queryTarget.queries[0].params, [
    30,
    'Customer added corrosion proof cabinet requirement',
    'Customer site has salt fog environment',
    7
  ]);
});

test('requirement update repository lists supplemental requirements by opportunity in time order', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '41',
    opportunity_id: '30',
    requirement_text: 'Customer added corrosion proof cabinet requirement',
    reason: 'Customer site has salt fog environment',
    created_by: '7',
    creator_display_name: 'Sales One',
    created_at: '2026-06-06T08:00:00.000Z'
  }]);
  const repository = createRequirementUpdateRepository(queryTarget);

  const updates = await repository.listByOpportunity(30);

  assert.deepEqual(updates, [{
    id: 41,
    opportunityId: 30,
    requirementText: 'Customer added corrosion proof cabinet requirement',
    reason: 'Customer site has salt fog environment',
    createdBy: 7,
    creatorDisplayName: 'Sales One',
    createdAt: '2026-06-06T08:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM requirement_updates ru/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users creator/);
  assert.match(queryTarget.queries[0].sql, /WHERE ru\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY ru\.created_at ASC/);
  assert.deepEqual(queryTarget.queries[0].params, [30]);
});
