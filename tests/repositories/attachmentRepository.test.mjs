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
    uploaded_at: '2026-06-05T12:00:00.000Z',
    opportunity_material_version_id: '12'
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
    uploadedAt: '2026-06-05T12:00:00.000Z',
    opportunityMaterialVersionId: 12
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM attachments a/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users uploader/);
  assert.match(queryTarget.queries[0].sql, /WHERE a\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY a\.uploaded_at DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [30]);
});

test('attachment repository normalizes mojibake Chinese attachment names', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '55',
    opportunity_id: '30',
    category: 'commercial_quote',
    original_name: 'å\x88©å°\x94å\x8C\x96å­¦å\x90«ç\x9B\x90åº\x9Fæ°´ç\x84\x9Aç\x83§ç³»ç»\x9Fæ\x8A\x80æ\x9C¯æ\x96¹æ¡\x88260608.pdf',
    stored_path: '2026/06/quote.pdf',
    mime_type: 'application/pdf',
    file_size: '2048',
    uploaded_by: '7',
    uploader_display_name: 'Sales One',
    uploaded_at: '2026-06-05T12:00:00.000Z',
    opportunity_material_version_id: null
  }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachments = await repository.listByOpportunity(30);

  assert.equal(attachments[0].originalName, '利尔化学含盐废水焚烧系统技术方案260608.pdf');
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
    uploaded_at: '2026-06-05T12:00:00.000Z',
    opportunity_material_version_id: null
  }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachment = await repository.findById(55);

  assert.equal(attachment.id, 55);
  assert.equal(attachment.opportunityId, 30);
  assert.equal(attachment.category, 'contract');
  assert.equal(attachment.opportunityMaterialVersionId, null);
  assert.match(queryTarget.queries[0].sql, /WHERE a\.id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [55]);
});

test('attachment repository binds unbound category attachments to a material version', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '55' }, { id: '56' }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachmentIds = await repository.bindUnboundToMaterialVersion({
    opportunityId: 30,
    category: 'technical_solution',
    opportunityMaterialVersionId: 12
  });

  assert.deepEqual(attachmentIds, [55, 56]);
  assert.match(queryTarget.queries[0].sql, /UPDATE attachments/);
  assert.match(queryTarget.queries[0].sql, /opportunity_material_version_id = \$3/);
  assert.match(queryTarget.queries[0].sql, /opportunity_material_version_id IS NULL/);
  assert.deepEqual(queryTarget.queries[0].params, [30, 'technical_solution', 12]);
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
