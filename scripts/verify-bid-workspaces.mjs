import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/db/migrate.mjs';
import { seedInternalAccounts } from '../src/db/seed.mjs';
import { ROLES } from '../src/domain/roles.mjs';
import { createBidWorkspaceRepository } from '../src/repositories/bidWorkspaceRepository.mjs';
import { createCommercialPackageTemplateRepository } from '../src/repositories/commercialPackageTemplateRepository.mjs';
import { createOpportunityCommercialDraftRepository } from '../src/repositories/opportunityCommercialDraftRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from '../src/repositories/opportunityTechnicalDraftRepository.mjs';
import { createTechnicalTemplateRepository } from '../src/repositories/technicalTemplateRepository.mjs';
import { hashPassword } from '../src/services/authService.mjs';
import { createBidWorkspaceService } from '../src/services/bidWorkspaceService.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Refusing to use a database whose name does not start with bestcrm_bid_center_test');
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const controlledAttachmentContent = Buffer.from('Step7 attachment', 'utf8');
const controlledAttachmentSha256 = createHash('sha256').update(controlledAttachmentContent).digest('hex');

async function one(sql, parameters = []) {
  const result = await pool.query(sql, parameters);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function expectDatabaseError(pattern, operation) {
  try {
    await operation();
    assert.fail('Expected a database error');
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.match(error.message, pattern);
  }
}

async function createOpportunityFixture(actorId, suffix) {
  const customer = await one(`
    INSERT INTO customers (name, industry, region, country, address, owner_user_id)
    VALUES ($1, 'Chemical', 'East', 'CN', 'Shanghai', $2)
    RETURNING id
  `, [`Step 4 Customer ${suffix}`, actorId]);
  return one(`
    INSERT INTO opportunities (
      opportunity_no, title, customer_id, requirement, estimated_amount,
      product_interest, project_type, delivery_cycle, expected_bid_date,
      status, salesperson_id, quotation_engineer_id
    ) VALUES ($1, $2, $3, '10 t/h mixer', 125000, 'Mixer', 'Bid', '12 weeks',
      DATE '2026-10-01', 'technical_solution', $4, $4)
    RETURNING id, opportunity_no, title, customer_id, primary_contact_id,
      salesperson_id, sales_manager_id, quotation_engineer_id,
      technical_manager_id, commercial_manager_id
  `, [`STEP4-${suffix}`, `Step 4 Bid Workspace ${suffix}`, customer.id, actorId]);
}

async function publishControlledSources(actorId) {
  const technicalTemplate = await one(`
    INSERT INTO technical_agreement_templates (
      template_code, name, product_family, product_model, language, created_by, updated_by
    ) VALUES ('TECH-STEP4', 'Step 4 Technical Package', 'Mixing', 'MX-100', 'bilingual', $1, $1)
    RETURNING id
  `, [actorId]);
  const technicalRevision = await one(`
    INSERT INTO technical_agreement_template_revisions (
      template_id, revision_no, status, change_summary, content_schema,
      created_by, submitted_by, submitted_at, published_by, published_at
    ) VALUES ($1, 1, 'published', 'Step 4 controlled source',
      '{"schemaVersion":1,"sections":[{"key":"cover","labelEn":"Cover","labelZh":"封面","sortOrder":1,"enabled":true,"bodyEn":"","bodyZh":"","tableRows":[],"defaultClauseIds":[]}]}'::jsonb,
      $2, $2, now(), $2, now())
    RETURNING id
  `, [technicalTemplate.id, actorId]);
  await pool.query('UPDATE technical_agreement_templates SET current_published_revision_id = $1 WHERE id = $2',
    [technicalRevision.id, technicalTemplate.id]);

  const contentBlock = await one(`
    INSERT INTO bid_content_blocks (
      block_code, category, name_en, name_zh, applicable_sections,
      owner_role_code, created_by, updated_by
    ) VALUES ('PAYMENT-STEP4', 'commercial', 'Payment Terms', '付款条件',
      '["pricing"]'::jsonb, 'commercial_manager', $1, $1)
    RETURNING id
  `, [actorId]);
  const contentRevision = await one(`
    INSERT INTO bid_content_block_revisions (
      content_block_id, revision_no, status, language, component_type,
      title_en, title_zh, content_schema, source_metadata,
      attachment_stored_path, attachment_original_name, attachment_mime_type,
      attachment_byte_size, attachment_sha256, effective_date, sensitivity,
      change_summary, created_by
    ) VALUES ($1, 1, 'draft', 'bilingual', 'controlled_attachment',
      'Payment Terms', '付款条件', '{"bodyEn":"Controlled payment terms","bodyZh":"受控付款条件"}'::jsonb,
      '{"libraryType":"standard_clause","sourceReference":"STEP4"}'::jsonb,
      'bid-content/step4/payment.pdf', 'payment.pdf', 'application/pdf', 16, $2,
      DATE '2026-01-01', 'confidential', 'Step 4 controlled material', $3)
    RETURNING id
  `, [contentBlock.id, controlledAttachmentSha256, actorId]);
  await pool.query(`UPDATE bid_content_block_revisions
    SET status = 'review_pending', submitted_by = $1, submitted_at = now() WHERE id = $2`, [actorId, contentRevision.id]);
  await pool.query(`UPDATE bid_content_block_revisions
    SET status = 'published', published_by = $1, published_at = now() WHERE id = $2`, [actorId, contentRevision.id]);
  await pool.query('UPDATE bid_content_blocks SET current_published_revision_id = $1 WHERE id = $2',
    [contentRevision.id, contentBlock.id]);

  const commercialTemplate = await one(`
    INSERT INTO commercial_package_templates (
      template_code, name_en, name_zh, language, created_by, updated_by
    ) VALUES ('COMM-STEP4', 'Step 4 Commercial Package', '第4步商务包', 'bilingual', $1, $1)
    RETURNING id
  `, [actorId]);
  const contentSchema = {
    schemaVersion: 1,
    sections: [{ key: 'pricing', labelEn: 'Pricing', labelZh: '价格', sortOrder: 1, contentBlockIds: [Number(contentBlock.id)] }]
  };
  const variableSchema = [{
    variableKey: 'total_price', labelEn: 'Total price', labelZh: '总价', dataType: 'number',
    sourceField: 'total_price', sectionKey: 'pricing', isRequired: true, defaultValue: '',
    validationRules: { min: 1 }, sortOrder: 1
  }];
  const commercialRevision = await one(`
    INSERT INTO commercial_package_template_revisions (
      template_id, revision_no, status, change_summary, content_schema,
      variable_schema, validation_rules, created_by
    ) VALUES ($1, 1, 'draft', 'Step 4 controlled source', $2::jsonb, $3::jsonb, '{}'::jsonb, $4)
    RETURNING id
  `, [commercialTemplate.id, JSON.stringify(contentSchema), JSON.stringify(variableSchema), actorId]);
  await pool.query(`UPDATE commercial_package_template_revisions
    SET status = 'review_pending', submitted_by = $1, submitted_at = now() WHERE id = $2`, [actorId, commercialRevision.id]);
  await pool.query(`UPDATE commercial_package_template_revisions
    SET status = 'published', published_by = $1, published_at = now() WHERE id = $2`, [actorId, commercialRevision.id]);
  await pool.query('UPDATE commercial_package_templates SET current_published_revision_id = $1 WHERE id = $2',
    [commercialRevision.id, commercialTemplate.id]);

  const outputProfile = await one(`
    INSERT INTO bid_output_profiles (
      profile_code, revision_no, name_en, name_zh, language_mode, status,
      layout_settings, brand_assets, change_summary, created_by
    ) VALUES ('GLOBAL-STEP4', 1, 'Step 4 Global Output', '第4步全球输出', 'bilingual', 'draft',
      '{"pageSize":"A4","marginMm":20}'::jsonb, '{"logo":"SUNKAIER"}'::jsonb,
      'Step 4 controlled output', $1)
    RETURNING id
  `, [actorId]);
  await pool.query(`UPDATE bid_output_profiles
    SET status = 'review_pending', submitted_by = $1, submitted_at = now() WHERE id = $2`, [actorId, outputProfile.id]);
  await pool.query(`UPDATE bid_output_profiles
    SET status = 'published', published_by = $1, published_at = now() WHERE id = $2`, [actorId, outputProfile.id]);

  return {
    technicalTemplateId: Number(technicalTemplate.id),
    technicalRevisionId: Number(technicalRevision.id),
    commercialTemplateId: Number(commercialTemplate.id),
    commercialRevisionId: Number(commercialRevision.id),
    contentBlockId: Number(contentBlock.id),
    contentRevisionId: Number(contentRevision.id),
    outputProfileId: Number(outputProfile.id),
    contentSchema,
    variableSchema
  };
}

function repositories(target) {
  return {
    bidWorkspaceRepository: createBidWorkspaceRepository(target),
    opportunityTechnicalDraftRepository: createOpportunityTechnicalDraftRepository(target),
    opportunityCommercialDraftRepository: createOpportunityCommercialDraftRepository(target),
    technicalTemplateRepository: createTechnicalTemplateRepository(target),
    commercialPackageTemplateRepository: createCommercialPackageTemplateRepository(target)
  };
}

function transactionWith({ failCommercialDraft = false } = {}) {
  return async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const scoped = repositories(client);
      if (failCommercialDraft) {
        scoped.opportunityCommercialDraftRepository = {
          async createDraft() { throw new Error('Synthetic commercial draft failure'); }
        };
      }
      const result = await callback(scoped);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}

async function createCommercialRevision2(source, actorId) {
  await pool.query(`UPDATE commercial_package_template_revisions
    SET status = 'retired', retired_by = $1, retired_at = now() WHERE id = $2`, [actorId, source.commercialRevisionId]);
  const revision = await one(`
    INSERT INTO commercial_package_template_revisions (
      template_id, revision_no, status, change_summary, content_schema,
      variable_schema, validation_rules, created_by
    ) VALUES ($1, 2, 'draft', 'Source changed after workspace creation', $2::jsonb, $3::jsonb, '{}'::jsonb, $4)
    RETURNING id
  `, [source.commercialTemplateId, JSON.stringify(source.contentSchema), JSON.stringify(source.variableSchema), actorId]);
  await pool.query(`UPDATE commercial_package_template_revisions
    SET status = 'review_pending', submitted_by = $1, submitted_at = now() WHERE id = $2`, [actorId, revision.id]);
  await pool.query(`UPDATE commercial_package_template_revisions
    SET status = 'published', published_by = $1, published_at = now() WHERE id = $2`, [actorId, revision.id]);
  await pool.query('UPDATE commercial_package_templates SET current_published_revision_id = $1 WHERE id = $2',
    [revision.id, source.commercialTemplateId]);
  return Number(revision.id);
}

async function verify() {
  await migrate(pool);
  await seedInternalAccounts(pool, { nodeEnv: 'test' });
  const browserPasswordHash = await hashPassword('Step4Browser123!');
  const actorRow = await one(`
    INSERT INTO users (username, password_hash, display_name, email)
    VALUES ('bid-center-step4', $1, 'Bid Center Step 4 Lead', 'step4@example.invalid')
    RETURNING id
  `, [browserPasswordHash]);
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, id FROM roles WHERE code = 'quotation_engineer'
  `, [actorRow.id]);
  const unauthorizedRow = await one(`
    INSERT INTO users (username, password_hash, display_name, email)
    VALUES ('bid-center-step4-outsider', 'not-a-real-password-hash', 'Step 4 Outsider', 'step4-outsider@example.invalid')
    RETURNING id
  `);
  const actorId = Number(actorRow.id);
  const actor = { id: actorId, roles: [ROLES.QUOTATION_ENGINEER] };
  const source = await publishControlledSources(actorId);
  const opportunityRow = await createOpportunityFixture(actorId, 'PRIMARY');
  await one(`
    INSERT INTO commercial_quotes (
      opportunity_id, total_price, payment_terms, validity_date, remarks,
      submitted_by, version_no, status, reviewed_by, reviewed_at
    ) VALUES ($1, 125000, '30/70', DATE '2026-12-31', 'Step 4 approved quote',
      $2, 1, 'approved', $2, now()) RETURNING id
  `, [opportunityRow.id, actorId]);
  const opportunity = {
    ...opportunityRow,
    id: Number(opportunityRow.id),
    customerId: Number(opportunityRow.customer_id),
    primaryContactId: null,
    salespersonId: actorId,
    salesManagerId: null,
    quotationEngineerId: actorId,
    technicalManagerId: null,
    commercialManagerId: null,
    teamMembers: []
  };
  const baseRepositories = repositories(pool);
  const service = createBidWorkspaceService({
    enabled: true,
    dependencies: { ...baseRepositories, workflowTransaction: transactionWith() }
  });
  const created = await service.create(actor, opportunity, {
    language: 'en',
    technicalTemplateRevisionId: source.technicalRevisionId,
    commercialTemplateRevisionId: source.commercialRevisionId,
    outputProfileId: source.outputProfileId,
    commercial__total_price: '150000'
  });
  assert.ok(created.id > 0);
  assert.equal(created.technicalDraft.draftLabel, 'TS-D1');
  assert.equal(created.commercialDraft.draftLabel, 'CP-D1');
  assert.equal(created.sourceMetadata.outputProfile.layoutSettings.pageSize, 'A4');
  assert.equal(created.sourceMetadata.contentComponentReferences[0].attachmentSha256, controlledAttachmentSha256);

  const counts = await one(`SELECT
    (SELECT count(*)::int FROM opportunity_bid_workspaces WHERE opportunity_id = $1) AS workspaces,
    (SELECT count(*)::int FROM opportunity_technical_drafts WHERE opportunity_id = $1) AS technical_drafts,
    (SELECT count(*)::int FROM opportunity_commercial_drafts WHERE opportunity_id = $1) AS commercial_drafts`,
  [opportunity.id]);
  assert.deepEqual(counts, { workspaces: 1, technical_drafts: 1, commercial_drafts: 1 });
  await assert.rejects(() => service.create(actor, opportunity, {
    language: 'en', technicalTemplateRevisionId: source.technicalRevisionId,
    commercialTemplateRevisionId: source.commercialRevisionId, outputProfileId: source.outputProfileId
  }), (error) => error.statusCode === 409);

  await expectDatabaseError(/source snapshots are immutable/, () => pool.query(
    `UPDATE opportunity_bid_workspaces SET source_metadata = '{"changed":true}'::jsonb WHERE id = $1`, [created.id]
  ));
  await expectDatabaseError(/source snapshots are immutable/, () => pool.query(
    `UPDATE opportunity_commercial_drafts SET source_metadata = '{"changed":true}'::jsonb WHERE workspace_id = $1`, [created.id]
  ));
  const commercialRevision2Id = await createCommercialRevision2(source, actorId);
  const frozen = await service.get(actor, created.id, { includeRestricted: true });
  assert.equal(frozen.commercialTemplate.revisionNo, 1);
  assert.equal(frozen.commercialDraft.sourceMetadata.templateRevisionId, source.commercialRevisionId);
  assert.notEqual(commercialRevision2Id, source.commercialRevisionId);

  const outsider = { id: Number(unauthorizedRow.id), roles: [ROLES.SALESPERSON] };
  assert.equal((await service.list(outsider)).length, 0);
  await assert.rejects(() => service.get(outsider, created.id), (error) => error.statusCode === 404);

  const rollbackOpportunityRow = await createOpportunityFixture(actorId, 'ROLLBACK');
  const rollbackOpportunity = {
    ...opportunity,
    id: Number(rollbackOpportunityRow.id),
    opportunityNo: rollbackOpportunityRow.opportunity_no,
    title: rollbackOpportunityRow.title,
    customerId: Number(rollbackOpportunityRow.customer_id)
  };
  const failingService = createBidWorkspaceService({
    enabled: true,
    dependencies: { ...baseRepositories, workflowTransaction: transactionWith({ failCommercialDraft: true }) }
  });
  await assert.rejects(() => failingService.create(actor, rollbackOpportunity, {
    language: 'en', technicalTemplateRevisionId: source.technicalRevisionId,
    commercialTemplateRevisionId: commercialRevision2Id, outputProfileId: source.outputProfileId
  }), /Synthetic commercial draft failure/);
  const rollbackCounts = await one(`SELECT
    (SELECT count(*)::int FROM opportunity_bid_workspaces WHERE opportunity_id = $1) AS workspaces,
    (SELECT count(*)::int FROM opportunity_technical_drafts WHERE opportunity_id = $1) AS technical_drafts,
    (SELECT count(*)::int FROM opportunity_commercial_drafts WHERE opportunity_id = $1) AS commercial_drafts`,
  [rollbackOpportunity.id]);
  assert.deepEqual(rollbackCounts, { workspaces: 0, technical_drafts: 0, commercial_drafts: 0 });

  console.log('Bid Center Step 4 workspace integration checks passed.');
}

verify()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
