import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAttachmentBuffer } from '../../src/services/attachmentFileService.mjs';
import {
  copyInquiryAttachmentsToOpportunity,
  storeEmailInquiryAttachments
} from '../../src/services/emailInquiryAttachmentService.mjs';

test('email inquiry attachment storage persists the final file hash', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-inquiry-'));
  const content = Buffer.from('customer requirement');
  let createdInput = null;
  try {
    const result = await storeEmailInquiryAttachments({
      inquiryAttachmentRepository: {
        async listByInquiry() { return []; },
        async createAttachment(input) {
          createdInput = input;
          return { id: 91, ...input };
        }
      },
      inquiryId: 27,
      attachments: [{ filename: 'requirement.txt', contentType: 'text/plain', content }],
      uploadDir,
      maxUploadMb: 25
    });

    assert.equal(result.stored.length, 1);
    assert.equal(createdInput.sha256, createHash('sha256').update(content).digest('hex'));
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('inquiry conversion preserves source linkage and verifies the copied digest', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-copy-'));
  const source = await storeAttachmentBuffer({
    uploadDir,
    originalName: 'requirement.pdf',
    content: Buffer.from('verified inquiry bytes'),
    prefix: 'email-inquiries'
  });
  let createdInput = null;
  try {
    const copied = await copyInquiryAttachmentsToOpportunity({
      inquiryAttachmentRepository: {
        async listByInquiry() {
          return [{
            id: 91,
            storedPath: source.storedPath,
            originalName: 'requirement.pdf',
            mimeType: 'application/pdf',
            sha256: source.sha256
          }];
        }
      },
      attachmentRepository: {
        async createAttachment(input) {
          createdInput = input;
          return { id: 101, ...input };
        }
      },
      inquiryId: 27,
      opportunityId: 30,
      actor: { id: 7 },
      uploadDir
    });

    assert.equal(copied.length, 1);
    assert.equal(createdInput.sourceInquiryAttachmentId, 91);
    assert.equal(createdInput.sha256, source.sha256);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('inquiry conversion fails closed and removes a copy whose source digest does not match', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-copy-mismatch-'));
  const source = await storeAttachmentBuffer({
    uploadDir,
    originalName: 'requirement.pdf',
    content: Buffer.from('actual bytes'),
    prefix: 'email-inquiries'
  });
  let createCalled = false;
  try {
    await assert.rejects(() => copyInquiryAttachmentsToOpportunity({
      inquiryAttachmentRepository: {
        async listByInquiry() {
          return [{
            id: 91,
            storedPath: source.storedPath,
            originalName: 'requirement.pdf',
            mimeType: 'application/pdf',
            sha256: 'f'.repeat(64)
          }];
        }
      },
      attachmentRepository: {
        async createAttachment() { createCalled = true; }
      },
      inquiryId: 27,
      opportunityId: 30,
      actor: { id: 7 },
      uploadDir
    }), /digest does not match/);

    assert.equal(createCalled, false);
    const files = await readdir(uploadDir, { recursive: true });
    assert.equal(files.some((entry) => /converted-inquiries[\\/].+\.pdf$/i.test(String(entry))), false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
