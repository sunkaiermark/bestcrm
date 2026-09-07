import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectCoreRecordForeignKeys,
  REQUIRED_CORE_RECORD_FOREIGN_KEYS
} from '../../src/domain/opportunityRecordGuardrails.mjs';

test('core-record guardrail audit accepts additive RESTRICT foreign keys from later phases', () => {
  const foreignKeys = REQUIRED_CORE_RECORD_FOREIGN_KEYS.map((conname) => ({ conname, confdeltype: 'r' }));
  foreignKeys.push(
    { conname: 'opportunity_activities_opportunity_id_fkey', confdeltype: 'r' },
    { conname: 'opportunity_activity_participants_contact_id_fkey', confdeltype: 'r' }
  );

  assert.deepEqual(inspectCoreRecordForeignKeys(foreignKeys), {
    total: REQUIRED_CORE_RECORD_FOREIGN_KEYS.length + 2,
    missingRequired: [],
    unsafeDeleteActions: []
  });
});

test('core-record guardrail audit reports missing and unsafe foreign keys', () => {
  const foreignKeys = REQUIRED_CORE_RECORD_FOREIGN_KEYS.slice(1).map((conname) => ({ conname, confdeltype: 'r' }));
  foreignKeys[0] = { ...foreignKeys[0], confdeltype: 'c' };

  const result = inspectCoreRecordForeignKeys(foreignKeys);
  assert.deepEqual(result.missingRequired, [REQUIRED_CORE_RECORD_FOREIGN_KEYS[0]]);
  assert.deepEqual(result.unsafeDeleteActions, [{ name: foreignKeys[0].conname, deleteAction: 'c' }]);
});
