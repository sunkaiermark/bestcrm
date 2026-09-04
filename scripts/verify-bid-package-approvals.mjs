import assert from 'node:assert/strict';
import pg from 'pg';
import { createWorkflowTransaction } from '../src/db/workflowTransaction.mjs';
import { ROLES } from '../src/domain/roles.mjs';
import { createBidContentBlockRepository } from '../src/repositories/bidContentBlockRepository.mjs';
import { createBidPackageApprovalRepository } from '../src/repositories/bidPackageApprovalRepository.mjs';
import { createBidPackageEditorRepository } from '../src/repositories/bidPackageEditorRepository.mjs';
import { createBidWorkspaceRepository } from '../src/repositories/bidWorkspaceRepository.mjs';
import { createOpportunityCommercialDraftRepository } from '../src/repositories/opportunityCommercialDraftRepository.mjs';
import { createOpportunityResponsibilityRepository } from '../src/repositories/opportunityResponsibilityRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from '../src/repositories/opportunityTechnicalDraftRepository.mjs';
import { createQuotationPackageRepository } from '../src/repositories/quotationPackageRepository.mjs';
import { createTechnicalTemplateRepository } from '../src/repositories/technicalTemplateRepository.mjs';
import { createTodoRepository } from '../src/repositories/todoRepository.mjs';
import { createWorkflowEventRepository } from '../src/repositories/workflowEventRepository.mjs';
import { hashPassword } from '../src/services/authService.mjs';
import { createBidPackageApprovalService } from '../src/services/bidPackageApprovalService.mjs';
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

