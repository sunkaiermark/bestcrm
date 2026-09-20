import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditAttachmentIntegrity } from '../../src/services/attachmentIntegrityAuditService.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function record(overrides = {}) {
  return {
    model: 'opportunity_attachment',
    id: 1,
    storedPath: '2026/09/healthy.pdf',
    fileSize: 7,
    sha256: sha256('healthy'),
    retiredAt: null,
    retiredBy: null,
    retirementReason: '',
    replacedByAttachmentId: null,
    replacementValid: true,
    protectedBusinessHistory: false,
    purgeEligible: false,
    ...overrides
  };
}

test('attachment audit reports every identity, lifecycle, and restricted purge anomaly without mutation', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-audit-'));
  const files = new Map([
    ['2026/09/healthy.pdf', 'healthy'],
    ['email-inquiries/unverified.pdf', 'legacy'],
    ['lead-submissions/not-a-file', null],
    ['2026/09/wrong-size.pdf', 'size'],
    ['converted-inquiries/wrong-hash.pdf', 'hash'],
    ['email-inquiries/protected.pdf', 'protected'],
    ['lead-submissions/orphan.pdf', 'orphan'],
    ['email-archive/not-owned.eml', 'email'],
    ['misc/not-owned.bin', 'misc']
  ]);
  for (const [storedPath, content] of files) {
    const absolutePath = path.join(uploadDir, storedPath);
    if (content === null) {
      await mkdir(absolutePath, { recursive: true });
    } else {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content);
    }
  }
  const records = [
    record(),
    record({ model: 'inquiry_attachment', id: 2, storedPath: 'email-inquiries/unverified.pdf', fileSize: 6, sha256: null }),
    record({ id: 3, storedPath: '2026/09/missing.pdf', fileSize: 1, sha256: 'a'.repeat(64) }),
    record({ id: 4, storedPath: '../outside.pdf', fileSize: 1, sha256: 'a'.repeat(64) }),
    record({ id: 5, storedPath: 'lead-submissions/not-a-file', fileSize: 0, sha256: 'a'.repeat(64) }),
    record({ id: 6, storedPath: '2026/09/wrong-size.pdf', fileSize: 99, sha256: sha256('size') }),
    record({ id: 7, storedPath: 'converted-inquiries/wrong-hash.pdf', fileSize: 4, sha256: 'b'.repeat(64) }),
    record({ id: 8, storedPath: '2026/09/healthy.pdf', retiredAt: '2026-09-20', retiredBy: null, retirementReason: '', replacementValid: false }),
    record({ model: 'inquiry_attachment', id: 9, storedPath: 'email-inquiries/protected.pdf', fileSize: 9, sha256: sha256('protected'), protectedBusinessHistory: true, purgeEligible: true })
  ];
  let writes = 0;
  const repository = {
    async listAttachmentIntegrityRecords() { return records; },
    async listKnownAttachmentStoredPaths() {
      return [...records.map((item) => item.storedPath), 'email-archive/not-owned.eml'];
    },
    async update() { writes += 1; }
  };

  try {
    const result = await auditAttachmentIntegrity({ repository, uploadDir });
    const reasons = new Set(result.issues.map((issue) => issue.reason));
    assert.equal(result.ok, false);
    assert.deepEqual(result.totals, {
      records: 9,
      bytes: records.reduce((total, item) => total + item.fileSize, 0),
      verified: 8,
      unverified: 1
    });
    for (const reason of [
      'unverified', 'missing_file', 'invalid_stored_path', 'not_a_file',
      'file_size_mismatch', 'file_hash_mismatch', 'duplicate_stored_path',
      'invalid_lifecycle', 'protected_inquiry_purge_candidate'
    ]) assert.equal(reasons.has(reason), true, reason);
    assert.deepEqual(result.orphanCandidates, [{ storedPath: 'lead-submissions/orphan.pdf', size: 6 }]);
    assert.equal(writes, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('attachment audit returns a stable healthy result', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-audit-ok-'));
  await mkdir(path.join(uploadDir, '2026', '09'), { recursive: true });
  await writeFile(path.join(uploadDir, '2026', '09', 'healthy.pdf'), 'healthy');
  const repository = {
    async listAttachmentIntegrityRecords() { return [record()]; },
    async listKnownAttachmentStoredPaths() { return ['2026/09/healthy.pdf']; }
  };
  try {
    assert.deepEqual(await auditAttachmentIntegrity({ repository, uploadDir }), {
      ok: true,
      totals: { records: 1, bytes: 7, verified: 1, unverified: 0 },
      issues: [],
      orphanCandidates: []
    });
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
