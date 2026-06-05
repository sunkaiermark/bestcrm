import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../../src/db/migrations/001_initial_schema.sql', import.meta.url);
const opportunityNumberMigrationPath = new URL('../../src/db/migrations/003_opportunity_number_sequence.sql', import.meta.url);
const opportunityNumberMaxMigrationPath = new URL('../../src/db/migrations/004_opportunity_number_maxvalue.sql', import.meta.url);
const rolesMetadataMigrationPath = new URL('../../src/db/migrations/005_roles_metadata.sql', import.meta.url);
const requirementUpdatesMigrationPath = new URL('../../src/db/migrations/006_requirement_updates.sql', import.meta.url);

test('initial schema declares first-version tables', async () => {
  const sql = await readFile(schemaPath, 'utf8');
  for (const table of [
    'users',
    'roles',
    'user_roles',
    'customers',
    'contacts',
    'opportunities',
    'technical_solutions',
    'commercial_quotes',
    'quote_items',
    'contract_approvals',
    'contract_approval_steps',
    'attachments',
    'workflow_events',
    'todos',
    'approval_settings'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /sales_manager_id/);
  assert.doesNotMatch(sql, /department_manager_id/);
});

test('opportunity number migration creates six digit sequence starting at 800000', async () => {
  const sql = await readFile(opportunityNumberMigrationPath, 'utf8');

  assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS opportunity_no_seq/);
  assert.match(sql, /START WITH 800000/);
  assert.match(sql, /opportunity_no ~ '\^\[0-9\]\{6\}\$'/);
  assert.match(sql, /setval\(\s*'opportunity_no_seq'/);
});

test('opportunity number sequence is capped at six digits', async () => {
  const sql = await readFile(opportunityNumberMaxMigrationPath, 'utf8');

  assert.match(sql, /ALTER SEQUENCE opportunity_no_seq/);
  assert.match(sql, /MAXVALUE 999999/);
});

test('roles metadata migration adds role descriptions and active flag', async () => {
  const sql = await readFile(rolesMetadataMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE roles/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS description text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true/);
});

test('requirement updates migration creates supplemental requirement records', async () => {
  const sql = await readFile(requirementUpdatesMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS requirement_updates/);
  assert.match(sql, /opportunity_id bigint NOT NULL REFERENCES opportunities\(id\) ON DELETE CASCADE/);
  assert.match(sql, /requirement_text text NOT NULL/);
  assert.match(sql, /reason text NOT NULL/);
  assert.match(sql, /created_by bigint NOT NULL REFERENCES users\(id\)/);
});