async function ensureUser(username, displayName, roleCode) {
  const passwordHash = await hashPassword('Step6-Test-Only!');
  const result = await pool.query(`
    INSERT INTO users (username, password_hash, display_name, is_active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, is_active = true
    RETURNING id
  `, [username, passwordHash, displayName]);
  const id = Number(result.rows[0].id);
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, id FROM roles WHERE code = $2
    ON CONFLICT DO NOTHING
  `, [id, roleCode]);
  return { id, username, displayName, roles: [roleCode] };
}

async function verify() {
  const workspaceRow = (await pool.query(`
    SELECT workspace.id, workspace.opportunity_id
    FROM opportunity_bid_workspaces workspace
    JOIN opportunities opportunity ON opportunity.id = workspace.opportunity_id
    WHERE opportunity.opportunity_no = 'STEP4-PRIMARY'
    LIMIT 1
  `)).rows[0];
  assert.ok(workspaceRow, 'Run Step 4 and Step 5 verification scripts first');
  const workspaceId = Number(workspaceRow.id);
  const opportunityId = Number(workspaceRow.opportunity_id);

  const [lead, technicalManager, commercialManager, salesManager, administrator] = await Promise.all([
    ensureUser('step6-lead', 'Step 6 Project Lead', ROLES.QUOTATION_ENGINEER),
    ensureUser('step6-technical-manager', 'Step 6 Technical Manager', ROLES.TECHNICAL_MANAGER),
    ensureUser('step6-commercial-manager', 'Step 6 Commercial Manager', ROLES.COMMERCIAL_MANAGER),
    ensureUser('step6-sales-manager', 'Step 6 Sales Manager', ROLES.SALES_MANAGER),
    ensureUser('step6-administrator', 'Step 6 Administrator', ROLES.ADMINISTRATOR)
  ]);
  await pool.query(`
    UPDATE opportunities
    SET quotation_engineer_id = $2, technical_manager_id = $3,
        commercial_manager_id = $4, sales_manager_id = $5
    WHERE id = $1
  `, [opportunityId, lead.id, technicalManager.id, commercialManager.id, salesManager.id]);

  const dependencies = {
    bidContentBlockRepository: createBidContentBlockRepository(pool),
    bidPackageApprovalRepository: createBidPackageApprovalRepository(pool),
    bidPackageEditorRepository: createBidPackageEditorRepository(pool),
    bidWorkspaceRepository: createBidWorkspaceRepository(pool),
    opportunityCommercialDraftRepository: createOpportunityCommercialDraftRepository(pool),
    opportunityResponsibilityRepository: createOpportunityResponsibilityRepository(pool),
    opportunityTechnicalDraftRepository: createOpportunityTechnicalDraftRepository(pool),
    quotationPackageRepository: createQuotationPackageRepository(pool),
    technicalTemplateRepository: createTechnicalTemplateRepository(pool),
    todoRepository: createTodoRepository(pool),
    workflowEventRepository: createWorkflowEventRepository(pool),
    workflowTransaction: createWorkflowTransaction(pool)
  };
  const editor = createBidPackageEditorService({ enabled: true, dependencies });
  const approval = createBidPackageApprovalService({ enabled: true, dependencies });

  await editor.saveVariables(lead, workspaceId, 'commercial', 'pricing', {
    total_price: '125000', reason: 'Restore exact approved quote total before Step 6 submission'
  });
  const initialCommercialCheck = await approval.checkPackage(lead, workspaceId, 'commercial');
  assert.equal(initialCommercialCheck.passed, true);

  await approval.submitPackage(lead, workspaceId, 'technical', { comment: 'Technical review cycle one' });
  await assert.rejects(
    () => approval.reviewPackage(administrator, workspaceId, 'technical', { decision: 'approve' }),
    (error) => error.statusCode === 403
  );
  const technicalReturn = await approval.reviewPackage(technicalManager, workspaceId, 'technical', {
    decision: 'reject', comment: 'Add reviewer-confirmed design basis'
  });
  assert.equal(technicalReturn.reviewed.status, 'rejected');
  assert.equal(technicalReturn.revision.draftLabel, 'TS-D2');
  await approval.submitPackage(lead, workspaceId, 'technical', { comment: 'Technical review cycle two' });
  const technicalApproval = await approval.reviewPackage(technicalManager, workspaceId, 'technical', {
    decision: 'approve', comment: 'Technical package approved'
  });
  assert.equal(technicalApproval.reviewed.formalVersionLabel, 'TS-V1');

  await approval.submitPackage(lead, workspaceId, 'commercial', { comment: 'Commercial review cycle one' });
  const commercialReturn = await approval.reviewPackage(commercialManager, workspaceId, 'commercial', {
    decision: 'reject', comment: 'Confirm commercial exception wording'
  });
  assert.equal(commercialReturn.reviewed.status, 'rejected');
  assert.equal(commercialReturn.revision.draftLabel, 'CP-D2');
  await approval.submitPackage(lead, workspaceId, 'commercial', { comment: 'Commercial review cycle two' });
  const commercialApproval = await approval.reviewPackage(commercialManager, workspaceId, 'commercial', {
    decision: 'approve', comment: 'Commercial package approved'
  });
  assert.equal(commercialApproval.reviewed.formalVersionLabel, 'CP-V1');

  const completeDraft = await approval.createCompleteDraft(lead, workspaceId, { currency: 'USD' });
  assert.equal(completeDraft.label, 'QP-D1');
  const completeCheck = await approval.checkComplete(lead, workspaceId, completeDraft.id);
  assert.equal(completeCheck.passed, true);
  await approval.submitComplete(lead, workspaceId, completeDraft.id, { comment: 'Complete bid review cycle one' });
  const completeReturn = await approval.reviewComplete(salesManager, workspaceId, completeDraft.id, {
    decision: 'reject', comment: 'Align final delivery wording'
  });
  assert.equal(completeReturn.reviewed.status, 'rejected');
  assert.equal(completeReturn.revision.label, 'QP-D2');
  assert.equal(completeReturn.revision.reviewSourcePackageId, completeDraft.id);
  await approval.submitComplete(lead, workspaceId, completeReturn.revision.id, {
    comment: 'Complete bid review cycle two'
  });
  const finalApproval = await approval.reviewComplete(salesManager, workspaceId, completeReturn.revision.id, {
    decision: 'approve', comment: 'Complete bid approved'
  });
  assert.equal(finalApproval.reviewed.label, 'QP-V1');

  const history = await approval.getDashboard(lead, workspaceId);
  assert.deepEqual(history.technicalVersions.slice(0, 2).map((item) => [item.draftLabel, item.status]), [
    ['TS-D2', 'approved'], ['TS-D1', 'rejected']
  ]);
  assert.deepEqual(history.commercialVersions.slice(0, 2).map((item) => [item.draftLabel, item.status]), [
    ['CP-D2', 'approved'], ['CP-D1', 'rejected']
  ]);
  assert.deepEqual(history.completeVersions.slice(0, 2).map((item) => [item.label, item.status]), [
    ['QP-V1', 'approved'], ['QP-D1', 'rejected']
  ]);

  const recipientRows = (await pool.query(`
    SELECT event_type, actor_user_id, target_user_id
    FROM workflow_events
    WHERE opportunity_id = $1 AND event_type LIKE '%_bid_%_package'
    ORDER BY id
  `, [opportunityId])).rows;
  assert.ok(recipientRows.some((row) => row.event_type === 'submit_bid_technical_package'
    && Number(row.target_user_id) === technicalManager.id));
  assert.ok(recipientRows.some((row) => row.event_type === 'submit_bid_commercial_package'
    && Number(row.target_user_id) === commercialManager.id));
  assert.ok(recipientRows.some((row) => row.event_type === 'submit_bid_complete_package'
    && Number(row.target_user_id) === salesManager.id));

  const pendingRevisionTodos = Number((await pool.query(`
    SELECT count(*) FROM todos
    WHERE opportunity_id = $1 AND status = 'pending' AND title LIKE 'Revise %'
  `, [opportunityId])).rows[0].count);
  assert.equal(pendingRevisionTodos, 0);

  const completenessId = Number((await pool.query(`
    SELECT id FROM bid_package_completeness_checks WHERE workspace_id = $1 ORDER BY id DESC LIMIT 1
  `, [workspaceId])).rows[0].id);
  await expectDatabaseError(/append-only/, () => pool.query(
    `UPDATE bid_package_completeness_checks SET passed = false WHERE id = $1`, [completenessId]
  ));
  await expectDatabaseError(/immutable|require approved technical solution/, () => pool.query(`
    UPDATE opportunity_commercial_drafts
    SET variable_values = jsonb_set(variable_values, '{total_price}', '1'::jsonb)
    WHERE id = $1
  `, [commercialApproval.reviewed.id]));
  await expectDatabaseError(/immutable|require approved technical solution/, () => pool.query(`
    UPDATE quotation_package_versions SET total_price = total_price + 1 WHERE id = $1
  `, [finalApproval.reviewed.id]));

  const summary = (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM bid_package_completeness_checks WHERE workspace_id = $1) AS checks,
      (SELECT count(*)::int FROM bid_package_events WHERE workspace_id = $1
        AND event_type IN ('submitted', 'approved', 'rejected', 'revision_created')) AS approval_events,
      (SELECT status FROM opportunity_bid_workspaces WHERE id = $1) AS workspace_status
  `, [workspaceId])).rows[0];
  assert.ok(summary.checks >= 7);
  assert.ok(summary.approval_events >= 15);
  assert.equal(summary.workspace_status, 'approved');
  console.log('Bid Center Step 6 approval and version integration checks passed.');
}

verify()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
