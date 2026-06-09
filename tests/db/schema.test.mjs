import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../../src/db/migrations/001_initial_schema.sql', import.meta.url);
const opportunityNumberMigrationPath = new URL('../../src/db/migrations/003_opportunity_number_sequence.sql', import.meta.url);
const opportunityNumberMaxMigrationPath = new URL('../../src/db/migrations/004_opportunity_number_maxvalue.sql', import.meta.url);
const rolesMetadataMigrationPath = new URL('../../src/db/migrations/005_roles_metadata.sql', import.meta.url);
const requirementUpdatesMigrationPath = new URL('../../src/db/migrations/006_requirement_updates.sql', import.meta.url);
const technicalSolutionVersionsMigrationPath = new URL('../../src/db/migrations/007_technical_solution_versions.sql', import.meta.url);
const commercialQuoteVersionsMigrationPath = new URL('../../src/db/migrations/008_commercial_quote_versions.sql', import.meta.url);
const contractVersionsMigrationPath = new URL('../../src/db/migrations/009_contract_versions.sql', import.meta.url);
const opportunityResponsibilityMigrationPath = new URL('../../src/db/migrations/010_opportunity_responsibility.sql', import.meta.url);
const customerCountryMigrationPath = new URL('../../src/db/migrations/011_customer_country.sql', import.meta.url);
const contactProfileMigrationPath = new URL('../../src/db/migrations/012_contact_profile_fields.sql', import.meta.url);
const customerProfileMigrationPath = new URL('../../src/db/migrations/013_customer_profile_fields.sql', import.meta.url);
const opportunityMaterialVersionsMigrationPath = new URL('../../src/db/migrations/014_opportunity_material_versions.sql', import.meta.url);
const attachmentMaterialVersionMigrationPath = new URL('../../src/db/migrations/015_attachment_material_version.sql', import.meta.url);

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

test('technical solution versions migration adds version and review fields', async () => {
  const sql = await readFile(technicalSolutionVersionsMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE technical_solutions/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS version_no integer/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reviewed_by bigint REFERENCES users\(id\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reviewed_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS review_comment text/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS technical_solutions_opportunity_version_idx/);
});

test('commercial quote versions migration adds version and review fields', async () => {
  const sql = await readFile(commercialQuoteVersionsMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE commercial_quotes/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS version_no integer/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reviewed_by bigint REFERENCES users\(id\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reviewed_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS review_comment text/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS commercial_quotes_opportunity_version_idx/);
});

test('contract versions migration adds version number fields', async () => {
  const sql = await readFile(contractVersionsMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE contract_approvals/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS version_no integer/);
  assert.match(sql, /ROW_NUMBER\(\) OVER/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS contract_approvals_opportunity_version_idx/);
});

test('opportunity responsibility migration adds team members and owner transfer history', async () => {
  const sql = await readFile(opportunityResponsibilityMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_members/);
  assert.match(sql, /opportunity_id bigint NOT NULL REFERENCES opportunities\(id\) ON DELETE CASCADE/);
  assert.match(sql, /user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /role_code text NOT NULL/);
  assert.match(sql, /permission_level text NOT NULL DEFAULT 'view'/);
  assert.match(sql, /added_by bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /removed_by bigint REFERENCES users\(id\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS opportunity_members_active_unique_idx/);
  assert.match(sql, /WHERE is_active = true/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_owner_transfers/);
  assert.match(sql, /from_owner_user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /to_owner_user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /changed_by bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /reason text NOT NULL/);
  assert.match(sql, /keep_previous_owner_as_member boolean NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS opportunity_owner_transfers_opportunity_idx/);
});

test('customer country migration adds country to customer records', async () => {
  const sql = await readFile(customerCountryMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE customers/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS country text/);
});

test('contact profile migration adds education work experience and achievement fields', async () => {
  const sql = await readFile(contactProfileMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE contacts/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS education_background text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS work_experience text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS key_achievements text/);
});

test('customer profile migration adds parent company enterprise nature and highlights fields', async () => {
  const sql = await readFile(customerProfileMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE customers/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS parent_company text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS enterprise_nature text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS company_highlights text/);
});

test('opportunity material versions migration creates unified approval version records', async () => {
  const sql = await readFile(opportunityMaterialVersionsMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_material_versions/);
  assert.match(sql, /opportunity_id bigint NOT NULL REFERENCES opportunities\(id\) ON DELETE CASCADE/);
  assert.match(sql, /material_type text NOT NULL/);
  assert.match(sql, /material_type IN \('technical_solution', 'commercial_quote', 'contract'\)/);
  assert.match(sql, /version_no integer NOT NULL/);
  assert.match(sql, /status text NOT NULL DEFAULT 'draft'/);
  assert.match(sql, /status IN \('draft', 'pending', 'approved', 'rejected', 'withdrawn'\)/);
  assert.match(sql, /submitted_by bigint REFERENCES users\(id\)/);
  assert.match(sql, /reviewed_by bigint REFERENCES users\(id\)/);
  assert.match(sql, /UNIQUE \(opportunity_id, material_type, version_no\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS opportunity_material_versions_opportunity_type_idx/);
});

test('attachment material version migration links attachments to unified material versions', async () => {
  const sql = await readFile(attachmentMaterialVersionMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE attachments/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS opportunity_material_version_id bigint/);
  assert.match(sql, /REFERENCES opportunity_material_versions\(id\) ON DELETE SET NULL/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS attachments_material_version_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS attachments_unbound_material_idx/);
  assert.match(sql, /WHERE opportunity_material_version_id IS NULL/);
});
