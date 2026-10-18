import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../src/db/migrations/119_opportunity_collaboration_work_packages.sql', import.meta.url);

test('opportunity collaboration work packages retain plan separation version history and files', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_packages/);
  assert.match(sql, /plan_kind text NOT NULL CHECK \(plan_kind IN \('technical_solution', 'internal_quote'\)\)/);
  assert.match(sql, /assignee_user_id bigint NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_package_versions/);
  assert.match(sql, /UNIQUE \(work_package_id, version_no\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_package_files/);
  assert.match(sql, /attachment_id bigint NOT NULL REFERENCES attachments\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_package_events/);
  assert.match(sql, /event_type IN \('created', 'submitted', 'returned', 'accepted'\)/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});
