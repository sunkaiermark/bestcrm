import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpportunityActivityBackfillBatch } from '../../src/services/opportunityActivityBackfill.mjs';

test('activity backfill processes one bounded source batch and persists its cursor', async () => {
  const responses = [
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: 0 },
    { rows: [{ high_water_id: '9' }], rowCount: 1 },
    { rows: [{ source_code: 'workflow_events', high_water_id: '9', last_source_id: '0', scanned_count: '0', indexed_count: '0', skipped_count: '0', completed_at: null }], rowCount: 1 },
    { rows: [{ id: '2' }, { id: '7' }], rowCount: 2 },
    { rows: [{ activity_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }], rowCount: 1 },
    { rows: [{ activity_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }], rowCount: 1 },
    { rows: [{ source_code: 'workflow_events', high_water_id: '9', last_source_id: '7', scanned_count: '2', indexed_count: '2', skipped_count: '0', completed_at: null }], rowCount: 1 },
    { rows: [{ remaining_count: 1 }], rowCount: 1 },
    { rows: [], rowCount: 0 }
  ];
  const queryTarget = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return responses.shift();
    }
  };

  const result = await runOpportunityActivityBackfillBatch(queryTarget, {
    sourceCode: 'workflow_events', batchSize: 2
  });

  assert.deepEqual(result, {
    sourceCode: 'workflow_events', scanned: 2, indexed: 2, skipped: 0,
    highWaterId: 9, lastSourceId: 7, remaining: 1, complete: false,
    totals: { scanned: 2, indexed: 2, skipped: 0 }
  });
  assert.equal(queryTarget.calls[0].sql, 'BEGIN');
  assert.match(queryTarget.calls[4].sql, /LIMIT \$3/);
  assert.deepEqual(queryTarget.calls[4].params, ['0', '9', 2]);
  assert.deepEqual(queryTarget.calls.at(-1), { sql: 'COMMIT', params: undefined });
});

test('activity backfill rejects unknown sources before opening a transaction', async () => {
  await assert.rejects(
    () => runOpportunityActivityBackfillBatch({ query: async () => assert.fail('must not query') }, { sourceCode: 'users' }),
    /Unsupported opportunity activity source/
  );
});
