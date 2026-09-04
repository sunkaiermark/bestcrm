import assert from 'node:assert/strict';
import pg from 'pg';
import { createWorkflowTransaction } from '../src/db/workflowTransaction.mjs';
import { createBidContentBlockRepository } from '../src/repositories/bidContentBlockRepository.mjs';
import { createBidPackageEditorRepository } from '../src/repositories/bidPackageEditorRepository.mjs';
import { createBidWorkspaceRepository } from '../src/repositories/bidWorkspaceRepository.mjs';
import { createOpportunityCommercialDraftRepository } from '../src/repositories/opportunityCommercialDraftRepository.mjs';
import { createOpportunityRepository } from '../src/repositories/opportunityRepository.mjs';
import { createOpportunityResponsibilityRepository } from '../src/repositories/opportunityResponsibilityRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from '../src/repositories/opportunityTechnicalDraftRepository.mjs';
import { createTechnicalTemplateRepository } from '../src/repositories/technicalTemplateRepository.mjs';
import { ROLES } from '../src/domain/roles.mjs';
import { createBidPackageEditorService } from '../src/services/bidPackageEditorService.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Refusing to use a database whose name does not start with bestcrm_bid_center_test');
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function expectDatabaseError(pattern, operation) {
  try {
    await operation();
    assert.fail('Expected a database error');
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.match(error.message, pattern);
  }
}

