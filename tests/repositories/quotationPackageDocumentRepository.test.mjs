import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationPackageDocumentRepository } from '../../src/repositories/quotationPackageDocumentRepository.mjs';

function target(responses = []) {
  return { queries: [], async query(sql, params) { this.queries.push({ sql, params }); return responses.shift() || { rows: [] }; } };
}

const row = {
  id: '1', quotation_package_version_id: '60', workspace_id: '40', technical_solution_version_id: '41',
  commercial_draft_id: '42', output_profile_id: '5', output_profile_revision_no: '2',
  document_type: 'complete_pdf', document_no: 'QP-V1', original_name: 'bid.pdf', mime_type: 'application/pdf',
  content: Buffer.from('pdf'), byte_size: '3', sha256: 'a'.repeat(64), source_snapshot_sha256: 'b'.repeat(64),
  generation_key: 'c'.repeat(64), generator_version: 'v1', generated_by: '9', generator_display_name: 'QE',
  generated_at: '2026-09-01', package_status: 'approved', opportunity_id: '20', salesperson_id: '7',
  sales_manager_id: '8', quotation_engineer_id: '9', technical_manager_id: '10', commercial_manager_id: '12'
};

test('document repository lists metadata without bytes and downloads one protected byte payload', async () => {
  const db = target([{ rows: [row] }, { rows: [row] }]);
  const repository = createQuotationPackageDocumentRepository(db);
  const listed = await repository.listByWorkspace(40);
  const downloaded = await repository.findById(1);
  assert.equal('content' in listed[0], false);
  assert.equal(downloaded.content.toString(), 'pdf');
  assert.match(db.queries[0].sql, /WHERE document\.workspace_id = \$1/);
  assert.match(db.queries[1].sql, /document\.content/);
});

test('document repository persists each output with frozen identity in the caller transaction', async () => {
  const db = target([{ rows: [row] }, { rows: [row] }]);
  const repository = createQuotationPackageDocumentRepository(db);
  await repository.lockPackage(60);
  const result = await repository.createMany({
    quotationPackageVersionId: 60, workspaceId: 40, technicalSolutionVersionId: 41,
    commercialDraftId: 42, outputProfileId: 5, outputProfileRevisionNo: 2,
    sourceSnapshotSha256: 'b'.repeat(64), generationKey: 'c'.repeat(64), generatorVersion: 'v1', generatedBy: 9,
    documents: [{ documentType: 'complete_pdf', documentNo: 'QP-V1', originalName: 'bid.pdf',
      mimeType: 'application/pdf', content: Buffer.from('pdf'), byteSize: 3, sha256: 'a'.repeat(64) }]
  });
  assert.equal(result.length, 1);
  assert.match(db.queries[0].sql, /pg_advisory_xact_lock/);
  assert.match(db.queries[1].sql, /source_snapshot_sha256/);
  assert.equal(db.queries[1].params[14], 'c'.repeat(64));
});
