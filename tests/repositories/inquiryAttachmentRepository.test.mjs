import test from 'node:test';
import assert from 'node:assert/strict';
import { createInquiryAttachmentRepository } from '../../src/repositories/inquiryAttachmentRepository.mjs';

const sha256 = 'c'.repeat(64);

function fakeTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

function inquiryAttachmentRow(overrides = {}) {
  return {
    id: '91',
    inquiry_id: '27',
    source_index: '2',
    original_name: 'requirements.pdf',
    stored_path: 'email-inquiries/2026/09/requirements.pdf',
    mime_type: 'application/pdf',
    file_size: '4096',
    sha256,
    cid: 'attachment-2',
    uploaded_at: '2026-09-20T11:00:00.000Z',
    ...overrides
  };
}

test('inquiry attachment repository inserts and maps the stored-byte digest', async () => {
  const target = fakeTarget([inquiryAttachmentRow()]);
  const repository = createInquiryAttachmentRepository(target);

  const attachment = await repository.createAttachment({
    inquiryId: 27,
    sourceIndex: 2,
    originalName: 'requirements.pdf',
    storedPath: 'email-inquiries/2026/09/requirements.pdf',
    mimeType: 'application/pdf',
    fileSize: 4096,
    cid: 'attachment-2',
    sha256
  });

  assert.equal(attachment.sha256, sha256);
  assert.match(target.queries[0].sql, /INSERT INTO inquiry_attachments/);
  assert.match(target.queries[0].sql, /sha256/);
  assert.equal(target.queries[0].params.at(-1), sha256);
});

test('inquiry attachment selects retain sha256 for list and lookup', async () => {
  const target = fakeTarget([inquiryAttachmentRow()]);
  const repository = createInquiryAttachmentRepository(target);

  const listed = await repository.listByInquiry(27);
  const found = await repository.findById(91);

  assert.equal(listed[0].sha256, sha256);
  assert.equal(found.sha256, sha256);
  assert.match(target.queries[0].sql, /sha256/);
  assert.match(target.queries[1].sql, /sha256/);
});
