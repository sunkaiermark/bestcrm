import assert from 'node:assert/strict';
import test from 'node:test';
import { runEmailBackfillLoop } from '../../src/jobs/emailBackfillLoop.mjs';

test('historical email backfill aggregates bounded batches and exits when complete', async () => {
  const batches = [
    { scanned: 50, imported: Array(45), skipped: Array(5), backfillComplete: false },
    { scanned: 50, imported: Array(48), skipped: Array(2), backfillComplete: false },
    { scanned: 12, imported: Array(10), skipped: Array(2), backfillComplete: true }
  ];
  const waits = [];

  const summary = await runEmailBackfillLoop({
    runBatch: async () => batches.shift(),
    wait: async (milliseconds) => waits.push(milliseconds),
    intervalMs: 300000
  });

  assert.deepEqual(summary, {
    batches: 3,
    scanned: 112,
    imported: 103,
    skipped: 9,
    backfillComplete: true,
    stopped: false
  });
  assert.deepEqual(waits, [300000, 300000]);
});

test('historical email backfill stops cleanly without another wait after a signal', async () => {
  let stopping = false;
  let waits = 0;

  const summary = await runEmailBackfillLoop({
    runBatch: async () => {
      stopping = true;
      return { scanned: 50, imported: Array(50), skipped: [], backfillComplete: false };
    },
    wait: async () => {
      waits += 1;
    },
    intervalMs: 300000,
    isStopping: () => stopping
  });

  assert.equal(summary.batches, 1);
  assert.equal(summary.stopped, true);
  assert.equal(summary.backfillComplete, false);
  assert.equal(waits, 0);
});
