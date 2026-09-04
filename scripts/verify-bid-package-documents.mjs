import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import pg from 'pg';
import { createWorkflowTransaction } from '../src/db/workflowTransaction.mjs';
import { ROLES } from '../src/domain/roles.mjs';
import { createBidPackageApprovalRepository } from '../src/repositories/bidPackageApprovalRepository.mjs';
import { createBidPackageEditorRepository } from '../src/repositories/bidPackageEditorRepository.mjs';
import { createBidWorkspaceRepository } from '../src/repositories/bidWorkspaceRepository.mjs';
import { createOpportunityCommercialDraftRepository } from '../src/repositories/opportunityCommercialDraftRepository.mjs';
import { createOpportunityResponsibilityRepository } from '../src/repositories/opportunityResponsibilityRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from '../src/repositories/opportunityTechnicalDraftRepository.mjs';
import { createQuotationPackageDocumentRepository } from '../src/repositories/quotationPackageDocumentRepository.mjs';
import { createQuotationPackageRepository } from '../src/repositories/quotationPackageRepository.mjs';
import { createTodoRepository } from '../src/repositories/todoRepository.mjs';
import { createWorkflowEventRepository } from '../src/repositories/workflowEventRepository.mjs';
import { createBidPackageApprovalService } from '../src/services/bidPackageApprovalService.mjs';
import { createQuotationPackageDocumentService } from '../src/services/quotationPackageDocumentService.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) throw new Error('Unsafe Bid Center test database name');

