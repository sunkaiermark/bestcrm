import assert from 'node:assert/strict';
import pg from 'pg';
import { createWorkflowTransaction } from '../src/db/workflowTransaction.mjs';
import { ROLES } from '../src/domain/roles.mjs';
import { createBidContentBlockRepository } from '../src/repositories/bidContentBlockRepository.mjs';
import { createBidPackageEditorRepository } from '../src/repositories/bidPackageEditorRepository.mjs';
import { createBidWorkspaceRepository } from '../src/repositories/bidWorkspaceRepository.mjs';
import { createOpportunityCommercialDraftRepository } from '../src/repositories/opportunityCommercialDraftRepository.mjs';
import { createOpportunityResponsibilityRepository } from '../src/repositories/opportunityResponsibilityRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from '../src/repositories/opportunityTechnicalDraftRepository.mjs';
import { createTechnicalTemplateRepository } from '../src/repositories/technicalTemplateRepository.mjs';
import { hashPassword } from '../src/services/authService.mjs';
import { createBidPackageEditorService } from '../src/services/bidPackageEditorService.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) throw new Error('Unsafe browser fixture database name');
const pool = new pg.Pool({ connectionString: databaseUrl });

async function user(username, displayName, roleCode) {
  const passwordHash = await hashPassword('Step6Browser123!');
  const row = (await pool.query(`
    INSERT INTO users (username, password_hash, display_name, is_active)
    VALUES ($1, $2, $3, true) RETURNING id
  `, [username, passwordHash, displayName])).rows[0];
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, id FROM roles WHERE code = $2
  `, [row.id, roleCode]);
  return { id: Number(row.id), username, roles: [roleCode] };
}

try {
  const workspace = (await pool.query(`
    SELECT workspace.id, workspace.opportunity_id
    FROM opportunity_bid_workspaces workspace
    JOIN opportunities opportunity ON opportunity.id = workspace.opportunity_id
    WHERE opportunity.opportunity_no = 'STEP4-PRIMARY'
  `)).rows[0];
  assert.ok(workspace);
  const [lead, technicalManager, commercialManager, salesManager, administrator] = await Promise.all([
    user('step6-browser-lead', 'Browser Project Lead', ROLES.QUOTATION_ENGINEER),
    user('step6-browser-technical', 'Browser Technical Manager', ROLES.TECHNICAL_MANAGER),
    user('step6-browser-commercial', 'Browser Commercial Manager', ROLES.COMMERCIAL_MANAGER),
    user('step6-browser-sales', 'Browser Sales Manager', ROLES.SALES_MANAGER),
    user('step6-browser-admin', 'Browser Administrator', ROLES.ADMINISTRATOR)
  ]);
  await pool.query(`
    UPDATE opportunities SET quotation_engineer_id = $2, technical_manager_id = $3,
      commercial_manager_id = $4, sales_manager_id = $5 WHERE id = $1
  `, [workspace.opportunity_id, lead.id, technicalManager.id, commercialManager.id, salesManager.id]);
  const dependencies = {
    bidContentBlockRepository: createBidContentBlockRepository(pool),
    bidPackageEditorRepository: createBidPackageEditorRepository(pool),
    bidWorkspaceRepository: createBidWorkspaceRepository(pool),
    opportunityCommercialDraftRepository: createOpportunityCommercialDraftRepository(pool),
    opportunityResponsibilityRepository: createOpportunityResponsibilityRepository(pool),
    opportunityTechnicalDraftRepository: createOpportunityTechnicalDraftRepository(pool),
    technicalTemplateRepository: createTechnicalTemplateRepository(pool),
    workflowTransaction: createWorkflowTransaction(pool)
  };
  await createBidPackageEditorService({ enabled: true, dependencies }).saveVariables(
    lead, Number(workspace.id), 'commercial', 'pricing', {
      total_price: '125000', reason: 'Browser QA approved quote alignment'
    }
  );
  console.log(JSON.stringify({
    workspaceId: Number(workspace.id), opportunityId: Number(workspace.opportunity_id),
    password: 'Step6Browser123!', users: { lead, technicalManager, commercialManager, salesManager, administrator }
  }));
} finally {
  await pool.end();
}
