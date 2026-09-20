import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EmailOutboundMimeIdentityConflictError,
  prepareOutboundMimeArtifact
} from '../../src/services/emailOutboundMimeService.mjs';

function createRepository() {
  let artifact = null;
  let createCalls = 0;
  return {
    get createCalls() { return createCalls; },
    async findOutboundMimeArtifact(messageId) {
      return Number(messageId) === Number(artifact?.messageId) ? artifact : null;
    },
    async createOutboundMimeArtifact(input) {
      createCalls += 1;
      if (!artifact) artifact = { id: 1, createdAt: '2026-09-20T00:00:00.000Z', ...input };
      return artifact;
    }
  };
}

test('outbound MIME is stored as exact immutable bytes and a retry reuses the committed artifact', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-outbound-mime-'));
  const repository = createRepository();
  const rawMime = Buffer.from([
    'Message-ID: <m22@sunkaier.com>',
    'From: sales@sunkaier.com',
    'To: buyer@example.com',
    '',
    'Body'
  ].join('\r\n'));
  try {
    const first = await prepareOutboundMimeArtifact({
      message: { id: 22, messageId: '<m22@sunkaier.com>' },
      rawMime,
      uploadDir,
      emailArchiveRepository: repository
    });

    const expectedSha256 = createHash('sha256').update(rawMime).digest('hex');
    assert.equal(first.sha256, expectedSha256);
    assert.equal(first.fileSize, rawMime.length);
    assert.match(first.storedPath, /^email-outbound\/[0-9a-f]{64}\/[0-9a-f]{16}\.eml$/);
    assert.deepEqual(await readFile(first.absolutePath), rawMime);
    assert.deepEqual(first.rawMime, rawMime);
    assert.deepEqual(await readdir(path.join(uploadDir, 'email-outbound', '.staging')), []);
    assert.equal(repository.createCalls, 1);

    const retry = await prepareOutboundMimeArtifact({
      message: { id: 22, messageId: '<m22@sunkaier.com>' },
      uploadDir,
      emailArchiveRepository: repository
    });
    assert.equal(retry.storedPath, first.storedPath);
    assert.deepEqual(retry.rawMime, rawMime);
    assert.equal(repository.createCalls, 1);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('outbound MIME verification fails closed when committed evidence is tampered with', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-outbound-mime-'));
  const repository = createRepository();
  const rawMime = Buffer.from('Message-ID: <m23@sunkaier.com>\r\n\r\nOriginal');
  try {
    const first = await prepareOutboundMimeArtifact({
      message: { id: 23, messageId: '<m23@sunkaier.com>' },
      rawMime,
      uploadDir,
      emailArchiveRepository: repository
    });
    await writeFile(first.absolutePath, Buffer.alloc(rawMime.length, 88));

    await assert.rejects(() => prepareOutboundMimeArtifact({
      message: { id: 23, messageId: '<m23@sunkaier.com>' },
      uploadDir,
      emailArchiveRepository: repository
    }), (error) => {
      assert.equal(error instanceof EmailOutboundMimeIdentityConflictError, true);
      assert.match(error.message, /SHA-256/);
      return true;
    });
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('outbound MIME identity rejects a database artifact for another RFC Message-ID', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-outbound-mime-'));
  const rawMime = Buffer.from('Message-ID: <wrong@sunkaier.com>\r\n\r\nBody');
  const sha256 = createHash('sha256').update(rawMime).digest('hex');
  const messageHash = createHash('sha256').update('<m24@sunkaier.com>').digest('hex');
  const storedPath = `email-outbound/${messageHash}/${sha256.slice(0, 16)}.eml`;
  const repository = {
    async findOutboundMimeArtifact() {
      return {
        id: 2,
        messageId: 24,
        storedPath,
        fileSize: rawMime.length,
        sha256,
        rfcMessageId: '<wrong@sunkaier.com>'
      };
    }
  };
  try {
    await assert.rejects(() => prepareOutboundMimeArtifact({
      message: { id: 24, messageId: '<m24@sunkaier.com>' },
      uploadDir,
      emailArchiveRepository: repository
    }), /RFC Message-ID/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
