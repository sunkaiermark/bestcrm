import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportAttachmentEvidenceInventory } from '../../scripts/export-attachment-evidence-inventory.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function queryTarget(rows) {
  return { async query() { return { rows }; } };
}

test('attachment evidence exporter writes deterministic sorted JSONL and marks legacy-unverified rows', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-inventory-'));
  const uploadDir = path.join(root, 'uploads');
  const outputPath = path.join(root, 'attachment-evidence-files.jsonl');
  const files = [
    ['2026/09/opportunity.pdf', 'opportunity'],
    ['email-inquiries/inquiry.pdf', 'inquiry'],
    ['lead-submissions/purge.pdf', 'purge']
  ];
  for (const [storedPath, content] of files) {
    const absolutePath = path.join(uploadDir, ...storedPath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  const rows = [
    { model: 'opportunity_attachment', record_id: '9', stored_path: files[0][0], file_size: '11', sha256: sha256('opportunity'), lifecycle_state: 'active' },
    { model: 'inquiry_attachment_purge_job', record_id: '7', stored_path: files[2][0], file_size: '5', sha256: sha256('purge'), lifecycle_state: 'pending' },
    { model: 'inquiry_attachment', record_id: '2', stored_path: files[1][0], file_size: '7', sha256: null, lifecycle_state: 'retained' }
  ];
  try {
    const summary = await exportAttachmentEvidenceInventory({
      queryTarget: queryTarget(rows), uploadDir, outputPath
    });
    assert.equal(summary.fileCount, 3);
    assert.equal(summary.totalBytes, 23);
    assert.equal(summary.unverifiedCount, 1);
    const text = await readFile(outputPath, 'utf8');
    const entries = text.trim().split('\n').map(JSON.parse);
    assert.deepEqual(entries.map((entry) => `${entry.model}:${entry.recordId}`), [
      'inquiry_attachment:2',
      'inquiry_attachment_purge_job:7',
      'opportunity_attachment:9'
    ]);
    assert.equal(entries[0].sha256, sha256('inquiry'));
    assert.equal(entries[0].verified, false);
    assert.equal(entries[2].verified, true);
    assert.equal(summary.inventorySha256, sha256(text));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('attachment evidence exporter strict mode rejects a legacy-unverified database row', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-inventory-strict-'));
  const uploadDir = path.join(root, 'uploads');
  const storedPath = 'email-inquiries/legacy.pdf';
  const absolutePath = path.join(uploadDir, ...storedPath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, 'legacy');
  try {
    await assert.rejects(() => exportAttachmentEvidenceInventory({
      queryTarget: queryTarget([{
        model: 'inquiry_attachment', record_id: '1', stored_path: storedPath,
        file_size: '6', sha256: null, lifecycle_state: 'retained'
      }]),
      uploadDir,
      outputPath: path.join(root, 'inventory.jsonl'),
      strict: true
    }), /unverified attachment evidence/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('attachment evidence exporter rejects duplicate, unsafe, wrong-size, and wrong-hash identities', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-inventory-invalid-'));
  const uploadDir = path.join(root, 'uploads');
  const storedPath = '2026/09/a.pdf';
  const absolutePath = path.join(uploadDir, ...storedPath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, 'value');
  const valid = {
    model: 'opportunity_attachment', record_id: '1', stored_path: storedPath,
    file_size: '5', sha256: sha256('value'), lifecycle_state: 'active'
  };
  const cases = [
    [[valid, { ...valid, record_id: '2' }], /Duplicate attachment evidence path/],
    [[{ ...valid, stored_path: '../outside.pdf' }], /Unsafe attachment evidence path/],
    [[{ ...valid, file_size: '6' }], /size mismatch/],
    [[{ ...valid, sha256: 'a'.repeat(64) }], /checksum mismatch/]
  ];
  try {
    for (const [rows, pattern] of cases) {
      await assert.rejects(() => exportAttachmentEvidenceInventory({
        queryTarget: queryTarget(rows), uploadDir,
        outputPath: path.join(root, `inventory-${Math.random()}.jsonl`)
      }), pattern);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
