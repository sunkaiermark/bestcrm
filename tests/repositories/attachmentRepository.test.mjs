import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachmentRepository } from '../../src/repositories/attachmentRepository.mjs';

const sha256 = 'a'.repeat(64);

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

function attachmentRow(overrides = {}) {
  return {
    id: '55',
    opportunity_id: '30',
    category: 'commercial_quote',
    original_name: 'quote.xlsx',
    stored_path: '2026/06/quote.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    file_size: '2048',
    sha256,
    source_inquiry_attachment_id: '88',
    uploaded_by: '7',
    uploader_display_name: 'Sales One',
    uploaded_at: '2026-06-05T12:00:00.000Z',
    opportunity_material_version_id: '12',
    retired_at: null,
    retired_by: null,
    retirement_reason: null,
    replaced_by_attachment_id: null,
    ...overrides
  };
}

test('attachment repository creates hash-bound attachment metadata rows', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow({
    category: 'technical_solution',
    original_name: 'solution.pdf',
    stored_path: '2026/06/file.pdf',
    mime_type: 'application/pdf',
    file_size: '1024',
    opportunity_material_version_id: null
  })]);
  const repository = createAttachmentRepository(queryTarget);

  const attachment = await repository.createAttachment({
    opportunityId: 30,
    category: 'technical_solution',
    originalName: 'solution.pdf',
    storedPath: '2026/06/file.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    uploadedBy: 7,
    sourceInquiryAttachmentId: 88,
    sha256
  });

  assert.equal(attachment.id, 55);
  assert.equal(attachment.sha256, sha256);
  assert.equal(attachment.sourceInquiryAttachmentId, 88);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO attachments/);
  assert.match(queryTarget.queries[0].sql, /source_inquiry_attachment_id/);
  assert.match(queryTarget.queries[0].sql, /sha256/);
  assert.deepEqual(queryTarget.queries[0].params.slice(-2), [88, sha256]);
});

test('attachment repository lists only active opportunity attachments with lifecycle identity', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow()]);
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
    sha256,
    sourceInquiryAttachmentId: 88,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T12:00:00.000Z',
    opportunityMaterialVersionId: 12,
    retiredAt: null,
    retiredBy: null,
    retirementReason: '',
    replacedByAttachmentId: null
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM attachments a/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users uploader/);
  assert.match(queryTarget.queries[0].sql, /WHERE a\.opportunity_id = \$1[\s\S]*a\.retired_at IS NULL/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY a\.uploaded_at DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [30]);
});

test('attachment repository keeps retired rows available through opportunity history', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow({
    retired_at: '2026-09-20T10:00:00.000Z',
    retired_by: '9',
    retirement_reason: 'Superseded',
    replaced_by_attachment_id: '56'
  })]);
  const repository = createAttachmentRepository(queryTarget);

  const history = await repository.listHistoryByOpportunity(30);

  assert.equal(history[0].retiredBy, 9);
  assert.equal(history[0].replacedByAttachmentId, 56);
  assert.doesNotMatch(queryTarget.queries[0].sql, /a\.retired_at IS NULL/);
});

test('attachment repository normalizes mojibake Chinese attachment names', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow({
    original_name: 'å\x88©å°\x94å\x8C\x96å­¦å\x90«ç\x9B\x90åº\x9Fæ°´ç\x84\x9Aç\x83§ç³»ç»\x9Fæ\x8A\x80æ\x9C¯æ\x96¹æ¡\x88260608.pdf',
    source_inquiry_attachment_id: null,
    opportunity_material_version_id: null
  })]);
  const repository = createAttachmentRepository(queryTarget);

  const attachments = await repository.listByOpportunity(30);

  assert.equal(attachments[0].originalName, '利尔化学含盐废水焚烧系统技术方案260608.pdf');
});

test('attachment repository finds one active or retired attachment by id', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow({
    category: 'contract',
    original_name: 'contract.pdf',
    opportunity_material_version_id: null
  })]);
  const repository = createAttachmentRepository(queryTarget);

  const attachment = await repository.findById(55);

  assert.equal(attachment.id, 55);
  assert.equal(attachment.category, 'contract');
  assert.equal(attachment.opportunityMaterialVersionId, null);
  assert.match(queryTarget.queries[0].sql, /WHERE a\.id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [55]);
});

test('attachment repository binds only active unbound category attachments to a material version', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '55' }, { id: '56' }]);
  const repository = createAttachmentRepository(queryTarget);

  const attachmentIds = await repository.bindUnboundToMaterialVersion({
    opportunityId: 30,
    category: 'technical_solution',
    opportunityMaterialVersionId: 12
  });

  assert.deepEqual(attachmentIds, [55, 56]);
  assert.match(queryTarget.queries[0].sql, /opportunity_material_version_id = \$3/);
  assert.match(queryTarget.queries[0].sql, /opportunity_material_version_id IS NULL/);
  assert.match(queryTarget.queries[0].sql, /retired_at IS NULL/);
});

test('attachment repository retires an active row in one transition and has no hard-delete API', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow({
    retired_at: '2026-09-20T10:00:00.000Z',
    retired_by: '9',
    retirement_reason: 'Removed from active view'
  })]);
  const repository = createAttachmentRepository(queryTarget);

  const retired = await repository.retireById({
    id: 55,
    actorUserId: 9,
    reason: 'Removed from active view'
  });

  assert.equal(retired.retiredBy, 9);
  assert.equal(repository.deleteById, undefined);
  assert.match(queryTarget.queries[0].sql, /UPDATE attachments/);
  assert.match(queryTarget.queries[0].sql, /WHERE id = \$1[\s\S]*retired_at IS NULL/);
  assert.match(queryTarget.queries[0].sql, /RETURNING/);
  assert.deepEqual(queryTarget.queries[0].params, [55, 9, 'Removed from active view', null]);
});

test('attachment replacement inserts and retires in one data-modifying statement', async () => {
  const queryTarget = createFakeQueryTarget([attachmentRow({ id: '56', source_inquiry_attachment_id: null })]);
  const repository = createAttachmentRepository(queryTarget);

  const replacement = await repository.replaceAttachment({
    originalAttachmentId: 55,
    actorUserId: 9,
    reason: 'Corrected commercial file',
    replacement: {
      opportunityId: 30,
      category: 'commercial_quote',
      originalName: 'quote-v2.xlsx',
      storedPath: '2026/09/quote-v2.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 3072,
      uploadedBy: 9,
      sourceInquiryAttachmentId: null,
      sha256: 'b'.repeat(64)
    }
  });

  assert.equal(replacement.id, 56);
  assert.equal(queryTarget.queries.length, 1);
  assert.match(queryTarget.queries[0].sql, /WITH original AS/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO attachments/);
  assert.match(queryTarget.queries[0].sql, /UPDATE attachments/);
  assert.match(queryTarget.queries[0].sql, /replaced_by_attachment_id/);
  assert.match(queryTarget.queries[0].sql, /RETURNING/);
});
