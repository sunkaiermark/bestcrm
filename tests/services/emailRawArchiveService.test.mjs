import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EmailRawIdentityConflictError,
  EmailRawMalwareError,
  EmailRawScanError,
  prepareEmailRawCapture
} from '../../src/services/emailRawArchiveService.mjs';

function cleanScanner(calls = []) {
  return {
    async scanFile(filePath, metadata) {
      calls.push({ filePath, metadata });
      return {
        engine: 'fake-clamav',
        engineVersion: '1.0',
        signatureVersion: 'test-1',
        verdict: 'clean',
        findingCode: '',
        safeDetail: '',
        startedAt: '2026-09-08T00:00:00.000Z',
        completedAt: '2026-09-08T00:00:01.000Z'
      };
    }
  };
}

function input(uploadDir, overrides = {}) {
  return {
    source: Buffer.from('From: buyer@example.com\r\nSubject: RFQ\r\n\r\nNeed quote'),
    uploadDir,
    mailboxKey: 'sales@sunkaier.com',
    providerName: 'imap',
    providerMailbox: 'INBOX',
    providerUidValidity: '44',
    providerUid: 7,
    maxBytes: 1024 * 1024,
    scanner: cleanScanner(),
    ...overrides
  };
}

test('raw email capture scans a restricted staging file before atomically committing immutable bytes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-email-'));
  const calls = [];
  try {
    const capture = await prepareEmailRawCapture(input(uploadDir, { scanner: cleanScanner(calls) }));
    assert.equal(calls.length, 1);
    assert.match(calls[0].filePath, /email-raw[\\/]\.staging/);
    await access(capture.stagingPath);

    const committed = await capture.commit({
      rfcMessageIdHint: 'rfq@example.com',
      sourceReceivedAt: '2026-09-08T00:00:00.000Z'
    });
    assert.match(committed.storedPath, /^email-raw\/[a-f0-9]{64}\/44\/7-[a-f0-9]{16}\.eml$/);
    assert.equal(await readFile(committed.absolutePath, 'utf8'), input(uploadDir).source.toString());
    assert.equal(await capture.verifyCommitted(), true);
    await assert.rejects(() => access(capture.stagingPath));
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw email capture rejects malware and scanner errors without committing evidence', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-reject-'));
  try {
    await assert.rejects(() => prepareEmailRawCapture(input(uploadDir, {
      scanner: { async scanFile() { return { verdict: 'malware', findingCode: 'Eicar-Test-Signature' }; } }
    })), EmailRawMalwareError);
    await assert.rejects(() => prepareEmailRawCapture(input(uploadDir, {
      scanner: { async scanFile() { throw new Error('daemon unavailable'); } }
    })), EmailRawScanError);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw email capture is idempotent but refuses an existing path with different bytes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-idempotent-'));
  try {
    const first = await prepareEmailRawCapture(input(uploadDir));
    const committed = await first.commit();
    const retry = await prepareEmailRawCapture(input(uploadDir));
    assert.equal((await retry.commit()).storedPath, committed.storedPath);

    await chmod(committed.absolutePath, 0o600).catch(() => {});
    await writeFile(committed.absolutePath, 'tampered');
    const conflict = await prepareEmailRawCapture(input(uploadDir));
    await assert.rejects(() => conflict.commit(), EmailRawIdentityConflictError);
    await conflict.discard();
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw email capture validates identity, size, and scanner availability before archiving', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-validation-'));
  try {
    await assert.rejects(() => prepareEmailRawCapture(input(uploadDir, { providerUid: 0 })), /positive integer/);
    await assert.rejects(() => prepareEmailRawCapture(input(uploadDir, { maxBytes: 2 })), /exceeds configured limit/);
    await assert.rejects(() => prepareEmailRawCapture(input(uploadDir, { scanner: null })), EmailRawScanError);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