const pool = new pg.Pool({ connectionString: databaseUrl });
const controlledAttachmentContent = Buffer.from('Step7 attachment', 'utf8');
const controlledAttachmentSha256 = createHash('sha256').update(controlledAttachmentContent).digest('hex');

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
  const packageRow = (await pool.query(`
    SELECT package.id, package.workspace_id, package.opportunity_id,
      opportunity.quotation_engineer_id
    FROM quotation_package_versions package
    JOIN opportunities opportunity ON opportunity.id = package.opportunity_id
    WHERE opportunity.opportunity_no = 'STEP4-PRIMARY'
      AND package.status = 'approved'
    ORDER BY package.version_no DESC LIMIT 1
  `)).rows[0];
  assert.ok(packageRow, 'Run the Step 4, 5, and 6 database checks first');
  const userRow = (await pool.query('SELECT username, display_name FROM users WHERE id = $1', [packageRow.quotation_engineer_id])).rows[0];
  const actor = {
    id: Number(packageRow.quotation_engineer_id), username: userRow.username,
    displayName: userRow.display_name, roles: [ROLES.QUOTATION_ENGINEER]
  };
  const dependencies = {
    bidPackageApprovalRepository: createBidPackageApprovalRepository(pool),
    bidPackageEditorRepository: createBidPackageEditorRepository(pool),
    bidWorkspaceRepository: createBidWorkspaceRepository(pool),
    opportunityCommercialDraftRepository: createOpportunityCommercialDraftRepository(pool),
    opportunityResponsibilityRepository: createOpportunityResponsibilityRepository(pool),
    opportunityTechnicalDraftRepository: createOpportunityTechnicalDraftRepository(pool),
    quotationPackageDocumentRepository: createQuotationPackageDocumentRepository(pool),
    quotationPackageRepository: createQuotationPackageRepository(pool),
    todoRepository: createTodoRepository(pool),
    workflowEventRepository: createWorkflowEventRepository(pool),
    workflowTransaction: createWorkflowTransaction(pool)
  };
  dependencies.bidPackageApprovalService = createBidPackageApprovalService({ enabled: true, dependencies });
  const service = createQuotationPackageDocumentService({
    enabled: true,
    dependencies,
    options: {
      fontPath: process.env.TECHNICAL_DOCUMENT_FONT_PATH || 'C:\\Windows\\Fonts\\simhei.ttf',
      logoPath: fileURLToPath(new URL('../src/public/assets/sunkaier-logo.png', import.meta.url)),
      async fileLoader(storedPath) {
        assert.equal(storedPath, 'bid-content/step4/payment.pdf');
        return controlledAttachmentContent;
      }
    }
  });

  const first = await service.generate(actor, Number(packageRow.workspace_id), Number(packageRow.id));
  const repeated = await service.generate(actor, Number(packageRow.workspace_id), Number(packageRow.id));
  assert.equal(first.length, 8);
  assert.deepEqual(first.map((item) => item.id), repeated.map((item) => item.id));

  const rows = (await pool.query(`
    SELECT id, document_type, document_no, original_name, mime_type, content,
      byte_size, sha256, source_snapshot_sha256, generation_key,
      output_profile_id, output_profile_revision_no, generator_version
    FROM quotation_package_documents
    WHERE quotation_package_version_id = $1 ORDER BY document_type
  `, [packageRow.id])).rows;
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map((row) => row.document_type)).size, 8);
  assert.equal(new Set(rows.map((row) => row.generation_key)).size, 1);
  assert.equal(new Set(rows.map((row) => row.source_snapshot_sha256)).size, 1);
  for (const row of rows) {
    assert.equal(Number(row.byte_size), row.content.length);
    assert.equal(row.sha256, createHash('sha256').update(row.content).digest('hex'));
    assert.ok(row.output_profile_revision_no > 0);
  }
  const manifestRow = rows.find((row) => row.document_type === 'manifest_json');
  const manifest = JSON.parse(manifestRow.content.toString('utf8'));
  assert.equal(manifest.files.length, 7);
  assert.equal(manifest.sourceSnapshotSha256, rows[0].source_snapshot_sha256);
  const zipRow = rows.find((row) => row.document_type === 'attachments_zip');
  const zip = await JSZip.loadAsync(zipRow.content);
  const innerManifest = JSON.parse(await zip.file('attachments-manifest.json').async('string'));
  assert.equal(innerManifest.files.length, 1);
  assert.equal(innerManifest.files[0].sha256, controlledAttachmentSha256);
  assert.ok(zip.file('Controlled/' + innerManifest.files[0].archiveName.split('/').at(-1)));

  const pdf = rows.find((row) => row.document_type === 'technical_pdf');
  const downloaded = await service.download(actor, Number(packageRow.workspace_id), Number(pdf.id));
  assert.equal(downloaded.sha256, pdf.sha256);
  const eventCounts = (await pool.query(`
    SELECT event_type, count(*)::int AS count FROM bid_package_events
    WHERE quotation_package_id = $1
      AND event_type IN ('generated_bid_package_outputs', 'downloaded_bid_output')
    GROUP BY event_type
  `, [packageRow.id])).rows;
  assert.equal(eventCounts.find((row) => row.event_type === 'generated_bid_package_outputs').count, 1);
  assert.equal(eventCounts.find((row) => row.event_type === 'downloaded_bid_output').count, 1);

  await expectDatabaseError(/immutable/, () => pool.query(
    'UPDATE quotation_package_documents SET original_name = $2 WHERE id = $1', [rows[0].id, 'changed.pdf']
  ));
  await expectDatabaseError(/immutable/, () => pool.query(
    'DELETE FROM quotation_package_documents WHERE id = $1', [rows[0].id]
  ));

  const atomicPackage = (await pool.query(`
    INSERT INTO quotation_package_versions (
      opportunity_id, draft_revision_no, version_no, status,
      technical_solution_version_id, commercial_quote_id, workspace_id, commercial_draft_id,
      currency, total_price, delivery_period, payment_terms, valid_until,
      commercial_line_items, inclusions, exclusions, technical_assumptions,
      created_by, submitted_by, submitted_at, reviewed_by, reviewed_at, review_comment, updated_by
    )
    SELECT source.opportunity_id,
      (SELECT max(draft_revision_no) + 1 FROM quotation_package_versions WHERE opportunity_id = source.opportunity_id),
      (SELECT max(version_no) + 1 FROM quotation_package_versions WHERE opportunity_id = source.opportunity_id),
      'approved', source.technical_solution_version_id, source.commercial_quote_id,
      source.workspace_id, source.commercial_draft_id, source.currency, source.total_price,
      source.delivery_period, source.payment_terms, source.valid_until,
      source.commercial_line_items, source.inclusions, source.exclusions, source.technical_assumptions,
      $2, $2, now(), source.reviewed_by, now(), 'Atomic rollback fixture', $2
    FROM quotation_package_versions source WHERE source.id = $1
    RETURNING id, version_no, technical_solution_version_id, commercial_draft_id, workspace_id
  `, [packageRow.id, actor.id])).rows[0];
  const documentRepository = createQuotationPackageDocumentRepository(pool);
  await expectDatabaseError(/size does not match|violates check constraint/, () => createWorkflowTransaction(pool)(async (repositories) => {
    await repositories.quotationPackageDocumentRepository.createMany({
      quotationPackageVersionId: Number(atomicPackage.id), workspaceId: Number(atomicPackage.workspace_id),
      technicalSolutionVersionId: Number(atomicPackage.technical_solution_version_id),
      commercialDraftId: Number(atomicPackage.commercial_draft_id),
      outputProfileId: Number(first[0].outputProfileId || rows[0].output_profile_id),
      outputProfileRevisionNo: Number(rows[0].output_profile_revision_no),
      sourceSnapshotSha256: 'd'.repeat(64), generationKey: 'e'.repeat(64),
      generatorVersion: 'atomic-test', generatedBy: actor.id,
      documents: [
        { documentType: 'complete_pdf', documentNo: `QP-V${atomicPackage.version_no}`,
          originalName: 'ok.pdf', mimeType: 'application/pdf', content: Buffer.from('ok'), byteSize: 2, sha256: createHash('sha256').update('ok').digest('hex') },
        { documentType: 'manifest_json', documentNo: `QP-V${atomicPackage.version_no}`,
          originalName: 'bad.json', mimeType: 'application/json', content: Buffer.from('{}'), byteSize: 99, sha256: createHash('sha256').update('{}').digest('hex') }
      ]
    });
  }));
  assert.equal((await documentRepository.listByPackage(Number(atomicPackage.id))).length, 0);
  console.log('Bid Center Step 7 document generation, persistence, ZIP, manifest, and rollback checks passed.');
}

verify().then(() => pool.end()).catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