async function verify() {
  const actorResult = await pool.query(`
    SELECT user_record.id
    FROM users user_record
    WHERE user_record.username = 'bid-center-step4'
    LIMIT 1
  `);
  assert.equal(actorResult.rowCount, 1, 'Run verify-bid-workspaces.mjs first');
  const actorId = Number(actorResult.rows[0].id);
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, id FROM roles WHERE code = 'commercial_manager'
    ON CONFLICT DO NOTHING
  `, [actorId]);
  const workspaceResult = await pool.query(`
    SELECT workspace.id, workspace.opportunity_id
    FROM opportunity_bid_workspaces workspace
    JOIN opportunities opportunity ON opportunity.id = workspace.opportunity_id
    WHERE opportunity.opportunity_no = 'STEP4-PRIMARY'
    LIMIT 1
  `);
  assert.equal(workspaceResult.rowCount, 1);
  const workspaceId = Number(workspaceResult.rows[0].id);
  const opportunityId = Number(workspaceResult.rows[0].opportunity_id);
  await pool.query('UPDATE opportunities SET commercial_manager_id = $1 WHERE id = $2', [actorId, opportunityId]);

  const repositories = {
    bidContentBlockRepository: createBidContentBlockRepository(pool),
    bidPackageEditorRepository: createBidPackageEditorRepository(pool),
    bidWorkspaceRepository: createBidWorkspaceRepository(pool),
    opportunityCommercialDraftRepository: createOpportunityCommercialDraftRepository(pool),
    opportunityRepository: createOpportunityRepository(pool),
    opportunityResponsibilityRepository: createOpportunityResponsibilityRepository(pool),
    opportunityTechnicalDraftRepository: createOpportunityTechnicalDraftRepository(pool),
    technicalTemplateRepository: createTechnicalTemplateRepository(pool),
    workflowTransaction: createWorkflowTransaction(pool)
  };
  const actor = { id: actorId, roles: [ROLES.QUOTATION_ENGINEER, ROLES.COMMERCIAL_MANAGER] };
  const service = createBidPackageEditorService({ enabled: true, dependencies: repositories });

  const initial = await service.getEditor(actor, workspaceId, 'technical', 'cover');
  const technicalDraftId = initial.draft.id;
  const originalTemplateSnapshot = structuredClone(initial.draft.contentSchemaSnapshot);
  await service.saveSection(actor, workspaceId, 'technical', 'cover', {
    bodyEn: 'Project-specific process narrative', bodyZh: '项目专用工艺说明',
    tableRows: 'Parameter | Value\nCapacity | 10 t/h', modificationStatus: 'needs_review',
    reason: 'Step 5 project-specific customer requirement'
  });
  const edited = await service.getEditor(actor, workspaceId, 'technical', 'cover');
  assert.equal(edited.activeSection.bodyEn, 'Project-specific process narrative');
  assert.equal(edited.activeSection.modificationStatus, 'needs_review');
  assert.deepEqual(edited.draft.contentSchemaSnapshot, originalTemplateSnapshot);
  assert.equal(edited.activeSection.diff.bodyEnChanged, true);

  await service.restoreSection(actor, workspaceId, 'technical', 'cover', {
    reason: 'Step 5 restore test'
  });
  const restored = await service.getEditor(actor, workspaceId, 'technical', 'cover');
  assert.equal(restored.activeSection.bodyEn, originalTemplateSnapshot.sections[0].bodyEn);
  assert.equal(restored.activeSection.modificationStatus, 'standard');

  const projectSectionKey = await service.addSection(actor, workspaceId, 'technical', {
    sectionKey: 'site_constraints', labelEn: 'Site Constraints', labelZh: '现场条件',
    bodyEn: 'Indoor installation', reason: 'Tender-specific site data'
  });
  assert.equal(projectSectionKey, 'site_constraints');
  await service.reorderSection(actor, workspaceId, 'technical', projectSectionKey, {
    direction: 'up', reason: 'Place site constraints before closing sections'
  });
  const withProjectSection = await service.getEditor(actor, workspaceId, 'technical', projectSectionKey);
  assert.equal(withProjectSection.activeSection.projectAdded, true);
  assert.equal(withProjectSection.activeSection.modificationStatus, 'project_added');

  const commercial = await service.getEditor(actor, workspaceId, 'commercial', 'pricing');
  const commercialDraftId = commercial.draft.id;
  assert.equal(commercial.activeSection.diff.contentBlocksChanged, false);
  await service.saveVariables(actor, workspaceId, 'commercial', 'pricing', {
    total_price: '175000', reason: 'Approved commercial quote update'
  });
  const commercialSaved = await service.getEditor(actor, workspaceId, 'commercial', 'pricing');
  assert.equal(commercialSaved.draft.variableValues.total_price, 175000);

  const attachment = await service.addAttachment(actor, workspaceId, 'technical', 'cover', {
    originalName: 'step5-drawing.pdf', storedPath: 'bid-workspaces/step5-drawing.pdf',
    mimeType: 'application/pdf', byteSize: 128, sha256: 'b'.repeat(64),
    reason: 'Tender drawing attachment'
  });
  assert.ok(attachment.id > 0);
  await service.removeAttachment(actor, workspaceId, 'technical', attachment.id, {
    reason: 'Superseded by customer revision'
  });
  const removed = await repositories.bidPackageEditorRepository.findAttachment(attachment.id);
  assert.ok(removed.removedAt);

  const suggestion = await service.suggestLibrary(actor, workspaceId, 'commercial', 'pricing', {
    targetKind: 'content_block', title: 'Reusable Step 5 pricing note',
    reason: 'Candidate for manager review after this project'
  });
  assert.equal(suggestion.status, 'draft');

  const auditCounts = (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM bid_section_changes WHERE workspace_id = $1) AS changes,
      (SELECT count(*)::int FROM bid_package_events WHERE workspace_id = $1) AS events,
      (SELECT count(*)::int FROM bid_package_attachments WHERE workspace_id = $1) AS attachments,
      (SELECT count(*)::int FROM bid_library_suggestions WHERE workspace_id = $1) AS suggestions
  `, [workspaceId])).rows[0];
  assert.ok(auditCounts.changes >= 7);
  assert.ok(auditCounts.events >= 7);
  assert.equal(auditCounts.attachments, 1);
  assert.equal(auditCounts.suggestions, 1);

  const eventId = (await pool.query('SELECT id FROM bid_package_events WHERE workspace_id = $1 LIMIT 1', [workspaceId])).rows[0].id;
  await expectDatabaseError(/append-only/, () => pool.query(
    `UPDATE bid_package_events SET details = '{"changed":true}'::jsonb WHERE id = $1`, [eventId]
  ));
  await expectDatabaseError(/does not belong to its workspace/, () => pool.query(`
    INSERT INTO bid_package_events (
      workspace_id, package_type, technical_draft_id, event_type, actor_user_id
    ) VALUES ($1, 'technical', 999999999, 'section_saved', $2)
  `, [workspaceId, actorId]));

  const technicalDraftRow = (await pool.query(`
    SELECT content_schema_snapshot, rendered_content
    FROM opportunity_technical_drafts WHERE id = $1
  `, [technicalDraftId])).rows[0];
  assert.deepEqual(technicalDraftRow.content_schema_snapshot, originalTemplateSnapshot);
  assert.ok(technicalDraftRow.rendered_content.sections.some((section) => section.key === projectSectionKey));
  const commercialDraftRow = (await pool.query(`
    SELECT variable_values FROM opportunity_commercial_drafts WHERE id = $1
  `, [commercialDraftId])).rows[0];
  assert.equal(Number(commercialDraftRow.variable_values.total_price), 175000);

  console.log('Bid Center Step 5 package editor integration checks passed.');
}

verify()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
