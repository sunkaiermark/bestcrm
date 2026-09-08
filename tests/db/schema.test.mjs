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
const loginSecurityMigrationPath = new URL('../../src/db/migrations/016_login_security.sql', import.meta.url);
const salesWorkMigrationPath = new URL('../../src/db/migrations/017_sales_work.sql', import.meta.url);
const inquiryInboxMigrationPath = new URL('../../src/db/migrations/018_inquiry_inbox.sql', import.meta.url);
const inquirySourceReferenceUniqueMigrationPath = new URL('../../src/db/migrations/019_inquiry_source_reference_unique.sql', import.meta.url);
const notificationCenterMigrationPath = new URL('../../src/db/migrations/020_notification_center.sql', import.meta.url);
const notificationWorkflowRecipientsMigrationPath = new URL('../../src/db/migrations/021_notification_workflow_recipients.sql', import.meta.url);
const customerWebsiteMigrationPath = new URL('../../src/db/migrations/022_customer_website.sql', import.meta.url);
const inquiryDispositionMigrationPath = new URL('../../src/db/migrations/023_inquiry_disposition_workflow.sql', import.meta.url);
const inquiryCustomerCollaborationMigrationPath = new URL('../../src/db/migrations/024_inquiry_customer_collaboration.sql', import.meta.url);
const salesLeadSubmissionsMigrationPath = new URL('../../src/db/migrations/025_sales_lead_submissions.sql', import.meta.url);
const opportunityEngineeringCollaborationMigrationPath = new URL('../../src/db/migrations/026_opportunity_engineering_collaboration.sql', import.meta.url);
const productTechnicalTemplatesMigrationPath = new URL('../../src/db/migrations/029_product_technical_templates.sql', import.meta.url);
const opportunityTechnicalDraftsMigrationPath = new URL('../../src/db/migrations/030_opportunity_technical_drafts.sql', import.meta.url);
const technicalSolutionDocumentsMigrationPath = new URL('../../src/db/migrations/031_technical_solution_versions_and_documents.sql', import.meta.url);
const quotationPackageVersionsMigrationPath = new URL('../../src/db/migrations/032_quotation_package_versions.sql', import.meta.url);
const emailCenterArchiveMigrationPath = new URL('../../src/db/migrations/033_email_center_archive.sql', import.meta.url);
const customerEmailSendingMigrationPath = new URL('../../src/db/migrations/034_customer_email_sending.sql', import.meta.url);
const bidCenterFoundationMigrationPath = new URL('../../src/db/migrations/035_bid_center_foundation.sql', import.meta.url);
const opportunityBidWorkspacesMigrationPath = new URL('../../src/db/migrations/036_opportunity_bid_workspaces.sql', import.meta.url);
const quotationPackageDocumentsMigrationPath = new URL('../../src/db/migrations/037_quotation_package_documents.sql', import.meta.url);
const bidPackageEditorsMigrationPath = new URL('../../src/db/migrations/038_bid_package_editors.sql', import.meta.url);
const bidPackageApprovalsMigrationPath = new URL('../../src/db/migrations/039_bid_package_approvals.sql', import.meta.url);
const bidPackageOutputIdentityMigrationPath = new URL('../../src/db/migrations/040_bid_package_output_identity.sql', import.meta.url);
const authenticatorMfaMigrationPath = new URL('../../src/db/migrations/041_authenticator_mfa.sql', import.meta.url);
const googleWorkspaceCustomerCenterMigrationPath = new URL('../../src/db/migrations/042_google_workspace_customer_center.sql', import.meta.url);
const customerCodeMigrationPath = new URL('../../src/db/migrations/043_customer_code.sql', import.meta.url);
const contactCodeMigrationPath = new URL('../../src/db/migrations/044_contact_code.sql', import.meta.url);
const contactCodeLPrefixMigrationPath = new URL('../../src/db/migrations/052_contact_code_l_prefix.sql', import.meta.url);
const imapSyncAndEmailTriageMigrationPath = new URL('../../src/db/migrations/045_imap_sync_and_email_triage.sql', import.meta.url);
const customerContactUniquenessMigrationPath = new URL('../../src/db/migrations/046_customer_contact_uniqueness.sql', import.meta.url);
const opportunityRecordGuardrailsMigrationPath = new URL('../../src/db/migrations/047_opportunity_record_guardrails.sql', import.meta.url);
const opportunityActivitySpineMigrationPath = new URL('../../src/db/migrations/048_opportunity_activity_spine.sql', import.meta.url);
const emailRawArchiveFoundationMigrationPath = new URL('../../src/db/migrations/049_email_raw_archive_foundation.sql', import.meta.url);
const emailRawBackfillCheckpointMigrationPath = new URL('../../src/db/migrations/050_email_raw_backfill_checkpoint.sql', import.meta.url);
const emailRawMalwareEventsMigrationPath = new URL('../../src/db/migrations/051_email_raw_malware_events.sql', import.meta.url);

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

