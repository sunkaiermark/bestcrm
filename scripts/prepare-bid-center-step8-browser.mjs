import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ROLES } from '../src/domain/roles.mjs';
import { createOpportunityResponsibilityRepository } from '../src/repositories/opportunityResponsibilityRepository.mjs';
import { hashPassword } from '../src/services/authService.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Unsafe Bid Center browser database name');
}

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './var/uploads');
const pool = new pg.Pool({ connectionString: databaseUrl });
const password = 'Step8Browser123!';

async function ensureUser(username, displayName, roleCode) {
  const passwordHash = await hashPassword(password);
  const result = await pool.query(`
    INSERT INTO users (username, password_hash, display_name, email, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (username) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      is_active = true
    RETURNING id
  `, [username, passwordHash, displayName, `${username}@example.invalid`]);
  const id = Number(result.rows[0].id);
  await pool.query(`
    UPDATE users
    SET email_signature_name = $2, email_signature_title = $3
    WHERE id = $1
  `, [id, displayName, roleCode.replaceAll('_', ' ')]);
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, id FROM roles WHERE code = $2
    ON CONFLICT DO NOTHING
  `, [id, roleCode]);
  return { id, username, displayName, roles: [roleCode] };
}

async function ensureApprovedQuote(opportunityId, actorUserId) {
  const existing = await pool.query(`
    SELECT id FROM commercial_quotes
    WHERE opportunity_id = $1 AND status = 'approved'
    ORDER BY version_no DESC LIMIT 1
  `, [opportunityId]);
  if (existing.rows[0]) return Number(existing.rows[0].id);
  const inserted = await pool.query(`
    INSERT INTO commercial_quotes (
      opportunity_id, total_price, payment_terms, validity_date, remarks,
      submitted_by, version_no, status, reviewed_by, reviewed_at
    ) VALUES ($1, 125000, '30/70', DATE '2026-12-31',
      'Step 8 browser-only approved quote', $2, 1, 'approved', $3, now())
    RETURNING id
  `, [opportunityId, actorUserId, actorUserId]);
  return Number(inserted.rows[0].id);
}

async function ensureControlledAttachment() {
  const content = Buffer.from('Step7 attachment', 'utf8');
  const expected = createHash('sha256').update(content).digest('hex');
  const revision = await pool.query(`
    SELECT attachment_sha256
    FROM bid_content_block_revisions
    WHERE attachment_stored_path = 'bid-content/step4/payment.pdf'
    LIMIT 1
  `);
  assert.equal(revision.rows[0]?.attachment_sha256, expected);
  const target = path.join(uploadDir, 'bid-content', 'step4', 'payment.pdf');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return { storedPath: 'bid-content/step4/payment.pdf', sha256: expected };
}

async function prepare() {
  const opportunity = (await pool.query(`
    SELECT id, opportunity_no
    FROM opportunities
    WHERE opportunity_no = 'STEP4-ROLLBACK'
    LIMIT 1
  `)).rows[0];
  assert.ok(opportunity, 'Run verify-bid-workspaces.mjs first');
  const [lead, technicalManager, commercialManager, salesManager, supportingEngineer, outsider] = await Promise.all([
    ensureUser('step8-browser-lead', 'Step 8 Project Lead', ROLES.QUOTATION_ENGINEER),
    ensureUser('step8-browser-technical', 'Step 8 Technical Manager', ROLES.TECHNICAL_MANAGER),
    ensureUser('step8-browser-commercial', 'Step 8 Commercial Manager', ROLES.COMMERCIAL_MANAGER),
    ensureUser('step8-browser-sales', 'Step 8 Sales Manager', ROLES.SALES_MANAGER),
    ensureUser('step8-browser-support', 'Step 8 Supporting Engineer', ROLES.QUOTATION_ENGINEER),
    ensureUser('step8-browser-outsider', 'Step 8 Unauthorized Salesperson', ROLES.SALESPERSON)
  ]);
  await pool.query(`
    UPDATE opportunities SET
      salesperson_id = $2,
      quotation_engineer_id = $2,
      technical_manager_id = $3,
      commercial_manager_id = $4,
      sales_manager_id = $5
    WHERE id = $1
  `, [opportunity.id, lead.id, technicalManager.id, commercialManager.id, salesManager.id]);
  const responsibilityRepository = createOpportunityResponsibilityRepository(pool);
  await responsibilityRepository.addTeamMember({
    opportunityId: Number(opportunity.id),
    userId: supportingEngineer.id,
    roleCode: ROLES.QUOTATION_ENGINEER,
    permissionLevel: 'edit',
    assignmentScope: 'Assigned technical package sections only',
    taskDescription: 'Step 8 browser acceptance collaboration',
    dueDate: '2026-09-30',
    canSendExternalEmail: false,
    addedBy: lead.id
  });
  const quoteId = await ensureApprovedQuote(Number(opportunity.id), lead.id);
  const attachment = await ensureControlledAttachment();
  const workspace = (await pool.query(`
    SELECT id FROM opportunity_bid_workspaces WHERE opportunity_id = $1
  `, [opportunity.id])).rows[0];
  return {
    opportunityId: Number(opportunity.id),
    opportunityNo: opportunity.opportunity_no,
    workspaceId: workspace ? Number(workspace.id) : null,
    approvedQuoteId: quoteId,
    password,
    uploadDir,
    attachment,
    users: { lead, technicalManager, commercialManager, salesManager, supportingEngineer, outsider }
  };
}

prepare()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
