import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachmentRepository } from '../../src/repositories/attachmentRepository.mjs';

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

test('attachment repository creates attachment metadata rows', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '55', uploaded_at: '2026-06-05T12:00:00.000Z' }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachment = await repository.createAttachment({
    opportunityId: 30,
    category: 'technical_solution',
    originalName: 'solution.pdf',
    storedPath: '2026/06/file.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    uploadedBy: 7
  });

  assert.equal(attachment.id, 55);
  assert.equal(attachment.opportunityId, 30);
  assert.equal(attachment.originalName, 'solution.pdf');
  assert.equal(attachment.uploadedAt, '2026-06-05T12:00:00.000Z');
  assert.match(queryTarget.queries[0].sql, /INSERT INTO attachments/);
  assert.deepEqual(queryTarget.queries[0].params, [
    30,
    'technical_solution',
    'solution.pdf',
    '2026/06/file.pdf',
    'application/pdf',
    1024,
    7
  ]);
});

test('attachment repository lists opportunity attachments with uploader names', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '55',
    opportunity_id: '30',
    category: 'commercial_quote',
    original_name: 'quote.xlsx',
    stored_path: '2026/06/quote.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size: '2048',
    uploaded_by: '7',
    uploader_display_name: 'Sales One',
    technical_solution_id: null,
    commercial_quote_id: '99',
    contract_approval_id: null,
    uploaded_at: '2026-06-05T12:00:00.000Z'
  }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachments = await repository.listByOpportunity(30);

  assert.deepEqual(attachments, [{
    id: 55,
    opportunityId: 30,
    category: 'commercial_quote',
    originalName: 'quote.xlsx',
    storedPath: '2026/06/quote.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    technicalSolutionId: null,
    commercialQuoteId: 99,
    contractApprovalId: null,
    uploadedAt: '2026-06-05T12:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM attachments a/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users uploader/);
  assert.match(queryTarget.queries[0].sql, /WHERE a\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY a\.uploaded_at DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [30]);
});

test('attachment repository finds one attachment by id', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '55',
    opportunity_id: '30',
    category: 'contract',
    original_name: 'contract.pdf',
    stored_path: '2026/06/contract.pdf',
    mime_type: 'application/pdf',
    file_size: '4096',
    uploaded_by: '7',
    uploader_display_name: 'Sales One',
    technical_solution_id: null,
    commercial_quote_id: null,
    contract_approval_id: '90',
    uploaded_at: '2026-06-05T12:00:00.000Z'
  }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachment = await repository.findById(55);

  assert.equal(attachment.id, 55);
  assert.equal(attachment.opportunityId, 30);
  assert.equal(attachment.category, 'contract');
  assert.equal(attachment.contractApprovalId, 90);
  assert.match(queryTarget.queries[0].sql, /WHERE a\.id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [55]);
});

test('attachment repository binds unlinked technical solution files to a version', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createAttachmentRepository(queryTarget);

  await repository.bindUnlinkedToTechnicalSolution({ opportunityId: 30, technicalSolutionId: 201 });

  assert.match(queryTarget.queries[0].sql, /UPDATE attachments/);
  assert.match(queryTarget.queries[0].sql, /SET technical_solution_id = \$2/);
  assert.match(queryTarget.queries[0].sql, /category = 'technical_solution'/);
  assert.match(queryTarget.queries[0].sql, /technical_solution_id IS NULL/);
  assert.deepEqual(queryTarget.queries[0].params, [30, 201]);
});

test('attachment repository binds unlinked commercial quote files to a version', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createAttachmentRepository(queryTarget);

  await repository.bindUnlinkedToCommercialQuote({ opportunityId: 30, commercialQuoteId: 200 });

  assert.match(queryTarget.queries[0].sql, /UPDATE attachments/);
  assert.match(queryTarget.queries[0].sql, /SET commercial_quote_id = \$2/);
  assert.match(queryTarget.queries[0].sql, /category = 'commercial_quote'/);
  assert.match(queryTarget.queries[0].sql, /commercial_quote_id IS NULL/);
  assert.deepEqual(queryTarget.queries[0].params, [30, 200]);
});

test('attachment repository binds unlinked contract files to a version', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createAttachmentRepository(queryTarget);

  await repository.bindUnlinkedToContractApproval({ opportunityId: 30, contractApprovalId: 90 });

  assert.match(queryTarget.queries[0].sql, /UPDATE attachments/);
  assert.match(queryTarget.queries[0].sql, /SET contract_approval_id = \$2/);
  assert.match(queryTarget.queries[0].sql, /category = 'contract'/);
  assert.match(queryTarget.queries[0].sql, /contract_approval_id IS NULL/);
  assert.deepEqual(queryTarget.queries[0].params, [30, 90]);
});

test('attachment repository deletes attachment metadata by id', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createAttachmentRepository(queryTarget);

  const result = await repository.deleteById(55);

  assert.equal(result.rowCount, 0);
  assert.match(queryTarget.queries[0].sql, /DELETE FROM attachments/);
  assert.match(queryTarget.queries[0].sql, /WHERE id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [55]);
});