test('Authenticator MFA migration creates the three frozen secret-safe tables', async () => {
  const sql = await readFile(authenticatorMfaMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_mfa_settings/);
  assert.match(sql, /user_id bigint NOT NULL UNIQUE REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /status text NOT NULL DEFAULT 'disabled'/);
  assert.match(sql, /CHECK \(status IN \('pending', 'active', 'disabled'\)\)/);
  assert.match(sql, /secret_ciphertext text/);
  assert.match(sql, /secret_nonce text/);
  assert.match(sql, /secret_auth_tag text/);
  assert.match(sql, /secret_key_version integer/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes/);
  assert.match(sql, /code_hash char\(64\) NOT NULL/);
  assert.match(sql, /generation integer NOT NULL/);
  assert.match(sql, /used_at timestamptz/);
  assert.match(sql, /invalidated_at timestamptz/);
  assert.match(sql, /FOREIGN KEY \(mfa_setting_id, user_id\)/);
  assert.match(sql, /REFERENCES user_mfa_settings\(id, user_id\) ON DELETE CASCADE/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_trusted_devices/);
  assert.match(sql, /token_hash char\(64\) NOT NULL UNIQUE/);
  assert.match(sql, /expires_at timestamptz NOT NULL/);
  assert.match(sql, /revoked_at timestamptz/);
  assert.match(sql, /user_mfa_settings_active_lookup_idx/);
  assert.match(sql, /user_mfa_recovery_codes_available_idx/);
  assert.match(sql, /user_trusted_devices_expiry_cleanup_idx/);
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

test('opportunity engineering collaboration migration adds tasks audit and contributions', async () => {
  const sql = await readFile(opportunityEngineeringCollaborationMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE opportunity_members/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS assignment_scope text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS task_description text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS due_date date/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS can_send_external_email boolean NOT NULL DEFAULT false/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_member_events/);
  assert.match(sql, /event_type text NOT NULL CHECK \(event_type IN \('assigned', 'updated', 'removed'\)\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_engineering_contributions/);
  assert.match(sql, /contributor_user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /contribution_summary text NOT NULL/);
});

test('product technical template migration creates controlled immutable revision tables', async () => {
  const sql = await readFile(productTechnicalTemplatesMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_agreement_templates/);
  assert.match(sql, /language text NOT NULL CHECK \(language IN \('en', 'zh', 'bilingual'\)\)/);
  assert.match(sql, /current_published_revision_id bigint/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_agreement_template_revisions/);
  assert.match(sql, /status text NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'review_pending', 'published', 'retired'\)\)/);
  assert.match(sql, /UNIQUE \(template_id, revision_no\)/);
  assert.match(sql, /technical_agreement_template_open_revision_idx/);
  assert.match(sql, /technical_agreement_template_published_revision_idx/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_agreement_variable_definitions/);
  assert.match(sql, /variable_key text NOT NULL UNIQUE CHECK/);
  assert.match(sql, /source_field text NOT NULL DEFAULT 'manual' CHECK/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_agreement_revision_variables/);
  assert.match(sql, /variable_key text NOT NULL CHECK/);
  assert.match(sql, /validation_rules jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_agreement_clause_blocks/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_template_events/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION protect_technical_template_revision_content/);
  assert.match(sql, /Submitted or published template revision content is immutable/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION require_draft_technical_template_revision/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION protect_technical_clause_content/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('opportunity technical draft migration freezes generated snapshots and attributes section work', async () => {
  const sql = await readFile(opportunityTechnicalDraftsMigrationPath, 'utf8');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS section_key text NOT NULL DEFAULT 'design_parameters'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_technical_drafts/);
  assert.match(sql, /status text NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'ready'\)\)/);
  assert.match(sql, /content_schema_snapshot jsonb NOT NULL/);
  assert.match(sql, /variable_schema_snapshot jsonb NOT NULL/);
  assert.match(sql, /variable_values jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /selected_clauses jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /rendered_content jsonb NOT NULL/);
  assert.match(sql, /UNIQUE \(opportunity_id, draft_revision_no\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_technical_section_assignments/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_technical_draft_events/);
  assert.match(sql, /require_current_published_technical_template_revision/);
  assert.match(sql, /Opportunity technical draft source snapshots are immutable/);
  assert.match(sql, /Opportunity technical draft events are append-only/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('technical solution version migration adds immutable approval versions and checksum-bound files', async () => {
  const sql = await readFile(technicalSolutionDocumentsMigrationPath, 'utf8');

  assert.match(sql, /CHECK \(status IN \('draft', 'ready', 'pending', 'approved', 'rejected'\)\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source_draft_id bigint/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS formal_version_no integer/);
  assert.match(sql, /opportunity_technical_drafts_formal_version_idx/);
  assert.match(sql, /opportunity_technical_drafts_pending_idx/);
  assert.match(sql, /opportunity_technical_drafts_formal_version_check/);
  assert.match(sql, /opportunity_technical_drafts_submission_metadata_check/);
  assert.match(sql, /opportunity_technical_drafts_review_metadata_check/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS opportunity_technical_draft_id bigint/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS technical_solution_documents/);
  assert.match(sql, /sha256 char\(64\) NOT NULL/);
  assert.match(sql, /content bytea NOT NULL/);
  assert.match(sql, /Approved technical solution documents are immutable/);
  assert.match(sql, /Submitted and approved technical solution content is immutable/);
  assert.match(sql, /Revision drafts must preserve the rejected source snapshot/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('quotation package migration creates immutable customer-facing package versions', async () => {
  const sql = await readFile(quotationPackageVersionsMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS quotation_package_versions/);
  assert.match(sql, /draft_revision_no integer NOT NULL CHECK \(draft_revision_no > 0\)/);
  assert.match(sql, /status text NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'pending', 'approved', 'rejected', 'sent', 'superseded', 'accepted'\)\)/);
  assert.match(sql, /technical_solution_version_id bigint NOT NULL REFERENCES opportunity_technical_drafts\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /commercial_quote_id bigint NOT NULL REFERENCES commercial_quotes\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /commercial_line_items jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /quotation_package_versions_formal_version_idx/);
  assert.match(sql, /quotation_package_versions_pending_idx/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS quotation_package_attachments/);
  assert.match(sql, /sha256 char\(64\) NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS quotation_package_events/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS accepted_quotation_package_id bigint/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS quotation_package_version_id bigint/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION validate_quotation_package_components/);
  assert.match(sql, /Quotation packages require approved technical solution and commercial quote versions/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION protect_quotation_package_version/);
  assert.match(sql, /Sent, superseded, and accepted quotation packages are immutable/);
  assert.match(sql, /Quotation package status transition is invalid/);
  assert.match(sql, /Accepted quotation package link cannot be cleared/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION protect_quotation_package_attachment/);
  assert.match(sql, /Quotation package attachments are immutable after submission/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION validate_accepted_quotation_package_link/);
  assert.match(sql, /Contract approval requires an accepted quotation package from the same opportunity/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('bid center foundation migration creates governed commercial templates, content blocks, and output profiles', async () => {
  const sql = await readFile(bidCenterFoundationMigrationPath, 'utf8');

  for (const table of [
    'commercial_package_templates',
    'commercial_package_template_revisions',
    'bid_content_blocks',
    'bid_content_block_revisions',
    'bid_output_profiles'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /commercial_package_templates_current_revision_owner_fk/);
  assert.match(sql, /bid_content_blocks_current_revision_owner_fk/);
  assert.match(sql, /commercial_package_template_open_revision_idx/);
  assert.match(sql, /commercial_package_template_published_revision_idx/);
  assert.match(sql, /bid_content_block_open_revision_idx/);
  assert.match(sql, /bid_content_block_published_revision_idx/);
  assert.match(sql, /bid_output_profile_open_revision_idx/);
  assert.match(sql, /bid_output_profile_published_revision_idx/);
  assert.match(sql, /applicable_sections jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /owner_role_code text NOT NULL REFERENCES roles\(code\) ON DELETE RESTRICT/);
  assert.match(sql, /allowed_variables jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /source_metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /controlled_attachment/);
  assert.match(sql, /attachment_sha256 char\(64\)/);
  assert.match(sql, /Commercial template revisions must be created as drafts/);
  assert.match(sql, /commercial_package_template_revisions_lifecycle_check/);
  assert.match(sql, /bid_content_block_revisions_lifecycle_check/);
  assert.match(sql, /bid_output_profiles_lifecycle_check/);
  assert.match(sql, /Commercial template revision status transition is invalid/);
  assert.match(sql, /Bid content revision status transition is invalid/);
  assert.match(sql, /Bid output profile status transition is invalid/);
  assert.match(sql, /Published commercial template revisions can only be retired/);
  assert.match(sql, /Published bid content revisions can only be retired/);
  assert.match(sql, /Published bid output profiles can only be retired/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('bid workspace migration freezes project sources and enforces one open version per opportunity', async () => {
  const sql = await readFile(opportunityBidWorkspacesMigrationPath, 'utf8');

  assert.match(sql, /opportunity_technical_drafts_open_idx/);
  assert.match(sql, /WHERE status IN \('draft', 'ready', 'pending'\)/);
  assert.match(sql, /quotation_package_versions_combined_open_idx/);
  assert.match(sql, /WHERE status IN \('draft', 'pending'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_bid_workspaces/);
  assert.match(sql, /opportunity_id bigint NOT NULL UNIQUE REFERENCES opportunities\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /technical_template_revision_id bigint NOT NULL/);
  assert.match(sql, /commercial_template_revision_id bigint NOT NULL/);
  assert.match(sql, /output_profile_id bigint NOT NULL REFERENCES bid_output_profiles\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /Bid workspace requires an active current published technical template revision/);
  assert.match(sql, /Opportunity bid workspace source snapshots are immutable/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_commercial_drafts/);
  assert.match(sql, /opportunity_commercial_drafts_open_idx/);
  assert.match(sql, /opportunity_commercial_drafts_formal_version_idx/);
  assert.match(sql, /Commercial draft versions must be created as drafts/);
  assert.match(sql, /template_content_schema IS DISTINCT FROM NEW\.content_schema_snapshot/);
  assert.match(sql, /Approved and rejected commercial draft versions are immutable/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS bid_section_changes/);
  assert.match(sql, /package_type IN \('technical', 'commercial', 'complete'\)/);
  assert.match(sql, /Bid section change source does not belong to its workspace/);
  assert.match(sql, /Bid section changes are append-only/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('quotation package document migration binds immutable generated files to approved bid versions', async () => {
  const sql = await readFile(quotationPackageDocumentsMigrationPath, 'utf8');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS workspace_id bigint/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS commercial_draft_id bigint/);
  assert.match(sql, /quotation_package_versions_bid_center_binding_check/);
  assert.match(sql, /Bid center quotation package requires an approved commercial version from the same workspace/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS quotation_package_documents/);
  assert.match(sql, /content bytea NOT NULL/);
  assert.match(sql, /byte_size bigint NOT NULL CHECK \(byte_size > 0\)/);
  assert.match(sql, /sha256 char\(64\) NOT NULL/);
  assert.match(sql, /UNIQUE \(quotation_package_version_id, document_type\)/);
  assert.match(sql, /Quotation package documents require matching approved frozen source versions/);
  assert.match(sql, /Generated quotation package documents are immutable/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION protect_quotation_package_version/);
  assert.match(sql, /NEW\.workspace_id IS NOT DISTINCT FROM OLD\.workspace_id/);
  assert.match(sql, /NEW\.commercial_draft_id IS NOT DISTINCT FROM OLD\.commercial_draft_id/);
  assert.match(sql, /NEW\.sent_email_message_id IS NOT DISTINCT FROM OLD\.sent_email_message_id/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('bid package editor migration preserves project edits, attachments, suggestions, and actor audit', async () => {
  const sql = await readFile(bidPackageEditorsMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS bid_package_events/);
  assert.match(sql, /event_type IN \(/);
  assert.match(sql, /'variables_saved'/);
  assert.match(sql, /'section_restored'/);
  assert.match(sql, /'assignment_added'/);
  assert.match(sql, /Bid package events are append-only/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS bid_package_attachments/);
  assert.match(sql, /sha256 char\(64\) NOT NULL/);
  assert.match(sql, /removed_by bigint REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /one soft removal/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS bid_library_suggestions/);
  assert.match(sql, /target_kind IN \('content_block', 'template_revision'\)/);
  assert.match(sql, /status text NOT NULL DEFAULT 'draft'/);
  assert.match(sql, /content_snapshot jsonb NOT NULL/);
  assert.match(sql, /Bid package source does not belong to its workspace/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('bid package approval migration adds completeness audit, reviewer separation, and immutable revisions', async () => {
  const sql = await readFile(bidPackageApprovalsMigrationPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS bid_package_completeness_checks/);
  assert.match(sql, /package_type IN \('technical', 'commercial', 'complete'\)/);
  assert.match(sql, /snapshot_sha256 char\(64\) NOT NULL/);
  assert.match(sql, /Bid package completeness checks are append-only/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS review_source_package_id bigint/);
  assert.match(sql, /reviewed_by <> submitted_by/);
  assert.match(sql, /Submitted technical package attachments are immutable/);
  assert.match(sql, /Submitted commercial package attachments are immutable/);
  assert.match(sql, /Complete bid review revisions require a rejected source from the same workspace/);
});

test('bid package output identity migration binds all outputs to one generator and source snapshot', async () => {
  const sql = await readFile(bidPackageOutputIdentityMigrationPath, 'utf8');
  assert.match(sql, /output_profile_revision_no integer/);
  assert.match(sql, /source_snapshot_sha256 char\(64\)/);
  assert.match(sql, /generation_key char\(64\)/);
  assert.match(sql, /validate_quotation_package_document_identity/);
  assert.match(sql, /generated_bid_package_outputs/);
  assert.match(sql, /downloaded_bid_output/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
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

test('customer website migration adds website to customer records', async () => {
  const sql = await readFile(customerWebsiteMigrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE customers/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS website text/);
});

test('inquiry disposition migration separates product and opportunity type and adds final outcomes', async () => {
  const sql = await readFile(inquiryDispositionMigrationPath, 'utf8');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS opportunity_type text NOT NULL DEFAULT ''/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS product_interest text NOT NULL DEFAULT ''/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS inquiries_status_check/);
  assert.match(sql, /'contact_saved'/);
  assert.match(sql, /'customer_saved'/);
});

test('inquiry customer collaboration migration adds a pending state and auditable approval records', async () => {
  const sql = await readFile(inquiryCustomerCollaborationMigrationPath, 'utf8');

  assert.match(sql, /'customer_approval_pending'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inquiry_customer_approvals/);
  assert.match(sql, /customer_id bigint NOT NULL REFERENCES customers\(id\)/);
  assert.match(sql, /requested_by bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /customer_owner_user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /reviewer_user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /request_payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /converted_opportunity_id bigint REFERENCES opportunities\(id\) ON DELETE SET NULL/);
  assert.match(sql, /WHERE status = 'pending'/);
});

test('sales lead submissions migration enforces inquiry-first opportunity creation', async () => {
  const sql = await readFile(salesLeadSubmissionsMigrationPath, 'utf8');

  assert.match(sql, /ADD COLUMN IF NOT EXISTS submission_type text NOT NULL DEFAULT 'standard'/);
  assert.match(sql, /CHECK \(submission_type IN \('standard', 'sales_lead'\)\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'other'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS recommended_salesperson_id bigint REFERENCES users\(id\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS origin_inquiry_id bigint REFERENCES inquiries\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS opportunities_origin_inquiry_unique_idx/);
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

test('login security migration creates lockout state and audit log tables', async () => {
  const sql = await readFile(loginSecurityMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS login_attempt_states/);
  assert.match(sql, /identity_key text PRIMARY KEY/);
  assert.match(sql, /failed_count integer NOT NULL DEFAULT 0/);
  assert.match(sql, /locked_until timestamptz/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS login_audit_events/);
  assert.match(sql, /username text NOT NULL/);
  assert.match(sql, /user_id bigint REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(sql, /ip_address text/);
  assert.match(sql, /user_agent text/);
  assert.match(sql, /result text NOT NULL/);
  assert.match(sql, /reason text/);
});

test('sales work migration creates plan and log records', async () => {
  const sql = await readFile(salesWorkMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS sales_work_plans/);
  assert.match(sql, /salesperson_user_id bigint NOT NULL REFERENCES users\(id\)/);
  assert.match(sql, /plan_date date NOT NULL/);
  assert.match(sql, /customer_id bigint REFERENCES customers\(id\) ON DELETE SET NULL/);
  assert.match(sql, /contact_id bigint REFERENCES contacts\(id\) ON DELETE SET NULL/);
  assert.match(sql, /opportunity_id bigint REFERENCES opportunities\(id\) ON DELETE SET NULL/);
  assert.match(sql, /activity_type text NOT NULL/);
  assert.match(sql, /status text NOT NULL DEFAULT 'planned'/);
  assert.match(sql, /status IN \('planned', 'completed', 'cancelled'\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS sales_work_plans_salesperson_date_idx/);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS sales_work_logs/);
  assert.match(sql, /log_date date NOT NULL/);
  assert.match(sql, /content text NOT NULL/);
  assert.match(sql, /next_plan_date date/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS sales_work_logs_salesperson_date_idx/);
});

test('inquiry inbox migration creates controlled intake records', async () => {
  const sql = await readFile(inquiryInboxMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS inquiries/);
  assert.match(sql, /source text NOT NULL DEFAULT 'manual'/);
  assert.match(sql, /source IN \('manual', 'website', 'email', 'chatwoot'\)/);
  assert.match(sql, /requirement_text text NOT NULL/);
  assert.match(sql, /raw_payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /priority IN \('low', 'normal', 'high', 'urgent'\)/);
  assert.match(sql, /status IN \('new', 'reviewing', 'converted', 'duplicate', 'spam', 'archived'\)/);
  assert.match(sql, /assigned_user_id bigint REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(sql, /matched_customer_id bigint REFERENCES customers\(id\) ON DELETE SET NULL/);
  assert.match(sql, /converted_opportunity_id bigint REFERENCES opportunities\(id\) ON DELETE SET NULL/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS inquiries_status_created_idx/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS inquiries_source_reference_idx/);
});

test('inquiry source reference migration prevents duplicate external intake', async () => {
  const sql = await readFile(inquirySourceReferenceUniqueMigrationPath, 'utf8');

  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS inquiries_source_reference_unique_idx/);
  assert.match(sql, /ON inquiries\(source, source_reference\)/);
  assert.match(sql, /WHERE source_reference <> ''/);
});

test('notification center migration creates inbox, channel queue, push subscriptions, and workflow trigger', async () => {
  const sql = await readFile(notificationCenterMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_preferences/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notifications/);
  assert.match(sql, /priority IN \('normal', 'high', 'critical'\)/);
  assert.match(sql, /UNIQUE \(user_id, source_type, source_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS notification_deliveries/);
  assert.match(sql, /channel IN \('web_push', 'email', 'sms'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS web_push_subscriptions/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION create_workflow_notification/);
  assert.match(sql, /AFTER INSERT ON workflow_events/);
  assert.match(sql, /NEW\.target_user_id IS NULL OR NEW\.target_user_id = NEW\.actor_user_id/);
  assert.match(sql, /notification_priority = 'critical'/);
  assert.match(sql, /pg_notify\('bestcrm_notifications'/);
});

test('workflow notification recipients migration also notifies the salesperson after manager approvals', async () => {
  const sql = await readFile(notificationWorkflowRecipientsMigrationPath, 'utf8');

  assert.match(sql, /CREATE OR REPLACE FUNCTION create_workflow_secondary_notifications/);
  assert.match(sql, /NEW\.event_type NOT IN \('approve_initiation', 'approve_technical_solution'\)/);
  assert.match(sql, /SELECT\s+salesperson_id,/);
  assert.match(sql, /recipient_user_id = NEW\.actor_user_id/);
  assert.match(sql, /recipient_user_id = NEW\.target_user_id/);
  assert.match(sql, /CREATE TRIGGER workflow_event_secondary_notification_trigger/);
  assert.match(sql, /AFTER INSERT ON workflow_events/);
  assert.match(sql, /EXECUTE FUNCTION create_workflow_secondary_notifications/);
});

test('email center migration creates immutable threaded business mail archive', async () => {
  const sql = await readFile(emailCenterArchiveMigrationPath, 'utf8');

  for (const table of ['email_threads', 'email_messages', 'email_attachments', 'email_delivery_attempts']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS email_messages_message_id_idx/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_uid_idx/);
  assert.match(sql, /provider_uid_validity/);
  assert.match(sql, /in_reply_to/);
  assert.match(sql, /reference_ids jsonb/);
  assert.match(sql, /sha256 char\(64\)/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /Business email archive records cannot be deleted/);
  assert.match(sql, /Inbound email messages are immutable/);
  assert.match(sql, /Archived email attachments are immutable/);
  assert.match(sql, /inquiries_link_email_threads_after_conversion/);
});

test('customer email sending migration binds immutable outbound mail to approved quotation versions', async () => {
  const sql = await readFile(customerEmailSendingMigrationPath, 'utf8');

  assert.match(sql, /email_signature_name text NOT NULL DEFAULT ''/);
  assert.match(sql, /email_signature_title text NOT NULL DEFAULT ''/);
  assert.match(sql, /delivery_status IN \('received', 'draft', 'pending', 'sent', 'failed'\)/);
  assert.match(sql, /reply_to_message_id bigint/);
  assert.match(sql, /quotation_package_version_id bigint/);
  assert.match(sql, /sent_email_message_id bigint/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /Formal quotation email requires an approved quotation package from the same opportunity/);
  assert.match(sql, /Sent quotation package requires its accepted outbound email record/);
  assert.match(sql, /Sent email delivery state is immutable/);
});

test('Google Workspace customer center migration adds secret-safe mailbox and Gmail archive identity', async () => {
  const sql = await readFile(googleWorkspaceCustomerCenterMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS mailbox_connections/);
  assert.match(sql, /provider text NOT NULL/);
  assert.match(sql, /mailbox_address text NOT NULL/);
  assert.match(sql, /encrypted_refresh_token jsonb/);
  assert.match(sql, /token_key_version integer/);
  assert.match(sql, /granted_scopes text\[\]/);
  assert.match(sql, /connection_status IN \('disconnected', 'connected', 'degraded', 'revoked'\)/);
  assert.match(sql, /mailbox_connections_token_state_check/);
  assert.match(sql, /octet_length\(decode\(encrypted_refresh_token ->> 'tokenNonce', 'base64'\)\) = 12/);
  assert.match(sql, /octet_length\(decode\(encrypted_refresh_token ->> 'tokenAuthTag', 'base64'\)\) = 16/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS mailbox_connections_provider_mailbox_idx/);
  assert.match(sql, /Mailbox connections cannot be deleted; revoke them instead/);
  assert.doesNotMatch(sql, /google_password|client_secret|access_token/i);

  for (const column of [
    'mailbox_connection_id',
    'workflow_status',
    'assigned_user_id',
    'assigned_at',
    'assigned_by',
    'completed_at',
    'completed_by',
    'last_inbound_at',
    'last_outbound_at',
    'provider_thread_id'
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /workflow_status IN \('unassigned', 'assigned', 'waiting_customer', 'completed'\)/);
  assert.match(sql, /email_threads_assignment_state_check/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS email_threads_provider_thread_identity_idx/);

  for (const column of [
    'provider_name',
    'provider_history_id',
    'raw_eml_stored_path',
    'raw_eml_file_size',
    'raw_eml_sha256',
    'imported_at',
    'provider_labels'
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(sql, /email_messages_raw_eml_state_check/);
  assert.match(sql, /imported_at IS NULL OR raw_eml_stored_path IS NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_message_identity_idx/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS email_messages_raw_eml_path_idx/);
  assert.match(sql, /Email message mailbox connection must match its thread/);
  assert.match(sql, /Inbound email messages are immutable/);
  assert.match(sql, /Archived raw email identity is immutable/);
});

test('Google Workspace customer center migration creates an append-only assignment event stream', async () => {
  const sql = await readFile(googleWorkspaceCustomerCenterMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS email_thread_assignment_events/);
  assert.match(sql, /previous_assigned_user_id bigint REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /new_assigned_user_id bigint REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /action IN \('claim', 'assign', 'transfer', 'release', 'wait_customer', 'reopen', 'complete'\)/);
  assert.match(sql, /acted_by bigint NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /email_thread_assignment_events_transition_check/);
  assert.match(sql, /action NOT IN \('transfer', 'release'\) OR btrim\(reason\) <> ''/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON email_thread_assignment_events/);
  assert.match(sql, /Email thread assignment events are append-only/);
});

test('customer code migration backfills stable immutable C000001-style codes', async () => {
  const sql = await readFile(customerCodeMigrationPath, 'utf8');

  assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS customer_code_seq/);
  assert.match(sql, /MAXVALUE 999999/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS customer_code text/);
  assert.match(sql, /row_number\(\) OVER \(ORDER BY id\)/);
  assert.match(sql, /nextval\('customer_code_seq'\)/);
  assert.match(sql, /'C' \|\| lpad/);
  assert.match(sql, /customers_customer_code_unique_idx/);
  assert.match(sql, /customer_code ~ '\^C\[0-9\]\{6\}\$'/);
  assert.match(sql, /ALTER COLUMN customer_code SET NOT NULL/);
  assert.match(sql, /bestcrm_protect_customer_code/);
  assert.match(sql, /customer_code is immutable/);
});

test('contact code migration backfills stable immutable CT000001-style codes', async () => {
  const sql = await readFile(contactCodeMigrationPath, 'utf8');

  assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS contact_code_seq/);
  assert.match(sql, /MAXVALUE 999999/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS contact_code text/);
  assert.match(sql, /row_number\(\) OVER \(ORDER BY id\)/);
  assert.match(sql, /substring\(contact_code FROM 3\)/);
  assert.match(sql, /nextval\('contact_code_seq'\)/);
  assert.match(sql, /'CT' \|\| lpad/);
  assert.match(sql, /contacts_contact_code_unique_idx/);
  assert.match(sql, /contact_code ~ '\^CT\[0-9\]\{6\}\$'/);
  assert.match(sql, /ALTER COLUMN contact_code SET NOT NULL/);
  assert.match(sql, /bestcrm_protect_contact_code/);
  assert.match(sql, /contact_code is immutable/);
});

test('contact code prefix migration converts existing codes and configures immutable L000001-style codes', async () => {
  const sql = await readFile(contactCodeLPrefixMigrationPath, 'utf8');

  assert.match(sql, /contact_code !~ '\^CT\[0-9\]\{6\}\$'/);
  assert.match(sql, /UPDATE contacts\s+SET contact_code = 'L' \|\| substring\(contact_code FROM 3\)/);
  assert.match(sql, /ALTER COLUMN contact_code SET DEFAULT \('L' \|\| lpad\(nextval\('contact_code_seq'\)::text, 6, '0'\)\)/);
  assert.match(sql, /contact_code ~ '\^L\[0-9\]\{6\}\$'/);

  const triggerDrop = sql.indexOf('DROP TRIGGER IF EXISTS contacts_protect_contact_code');
  const conversion = sql.indexOf("UPDATE contacts\nSET contact_code = 'L'");
  const triggerRestore = sql.lastIndexOf('CREATE TRIGGER contacts_protect_contact_code');
  assert.ok(triggerDrop >= 0 && triggerDrop < conversion);
  assert.ok(triggerRestore > conversion);
});

test('IMAP sync migration separates realtime and historical cursors and preserves triage evidence', async () => {
  const sql = await readFile(imapSyncAndEmailTriageMigrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS email_imap_sync_states/);
  assert.match(sql, /UNIQUE \(mailbox_key, mailbox_name\)/);
  assert.match(sql, /incremental_last_uid bigint NOT NULL DEFAULT 0/);
  assert.match(sql, /backfill_before_uid bigint/);
  assert.match(sql, /backfill_complete boolean NOT NULL DEFAULT false/);
  assert.match(sql, /archive_disposition IN \('active', 'archived', 'spam'\)/);
  assert.match(sql, /classification_category text NOT NULL/);
  assert.match(sql, /classification_reason text NOT NULL/);
  assert.match(sql, /NEW\.archive_disposition IS DISTINCT FROM OLD\.archive_disposition/);
  const triggerDrop = sql.indexOf('DROP TRIGGER IF EXISTS email_messages_protect_content');
  const legacyBackfill = sql.indexOf('UPDATE email_messages message');
  const triggerRestore = sql.lastIndexOf('CREATE TRIGGER email_messages_protect_content');
  assert.ok(triggerDrop >= 0 && triggerDrop < legacyBackfill);
  assert.ok(triggerRestore > legacyBackfill);
  assert.doesNotMatch(sql, /password|authorization_code|refresh_token/i);
});

test('customer and contact uniqueness migration enforces the approved business identities', async () => {
  const sql = await readFile(customerContactUniquenessMigrationPath, 'utf8');

  assert.match(sql, /bestcrm_normalize_identity_text/);
  assert.match(sql, /bestcrm_normalize_phone/);
  assert.match(sql, /\^0086\[1-9\]\[0-9\]\{10\}\$/);
  assert.match(sql, /\^86\[1-9\]\[0-9\]\{10\}\$/);
  assert.match(sql, /Duplicate customer unit names exist/);
  assert.match(sql, /Duplicate contact identities exist/);
  assert.match(sql, /customers_normalized_name_unique_idx/);
  assert.match(sql, /contacts_customer_name_phone_unique_idx/);
  assert.match(sql, /WHERE bestcrm_normalize_phone\(phone\) <> ''/);
});

test('opportunity record guardrails migration makes core records stable, archivable, and non-deletable', async () => {
  const sql = await readFile(opportunityRecordGuardrailsMigrationPath, 'utf8');

  for (const table of ['customers', 'contacts', 'opportunities']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table}\\s+[\\s\\S]*ADD COLUMN IF NOT EXISTS record_uid uuid`));
    assert.match(sql, new RegExp(`${table}_record_uid_unique_idx`));
    assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_prevent_delete`));
    assert.match(sql, new RegExp(`CREATE TRIGGER ${table}_protect_record_uid`));
  }
  assert.match(sql, /CREATE TABLE record_lifecycle_events/);
  assert.match(sql, /event_type IN \('archive', 'reopen', 'merge'\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON record_lifecycle_events/);
  assert.match(sql, /Core CRM records cannot be deleted/);
  assert.match(sql, /Stable record UID cannot be changed/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /ON DELETE SET NULL/);
});

test('opportunity activity spine migration creates typed append-only links and transaction-local indexing', async () => {
  const sql = await readFile(opportunityActivitySpineMigrationPath, 'utf8');

  for (const table of [
    'opportunity_contacts',
    'activity_types',
    'opportunity_activities',
    'opportunity_activity_links',
    'opportunity_activity_participants',
    'opportunity_activity_backfill_state'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  for (const type of [
    'email', 'meeting', 'call', 'channel_message', 'note', 'task', 'file',
    'workflow', 'approval', 'technical', 'quotation', 'contract', 'ownership', 'outcome'
  ]) {
    assert.match(sql, new RegExp(`\\('${type}'`));
  }
  assert.match(sql, /num_nonnulls\([\s\S]*engineering_contribution_id[\s\S]*\) = 1/);
  assert.match(sql, /UNIQUE \(source_system, source_external_key\)/);
  assert.match(sql, /Opportunity activity spine records are append-only/);
  assert.match(sql, /bestcrm_index_activity_source\(p_source_table text, p_source_id bigint\)/);
  assert.match(sql, /AFTER INSERT ON email_messages/);
  assert.match(sql, /AFTER UPDATE OF opportunity_id ON email_threads/);
  assert.match(sql, /bestcrm_protect_indexed_source_opportunity/);
  assert.match(sql, /AFTER UPDATE OF opportunity_id ON sales_work_plans/);
  assert.match(sql, /AFTER UPDATE OF opportunity_id ON sales_work_logs/);
  assert.match(sql, /rawEmlSha256/);
  assert.doesNotMatch(sql, /text_body|html_body|password|secret|token/i);
});

test('raw email archive migration creates immutable evidence, scan indexes, and transitional message binding', async () => {
  const sql = await readFile(emailRawArchiveFoundationMigrationPath, 'utf8');

  for (const table of [
    'email_raw_messages',
    'email_raw_scan_attempts',
    'email_raw_processing_attempts',
    'email_attachment_scan_attempts',
    'email_classification_events'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /UNIQUE \(mailbox_key, provider_mailbox, provider_uid_validity, provider_uid\)/);
  assert.match(sql, /sha256 char\(64\) NOT NULL CHECK \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS raw_message_id bigint/);
  assert.match(sql, /REFERENCES email_raw_messages\(id\) ON DELETE RESTRICT/);
  assert.match(sql, /email_messages_raw_message_idx/);
  assert.match(sql, /Nullable only during the historical raw-email backfill transition/);
  assert.match(sql, /Email evidence records are immutable and append-only/);
  assert.match(sql, /Raw email compatibility fields must match authoritative evidence/);
  assert.match(sql, /OLD\.raw_message_id IS NULL[\s\S]*NEW\.raw_message_id IS NOT NULL/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('raw email backfill migration creates an independent resumable cursor', async () => {
  const sql = await readFile(emailRawBackfillCheckpointMigrationPath, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS raw_backfill_before_uid bigint/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS raw_backfill_complete boolean NOT NULL DEFAULT false/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_raw_backfill_sync_at timestamptz/);
  assert.match(sql, /email_imap_sync_states_raw_backfill_idx/);
  assert.match(sql, /never reuse the parsed-email backfill cursor/);
});

test('raw malware event migration stores metadata only and remains append-only', async () => {
  const sql = await readFile(emailRawMalwareEventsMigrationPath, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS email_raw_malware_events/);
  assert.match(sql, /provider_uid bigint NOT NULL CHECK \(provider_uid > 0\)/);
  assert.match(sql, /sha256 char\(64\) NOT NULL CHECK \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /verdict text NOT NULL CHECK \(verdict = 'malware'\)/);
  assert.match(sql, /email_raw_malware_events_no_change/);
  assert.match(sql, /raw bytes and CRM records are intentionally not stored/);
  assert.doesNotMatch(sql, /subject|from_address|to_recipients|text_body|html_body|stored_path|bytea/i);
});
