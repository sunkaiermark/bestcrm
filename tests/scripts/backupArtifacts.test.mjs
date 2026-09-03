import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyBackupArtifacts } from '../../scripts/verify-backup-artifacts.mjs';

const execFileAsync = promisify(execFile);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('backup verifier checks database and upload hashes before isolated extraction', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-backup-test-'));
  const backupDir = path.join(root, 'backup');
  const sourceDir = path.join(root, 'source');
  const restoreDir = path.join(root, 'restore');
  try {
    await mkdir(path.join(sourceDir, 'uploads', 'email-archive'), { recursive: true });
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'uploads', 'email-archive', 'message.txt'), 'archived customer message');
    await writeFile(path.join(sourceDir, 'uploads', 'QP-V2.pdf'), 'approved quotation');
    const database = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE email_messages(id bigint);\n');
    const databasePath = path.join(backupDir, 'database.sql');
    const uploadsPath = path.join(backupDir, 'uploads.tar.gz');
    await writeFile(databasePath, database);
    await execFileAsync('tar', ['-czf', uploadsPath, '-C', sourceDir, 'uploads'], { windowsHide: true });
    const uploads = await readFile(uploadsPath);
    await writeFile(path.join(backupDir, 'manifest.txt'), [
      'backup_id=local-rehearsal',
      `database_sha256=${sha256(database)}`,
      `uploads_sha256=${sha256(uploads)}`,
      ''
    ].join('\n'));

    const result = await verifyBackupArtifacts({ backupDir, restoreDir });
    assert.equal(result.databaseSha256, sha256(database));
    assert.ok(result.uploadEntries.includes('uploads/email-archive/message.txt'));
    assert.equal(await readFile(path.join(restoreDir, 'uploads', 'QP-V2.pdf'), 'utf8'), 'approved quotation');

    await writeFile(databasePath, `${database.toString()}-- tampered\n`);
    await assert.rejects(() => verifyBackupArtifacts({ backupDir }), /Database backup checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('production backup and rollback scripts record and enforce artifact checksums', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const backupScript = await readFile(path.join(root, 'scripts', 'backup-production.sh'), 'utf8');
  const rollbackScript = await readFile(path.join(root, 'scripts', 'rollback-production.sh'), 'utf8');
  assert.match(backupScript, /database_sha256=\$DATABASE_SHA256/);
  assert.match(backupScript, /uploads_sha256=\$UPLOADS_SHA256/);
  assert.match(rollbackScript, /verify_backup_checksum "\$DB_BACKUP"/);
  assert.match(rollbackScript, /verify_backup_checksum "\$UPLOAD_BACKUP"/);
  assert.match(rollbackScript, /tar -tzf "\$UPLOAD_BACKUP"/);
  assert.match(rollbackScript, /BESTCRM_ALLOW_LEGACY_BACKUP/);
});

test('backup verifier streams artifact hashing for multi-gigabyte archives', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const verifierScript = await readFile(
    path.join(root, 'scripts', 'verify-backup-artifacts.mjs'),
    'utf8'
  );
  assert.match(verifierScript, /createReadStream\(filePath\)/);
  assert.doesNotMatch(verifierScript, /readFile\(filePath\)/);
});
