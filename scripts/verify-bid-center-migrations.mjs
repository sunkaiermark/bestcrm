import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/db/migrate.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) {
  throw new Error('BID_CENTER_DB_TEST_URL is required');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Refusing to reset a database whose name does not start with bestcrm_bid_center_test');
}

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, '..', 'src', 'db', 'migrations');
const pool = new pg.Pool({ connectionString: databaseUrl });

async function applyMigrationsThrough(maxFileName) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql') && file <= maxFileName)
    .sort();

  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (applied.rowCount > 0) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
}

async function one(sql, parameters = []) {
  const result = await pool.query(sql, parameters);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function expectDatabaseError(label, pattern, operation) {
  try {
    await operation();
    assert.fail(`${label}: expected a database error`);
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.match(error.message, pattern, label);
  }
}

async function seedLegacyRecords() {
  const user = await one(`
    INSERT INTO users (username, password_hash, display_name, email)
    VALUES ('bid-center-step2', 'not-a-real-password-hash', 'Bid Center Step 2', 'step2@example.invalid')
    RETURNING id
  `);
  await pool.query(`
    INSERT INTO roles (code, name, description)
    VALUES ('commercial_manager', 'Commercial Manager', 'Synthetic migration fixture')
  `);
  const customer = await one(`
    INSERT INTO customers (name, industry, region, owner_user_id)
    VALUES ('Synthetic Migration Customer', 'chemical', 'test-only', $1)
    RETURNING id
  `, [user.id]);
  const opportunity = await one(`
    INSERT INTO opportunities (
      opportunity_no, title, customer_id, requirement, status, salesperson_id
    ) VALUES ('990001', 'Synthetic Bid Center Migration', $1, 'Migration verification only', 'technical_solution', $2)
    RETURNING id
  `, [customer.id, user.id]);
  const technicalTemplate = await one(`
    INSERT INTO technical_agreement_templates (
      template_code, name, product_family, language, created_by, updated_by
    ) VALUES ('TECH-STEP2', 'Synthetic Technical Template', 'Synthetic', 'en', $1, $1)
    RETURNING id
  `, [user.id]);
  const technicalRevision = await one(`
    INSERT INTO technical_agreement_template_revisions (
      template_id, revision_no, status, change_summary, content_schema,
      created_by, submitted_by, submitted_at, published_by, published_at
    ) VALUES (
      $1, 1, 'published', 'Legacy migration fixture',
      '{"schemaVersion":1,"sections":[]}'::jsonb,
      $2, $2, now(), $2, now()
    )
    RETURNING id
  `, [technicalTemplate.id, user.id]);
  await pool.query(`
    UPDATE technical_agreement_templates
    SET current_published_revision_id = $1
    WHERE id = $2
  `, [technicalRevision.id, technicalTemplate.id]);
  const technicalDraft = await one(`
    INSERT INTO opportunity_technical_drafts (
      opportunity_id, template_revision_id, draft_revision_no, formal_version_no,
      status, language, template_code_snapshot, template_name_snapshot,
      template_revision_no_snapshot, content_schema_snapshot, variable_schema_snapshot,
      rendered_content, created_by, updated_by, reviewed_by, reviewed_at
    ) VALUES (
      $1, $2, 1, 1, 'approved', 'en', 'TECH-STEP2', 'Synthetic Technical Template',
      1, '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
      '{"sections":[]}'::jsonb, $3, $3, $3, now()
    )
    RETURNING id
  `, [opportunity.id, technicalRevision.id, user.id]);
  const commercialQuote = await one(`
    INSERT INTO commercial_quotes (
      opportunity_id, total_price, payment_terms, validity_date, remarks,
      submitted_by, version_no, status, reviewed_by, reviewed_at
    ) VALUES (
      $1, 125000.00, '30% advance, 70% before shipment', DATE '2030-12-31',
      'Synthetic migration fixture', $2, 1, 'approved', $2, now()
    )
    RETURNING id
  `, [opportunity.id, user.id]);
  const quotationPackage = await one(`
    INSERT INTO quotation_package_versions (
      opportunity_id, draft_revision_no, version_no, status,
      technical_solution_version_id, commercial_quote_id, currency, total_price,
      delivery_period, payment_terms, valid_until, commercial_line_items,
      created_by, submitted_by, submitted_at, reviewed_by, reviewed_at, updated_by
    ) VALUES (
      $1, 1, 1, 'approved', $2, $3, 'USD', 125000.00,
      '16 weeks', '30% advance, 70% before shipment', DATE '2030-12-31', '[]'::jsonb,
      $4, $4, now(), $4, now(), $4
    )
    RETURNING id
  `, [opportunity.id, technicalDraft.id, commercialQuote.id, user.id]);

  return {
    userId: user.id,
    opportunityId: opportunity.id,
    technicalTemplateId: technicalTemplate.id,
    technicalRevisionId: technicalRevision.id,
    technicalDraftId: technicalDraft.id,
    commercialQuoteId: commercialQuote.id,
    quotationPackageId: quotationPackage.id
  };
}

async function verifyNewBidCenterRules(fixture) {
  const migrationCountBeforeRepeat = Number((await one('SELECT count(*)::int AS count FROM schema_migrations')).count);
  await migrate(pool);
  const migrationCountAfterRepeat = Number((await one('SELECT count(*)::int AS count FROM schema_migrations')).count);
  assert.equal(migrationCountAfterRepeat, migrationCountBeforeRepeat, 'migration runner must be repeatable');

  const expectedTables = [
    'commercial_package_templates',
    'commercial_package_template_revisions',
    'bid_content_blocks',
    'bid_content_block_revisions',
    'bid_output_profiles',
    'opportunity_bid_workspaces',
    'opportunity_commercial_drafts',
    'bid_section_changes',
    'quotation_package_documents'
  ];
  const tableRows = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])
  `, [expectedTables]);
  assert.deepEqual(tableRows.rows.map((row) => row.table_name).sort(), expectedTables.sort());

  const legacyTechnical = await one(`
    SELECT template_code, current_published_revision_id
    FROM technical_agreement_templates WHERE id = $1
  `, [fixture.technicalTemplateId]);
  assert.equal(legacyTechnical.template_code, 'TECH-STEP2');
  assert.equal(String(legacyTechnical.current_published_revision_id), String(fixture.technicalRevisionId));
  const legacyPackage = await one(`
    SELECT version_no, status, workspace_id, commercial_draft_id
    FROM quotation_package_versions WHERE id = $1
  `, [fixture.quotationPackageId]);
  assert.equal(legacyPackage.version_no, 1);
  assert.equal(legacyPackage.status, 'approved');
  assert.equal(legacyPackage.workspace_id, null);
  assert.equal(legacyPackage.commercial_draft_id, null);

  const commercialTemplate = await one(`
    INSERT INTO commercial_package_templates (
      template_code, name_en, name_zh, language, created_by, updated_by
    ) VALUES ('COMM-STEP2', 'Synthetic Commercial Package', '合成商务包', 'en', $1, $1)
    RETURNING id
  `, [fixture.userId]);
  const commercialRevision = await one(`
    INSERT INTO commercial_package_template_revisions (
      template_id, revision_no, change_summary, content_schema,
      variable_schema, validation_rules, created_by
    ) VALUES (
      $1, 1, 'Initial controlled revision',
      '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb, '{}'::jsonb, $2
    )
    RETURNING id
  `, [commercialTemplate.id, fixture.userId]);
  await pool.query(`
    UPDATE commercial_package_template_revisions
    SET status = 'review_pending', submitted_by = $2, submitted_at = now()
    WHERE id = $1
  `, [commercialRevision.id, fixture.userId]);
  await pool.query(`
    UPDATE commercial_package_template_revisions
    SET status = 'published', published_by = $2, published_at = now()
    WHERE id = $1
  `, [commercialRevision.id, fixture.userId]);
  await pool.query(`
    UPDATE commercial_package_templates
    SET current_published_revision_id = $1
    WHERE id = $2
  `, [commercialRevision.id, commercialTemplate.id]);
  await expectDatabaseError(
    'published commercial template content is immutable',
    /commercial template revision content is immutable/i,
    () => pool.query(`UPDATE commercial_package_template_revisions SET content_schema = '{"changed":true}'::jsonb WHERE id = $1`, [commercialRevision.id])
  );
  await expectDatabaseError(
    'published commercial template cannot return to draft',
    /can only be retired/i,
    () => pool.query(`UPDATE commercial_package_template_revisions SET status = 'draft' WHERE id = $1`, [commercialRevision.id])
  );

  const contentBlock = await one(`
    INSERT INTO bid_content_blocks (
      block_code, category, name_en, name_zh, applicable_sections,
      owner_role_code, created_by, updated_by
    ) VALUES (
      'COMMON-STEP2', 'common', 'Synthetic Common Block', '合成通用模块',
      '["COMM-20","COMMON-10"]'::jsonb, 'commercial_manager', $1, $1
    )
    RETURNING id
  `, [fixture.userId]);
  const contentRevision = await one(`
    INSERT INTO bid_content_block_revisions (
      content_block_id, revision_no, language, component_type,
      title_en, title_zh, content_schema, change_summary, created_by
    ) VALUES (
      $1, 1, 'en', 'narrative', 'Synthetic Common Block', '合成通用模块',
      '{"paragraphs":[]}'::jsonb, 'Initial controlled revision', $2
    )
    RETURNING id
  `, [contentBlock.id, fixture.userId]);
  await pool.query(`
    UPDATE bid_content_block_revisions
    SET status = 'review_pending', submitted_by = $2, submitted_at = now()
    WHERE id = $1
  `, [contentRevision.id, fixture.userId]);
  await pool.query(`
    UPDATE bid_content_block_revisions
    SET status = 'published', published_by = $2, published_at = now()
    WHERE id = $1
  `, [contentRevision.id, fixture.userId]);
  await pool.query(`
    UPDATE bid_content_blocks SET current_published_revision_id = $1 WHERE id = $2
  `, [contentRevision.id, contentBlock.id]);
  await expectDatabaseError(
    'published content block is immutable',
    /bid content revision is immutable/i,
    () => pool.query(`UPDATE bid_content_block_revisions SET title_en = 'Changed' WHERE id = $1`, [contentRevision.id])
  );

  const outputProfile = await one(`
    INSERT INTO bid_output_profiles (
      profile_code, revision_no, name_en, name_zh, language_mode,
      layout_settings, brand_assets, change_summary, created_by
    ) VALUES (
      'OUTPUT-STEP2', 1, 'Synthetic Output Profile', '合成输出配置', 'en',
      '{}', '{}', 'Initial controlled revision', $1
    )
    RETURNING id
  `, [fixture.userId]);
  await pool.query(`
    UPDATE bid_output_profiles
    SET status = 'review_pending', submitted_by = $2, submitted_at = now()
    WHERE id = $1
  `, [outputProfile.id, fixture.userId]);
  await pool.query(`
    UPDATE bid_output_profiles
    SET status = 'published', published_by = $2, published_at = now()
    WHERE id = $1
  `, [outputProfile.id, fixture.userId]);
  await expectDatabaseError(
    'published output profile is immutable',
    /bid output profile is immutable/i,
    () => pool.query(`UPDATE bid_output_profiles SET layout_settings = '{"changed":true}'::jsonb WHERE id = $1`, [outputProfile.id])
  );

  const workspace = await one(`
    INSERT INTO opportunity_bid_workspaces (
      opportunity_id, language, technical_template_revision_id,
      commercial_template_revision_id, output_profile_id, created_by, updated_by
    ) VALUES ($1, 'en', $2, $3, $4, $5, $5)
    RETURNING id
  `, [
    fixture.opportunityId,
    fixture.technicalRevisionId,
    commercialRevision.id,
    outputProfile.id,
    fixture.userId
  ]);
  await expectDatabaseError(
    'one workspace per opportunity',
    /duplicate key value/i,
    () => pool.query(`
      INSERT INTO opportunity_bid_workspaces (
        opportunity_id, language, technical_template_revision_id,
        commercial_template_revision_id, output_profile_id, created_by, updated_by
      ) VALUES ($1, 'en', $2, $3, $4, $5, $5)
    `, [fixture.opportunityId, fixture.technicalRevisionId, commercialRevision.id, outputProfile.id, fixture.userId])
  );

  const commercialDraftParameters = [
    workspace.id,
    fixture.opportunityId,
    commercialRevision.id,
    fixture.userId
  ];
  const commercialDraft = await one(`
    INSERT INTO opportunity_commercial_drafts (
      workspace_id, opportunity_id, template_revision_id, draft_revision_no,
      language, template_code_snapshot, template_name_snapshot,
      template_revision_no_snapshot, content_schema_snapshot, variable_schema_snapshot,
      validation_rules_snapshot, rendered_content, created_by, updated_by
    ) VALUES (
      $1, $2, $3, 1, 'en', 'COMM-STEP2', 'Synthetic Commercial Package',
      1, '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
      '{}'::jsonb, '{"sections":[]}'::jsonb, $4, $4
    )
    RETURNING id
  `, commercialDraftParameters);
  await pool.query(`
    UPDATE opportunity_commercial_drafts
    SET status = 'review_pending', submitted_by = $2, submitted_at = now(), updated_by = $2, updated_at = now()
    WHERE id = $1
  `, [commercialDraft.id, fixture.userId]);
  await pool.query(`
    UPDATE opportunity_commercial_drafts
    SET status = 'approved', formal_version_no = 1,
        reviewed_by = $2, reviewed_at = now(), updated_by = $2, updated_at = now()
    WHERE id = $1
  `, [commercialDraft.id, fixture.userId]);
  await expectDatabaseError(
    'approved commercial content is immutable',
    /commercial draft content is immutable/i,
    () => pool.query(`UPDATE opportunity_commercial_drafts SET rendered_content = '{"changed":true}'::jsonb WHERE id = $1`, [commercialDraft.id])
  );
  await expectDatabaseError(
    'approved commercial version metadata is immutable',
    /commercial draft versions are immutable/i,
    () => pool.query('UPDATE opportunity_commercial_drafts SET formal_version_no = 2 WHERE id = $1', [commercialDraft.id])
  );

  await pool.query(`
    INSERT INTO opportunity_commercial_drafts (
      workspace_id, opportunity_id, template_revision_id, draft_revision_no,
      language, template_code_snapshot, template_name_snapshot,
      template_revision_no_snapshot, content_schema_snapshot, variable_schema_snapshot,
      validation_rules_snapshot, rendered_content, created_by, updated_by
    ) VALUES (
      $1, $2, $3, 2, 'en', 'COMM-STEP2', 'Synthetic Commercial Package',
      1, '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
      '{}'::jsonb, '{"sections":[]}'::jsonb, $4, $4
    )
  `, commercialDraftParameters);
  await expectDatabaseError(
    'one open commercial draft per opportunity',
    /duplicate key value/i,
    () => pool.query(`
      INSERT INTO opportunity_commercial_drafts (
        workspace_id, opportunity_id, template_revision_id, draft_revision_no,
        language, template_code_snapshot, template_name_snapshot,
        template_revision_no_snapshot, content_schema_snapshot, variable_schema_snapshot,
        validation_rules_snapshot, rendered_content, created_by, updated_by
      ) VALUES (
        $1, $2, $3, 3, 'en', 'COMM-STEP2', 'Synthetic Commercial Package',
        1, '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
        '{}'::jsonb, '{"sections":[]}'::jsonb, $4, $4
      )
    `, commercialDraftParameters)
  );

  const technicalDraftParameters = [fixture.opportunityId, fixture.technicalRevisionId, fixture.userId];
  await pool.query(`
    INSERT INTO opportunity_technical_drafts (
      opportunity_id, template_revision_id, draft_revision_no, status, language,
      template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
      content_schema_snapshot, variable_schema_snapshot, rendered_content,
      created_by, updated_by
    ) VALUES (
      $1, $2, 2, 'draft', 'en', 'TECH-STEP2', 'Synthetic Technical Template', 1,
      '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
      '{"sections":[]}'::jsonb, $3, $3
    )
  `, technicalDraftParameters);
  await expectDatabaseError(
    'one open technical draft per opportunity',
    /duplicate key value/i,
    () => pool.query(`
      INSERT INTO opportunity_technical_drafts (
        opportunity_id, template_revision_id, draft_revision_no, status, language,
        template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
        content_schema_snapshot, variable_schema_snapshot, rendered_content,
        created_by, updated_by
      ) VALUES (
        $1, $2, 3, 'ready', 'en', 'TECH-STEP2', 'Synthetic Technical Template', 1,
        '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
        '{"sections":[]}'::jsonb, $3, $3
      )
    `, technicalDraftParameters)
  );

  const quotationPackage = await one(`
    INSERT INTO quotation_package_versions (
      opportunity_id, workspace_id, commercial_draft_id, draft_revision_no, status,
      technical_solution_version_id, commercial_quote_id, currency, total_price,
      delivery_period, payment_terms, valid_until, commercial_line_items,
      created_by, updated_by
    ) VALUES (
      $1, $2, $3, 2, 'draft', $4, $5, 'USD', 125000.00,
      '16 weeks', '30% advance, 70% before shipment', DATE '2030-12-31', '[]'::jsonb,
      $6, $6
    )
    RETURNING id
  `, [
    fixture.opportunityId,
    workspace.id,
    commercialDraft.id,
    fixture.technicalDraftId,
    fixture.commercialQuoteId,
    fixture.userId
  ]);
  await expectDatabaseError(
    'one open complete bid draft per opportunity',
    /duplicate key value/i,
    () => pool.query(`
      INSERT INTO quotation_package_versions (
        opportunity_id, workspace_id, commercial_draft_id, draft_revision_no, status,
        technical_solution_version_id, commercial_quote_id, currency, total_price,
        delivery_period, payment_terms, valid_until, commercial_line_items,
        created_by, updated_by
      ) VALUES (
        $1, $2, $3, 3, 'draft', $4, $5, 'USD', 125000.00,
        '16 weeks', '30% advance, 70% before shipment', DATE '2030-12-31', '[]'::jsonb,
        $6, $6
      )
    `, [fixture.opportunityId, workspace.id, commercialDraft.id, fixture.technicalDraftId, fixture.commercialQuoteId, fixture.userId])
  );
  await pool.query(`
    UPDATE quotation_package_versions
    SET status = 'pending', submitted_by = $2, submitted_at = now(), updated_by = $2, updated_at = now()
    WHERE id = $1
  `, [quotationPackage.id, fixture.userId]);
  await pool.query(`
    UPDATE quotation_package_versions
    SET status = 'approved', version_no = 2,
        reviewed_by = $2, reviewed_at = now(), updated_by = $2, updated_at = now()
    WHERE id = $1
  `, [quotationPackage.id, fixture.userId]);

  const documentContent = Buffer.from('%PDF-step-2');
  const document = await one(`
    INSERT INTO quotation_package_documents (
      quotation_package_version_id, workspace_id, technical_solution_version_id,
      commercial_draft_id, output_profile_id, document_type, document_no,
      original_name, mime_type, content, byte_size, sha256,
      generator_version, generated_by
    ) VALUES (
      $1, $2, $3, $4, $5, 'complete_pdf', 'QP-V2',
      'synthetic-bid.pdf', 'application/pdf', $6, $7, $8, 'step2-verifier', $9
    )
    RETURNING id
  `, [
    quotationPackage.id,
    workspace.id,
    fixture.technicalDraftId,
    commercialDraft.id,
    outputProfile.id,
    documentContent,
    documentContent.length,
    createHash('sha256').update(documentContent).digest('hex'),
    fixture.userId
  ]);
  await expectDatabaseError(
    'generated package documents are immutable',
    /documents are immutable/i,
    () => pool.query(`UPDATE quotation_package_documents SET original_name = 'changed.pdf' WHERE id = $1`, [document.id])
  );

  const sectionChange = await one(`
    INSERT INTO bid_section_changes (
      workspace_id, package_type, quotation_package_id, section_key,
      modification_status, change_type, reason, actor_user_id
    ) VALUES ($1, 'complete', $2, 'commercial_summary', 'standard', 'source_changed', 'Synthetic audit fixture', $3)
    RETURNING id
  `, [workspace.id, quotationPackage.id, fixture.userId]);
  await expectDatabaseError(
    'section change audit is append-only',
    /append-only/i,
    () => pool.query(`UPDATE bid_section_changes SET reason = 'changed' WHERE id = $1`, [sectionChange.id])
  );
}

try {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await applyMigrationsThrough('034_customer_email_sending.sql');
  const fixture = await seedLegacyRecords();
  await migrate(pool);
  await verifyNewBidCenterRules(fixture);
  console.log(`Bid Center migration verification passed on isolated database ${databaseName}`);
} finally {
  await pool.end();
}
