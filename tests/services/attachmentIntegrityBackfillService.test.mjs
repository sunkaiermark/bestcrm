import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backfillLegacyAttachmentHashes } from '../../src/services/attachmentIntegrityBackfillService.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function candidate(overrides = {}) {
  return {
    model: 'opportunity_attachment',
    id: 1,
    storedPath: '2026/09/legacy.pdf',
    fileSize: 6,
    ...overrides
  };
}

function pagedRepository(rows, updateResult = true) {
  const listCalls = [];
  const updates = [];
  return {
    listCalls,
    updates,
    async listLegacyAttachmentHashCandidates({ afterModel = '', afterId = 0, limit }) {
      listCalls.push({ afterModel, afterId, limit });
      return rows
        .filter((row) => row.model > afterModel || (row.model === afterModel && row.id > afterId))
        .sort((left, right) => left.model.localeCompare(right.model) || left.id - right.id)
        .slice(0, limit);
    },
    async backfillAttachmentHash(input) {
      updates.push(input);
      return typeof updateResult === 'function' ? updateResult(input) : updateResult;
    }
  };
}

test('legacy hash backfill defaults to dry-run and computes final-byte digest without writing', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-backfill-dry-'));
  const absolutePath = path.join(uploadDir, '2026', '09', 'legacy.pdf');
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, 'legacy');
  const repository = pagedRepository([candidate()]);
  try {
    const result = await backfillLegacyAttachmentHashes({ repository, uploadDir });
    assert.deepEqual(result, {
      mode: 'dry-run', scanned: 1, eligible: 1, updated: 0, refused: 0, batches: 1, failures: []
    });
    assert.deepEqual(repository.updates, []);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('legacy hash backfill apply writes only a verified unchanged identity', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-backfill-apply-'));
  const absolutePath = path.join(uploadDir, 'email-inquiries', 'legacy.pdf');
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, 'legacy');
  const repository = pagedRepository([candidate({ model: 'inquiry_attachment', storedPath: 'email-inquiries/legacy.pdf' })]);
  try {
    const result = await backfillLegacyAttachmentHashes({ repository, uploadDir, apply: true });
    assert.equal(result.updated, 1);
    assert.deepEqual(repository.updates, [{
      model: 'inquiry_attachment',
      id: 1,
      expectedStoredPath: 'email-inquiries/legacy.pdf',
      expectedFileSize: 6,
      sha256: sha256('legacy')
    }]);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('legacy hash backfill refuses unsafe, missing, size-mismatched, and concurrently changed rows', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-backfill-refuse-'));
  await mkdir(path.join(uploadDir, '2026', '09'), { recursive: true });
  await writeFile(path.join(uploadDir, '2026', '09', 'wrong-size.pdf'), 'small');
  await writeFile(path.join(uploadDir, '2026', '09', 'changed.pdf'), 'same');
  const rows = [
    candidate({ id: 1, storedPath: '../unsafe.pdf', fileSize: 1 }),
    candidate({ id: 2, storedPath: '2026/09/missing.pdf', fileSize: 1 }),
    candidate({ id: 3, storedPath: '2026/09/wrong-size.pdf', fileSize: 99 }),
    candidate({ id: 4, storedPath: '2026/09/changed.pdf', fileSize: 4 })
  ];
  const repository = pagedRepository(rows, (input) => input.id !== 4);
  try {
    const result = await backfillLegacyAttachmentHashes({ repository, uploadDir, apply: true, batchSize: 2 });
    assert.equal(result.scanned, 4);
    assert.equal(result.updated, 0);
    assert.equal(result.refused, 4);
    assert.deepEqual(result.failures.map((failure) => failure.reason), [
      'invalid_stored_path', 'missing_file', 'file_size_mismatch', 'identity_changed'
    ]);
    assert.ok(repository.listCalls.length >= 2);
    assert.ok(repository.listCalls.every((call) => call.limit === 2));
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('legacy hash backfill is idempotent when no unverified rows remain', async () => {
  const repository = pagedRepository([]);
  assert.deepEqual(await backfillLegacyAttachmentHashes({ repository, uploadDir: '.', apply: true }), {
    mode: 'apply', scanned: 0, eligible: 0, updated: 0, refused: 0, batches: 0, failures: []
  });
});
