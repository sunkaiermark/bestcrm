import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkItemDueAt } from '../../src/domain/workItemSla.mjs';

test('work-item SLA uses the configured Shanghai business-day deadline for each task type', () => {
  const fridayMorningUtc = '2026-10-16T02:00:00.000Z';

  assert.equal(defaultWorkItemDueAt('Approve technical solution', fridayMorningUtc),
    '2026-10-19T23:59:59+08:00');
  assert.equal(defaultWorkItemDueAt('Prepare technical solution', fridayMorningUtc),
    '2026-10-21T23:59:59+08:00');
  assert.equal(defaultWorkItemDueAt('Prepare commercial quote', fridayMorningUtc),
    '2026-10-20T23:59:59+08:00');
  assert.equal(defaultWorkItemDueAt('Unknown task', fridayMorningUtc), null);
});
