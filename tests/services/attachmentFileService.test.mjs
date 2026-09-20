import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  copyStoredAttachmentFile,
  inspectStoredAttachmentFile,
  storeAttachmentBuffer
} from '../../src/services/attachmentFileService.mjs';

test('inspectStoredAttachmentFile returns final byte size and sha256', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-file-'));
  const content = Buffer.from('attachment-evidence');
  try {
    const stored = await storeAttachmentBuffer({ uploadDir, originalName: 'a.pdf', content });
    const sha256 = createHash('sha256').update(content).digest('hex');

    assert.equal(stored.fileSize, content.length);
    assert.equal(stored.sha256, sha256);
    assert.deepEqual(await inspectStoredAttachmentFile({
      uploadDir,
      storedPath: stored.storedPath
    }), {
      absolutePath: stored.absolutePath,
      fileSize: content.length,
      sha256
    });
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('copyStoredAttachmentFile hashes the final copied bytes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-copy-'));
  const content = Buffer.from('copy-evidence');
  try {
    const source = await storeAttachmentBuffer({ uploadDir, originalName: 'source.txt', content });
    const copied = await copyStoredAttachmentFile({
      uploadDir,
      storedPath: source.storedPath,
      originalName: 'copy.txt',
      prefix: 'inquiry-copies'
    });

    assert.notEqual(copied.storedPath, source.storedPath);
    assert.equal(copied.fileSize, content.length);
    assert.equal(copied.sha256, source.sha256);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('inspectStoredAttachmentFile rejects unsafe, missing, and non-file paths', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-inspect-'));
  try {
    await assert.rejects(
      inspectStoredAttachmentFile({ uploadDir, storedPath: '../outside.txt' }),
      (error) => error.code === 'invalid_stored_path'
    );
    await assert.rejects(
      inspectStoredAttachmentFile({ uploadDir, storedPath: path.resolve(uploadDir, 'absolute.txt') }),
      (error) => error.code === 'invalid_stored_path'
    );
    await assert.rejects(
      inspectStoredAttachmentFile({ uploadDir, storedPath: 'missing.txt' }),
      (error) => error.code === 'ENOENT'
    );

    await mkdir(path.join(uploadDir, 'folder'));
    await assert.rejects(
      inspectStoredAttachmentFile({ uploadDir, storedPath: 'folder' }),
      (error) => error.code === 'not_a_file'
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
