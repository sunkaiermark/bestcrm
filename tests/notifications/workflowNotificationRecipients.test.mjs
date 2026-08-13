import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const primaryMigrationPath = new URL('../../src/db/migrations/020_notification_center.sql', import.meta.url);
const secondaryMigrationPath = new URL('../../src/db/migrations/021_notification_workflow_recipients.sql', import.meta.url);

test('the required opportunity approval chain has the intended primary and secondary recipients', async () => {
  const primarySql = await readFile(primaryMigrationPath, 'utf8');
  const secondarySql = await readFile(secondaryMigrationPath, 'utf8');

  for (const eventType of [
    'submit_initiation',
    'approve_initiation',
    'submit_technical_solution',
    'approve_technical_solution',
    'submit_commercial_quote',
    'approve_commercial_quote'
  ]) {
    assert.match(primarySql, new RegExp(`WHEN '${eventType}'`));
  }

  assert.match(secondarySql, /approve_initiation/);
  assert.match(secondarySql, /approve_technical_solution/);
  assert.match(secondarySql, /salesperson_id/);
});
