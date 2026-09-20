import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  persistUploadedOpportunityAttachment,
  replaceOpportunityAttachment,
  retireOpportunityAttachment
} from '../../src/services/attachmentIntegrityService.mjs';

test('persistUploadedOpportunityAttachment records final disk size and hash', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-opportunity-upload-'));
  const directory = path.join(uploadDir, '2026', '09');
  const filePath = path.join(directory, 'proposal.pdf');
  const content = Buffer.from('final proposal bytes');
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, content);
  let createdInput = null;
  try {
    const record = await persistUploadedOpportunityAttachment({
      attachmentRepository: {
        async createAttachment(input) {
          createdInput = input;
          return { id: 55, ...input };
        }
      },
      uploadDir,
      file: {
        path: filePath,
        originalname: 'proposal.pdf',
        mimetype: 'application/pdf',
        size: 1
      },
      opportunityId: 30,
      category: 'technical_solution',
      actorUserId: 7,
      sourceInquiryAttachmentId: 91
    });

    assert.equal(record.id, 55);
    assert.equal(createdInput.fileSize, content.length);
    assert.equal(createdInput.sha256, createHash('sha256').update(content).digest('hex'));
    assert.equal(createdInput.sourceInquiryAttachmentId, 91);
    assert.equal(existsSync(filePath), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('failed opportunity metadata insert removes only the newly uploaded file', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-opportunity-upload-fail-'));
  const directory = path.join(uploadDir, '2026', '09');
  const filePath = path.join(directory, 'new.pdf');
  const existingPath = path.join(uploadDir, 'existing.pdf');
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, 'new bytes');
  await writeFile(existingPath, 'existing evidence');
  try {
    await assert.rejects(() => persistUploadedOpportunityAttachment({
      attachmentRepository: {
        async createAttachment() {
          throw new Error('database unavailable');
        }
      },
      uploadDir,
      file: { path: filePath, originalname: 'new.pdf', mimetype: 'application/pdf' },
      opportunityId: 30,
      category: 'requirement',
      actorUserId: 7
    }), /database unavailable/);

    assert.equal(existsSync(filePath), false);
    assert.equal(existsSync(existingPath), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('retireOpportunityAttachment forwards the actor and rejects repeated retirement', async () => {
  const calls = [];
  const attachmentRepository = {
    async retireById(input) {
      calls.push(input);
      return calls.length === 1 ? { id: 55, retiredAt: '2026-09-20T12:00:00Z' } : null;
    }
  };

  const retired = await retireOpportunityAttachment({
    attachmentRepository,
    attachmentId: 55,
    actorUserId: 7,
    reason: 'Removed from active view'
  });
  assert.equal(retired.id, 55);
  await assert.rejects(() => retireOpportunityAttachment({
    attachmentRepository,
    attachmentId: 55,
    actorUserId: 7,
    reason: 'Again'
  }), /already retired/);
});

test('replaceOpportunityAttachment sends one verified replacement payload to the atomic repository API', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-opportunity-replace-'));
  const filePath = path.join(uploadDir, 'replacement.pdf');
  const content = Buffer.from('replacement bytes');
  await writeFile(filePath, content);
  let replaceInput = null;
  try {
    const replaced = await replaceOpportunityAttachment({
      attachmentRepository: {
        async replaceAttachment(input) {
          replaceInput = input;
          return { id: 56, ...input.replacement };
        }
      },
      uploadDir,
      file: { path: filePath, originalname: 'replacement.pdf', mimetype: 'application/pdf' },
      originalAttachment: { id: 55, opportunityId: 30, category: 'commercial_quote' },
      actorUserId: 9,
      reason: 'Corrected file'
    });

    assert.equal(replaced.id, 56);
    assert.equal(replaceInput.originalAttachmentId, 55);
    assert.equal(replaceInput.replacement.opportunityId, 30);
    assert.equal(replaceInput.replacement.category, 'commercial_quote');
    assert.equal(replaceInput.replacement.fileSize, content.length);
    assert.equal(replaceInput.replacement.sha256, createHash('sha256').update(content).digest('hex'));
    assert.equal(existsSync(filePath), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('failed atomic replacement removes only the newly uploaded replacement file', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-opportunity-replace-fail-'));
  const replacementPath = path.join(uploadDir, 'replacement.pdf');
  const originalPath = path.join(uploadDir, 'original.pdf');
  await writeFile(replacementPath, 'replacement bytes');
  await writeFile(originalPath, 'original evidence');
  try {
    await assert.rejects(() => replaceOpportunityAttachment({
      attachmentRepository: {
        async replaceAttachment() { throw new Error('atomic replacement failed'); }
      },
      uploadDir,
      file: { path: replacementPath, originalname: 'replacement.pdf', mimetype: 'application/pdf' },
      originalAttachment: { id: 55, opportunityId: 30, category: 'commercial_quote' },
      actorUserId: 9,
      reason: 'Corrected file'
    }), /atomic replacement failed/);

    assert.equal(existsSync(replacementPath), false);
    assert.equal(existsSync(originalPath), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
