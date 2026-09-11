import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneProductionBackups } from '../../scripts/prune-production-backups.mjs';

async function createCompleteBackup(root, name) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'manifest.txt'), `backup_id=${name}\n`);
  return directory;
}

test('backup retention keeps only the latest complete backup for each retained day', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-retention-'));
  try {
    for (const name of [
      '20260908-222729',
      '20260909-002040',
      '20260909-142220',
      '20260910-064711',
      '20260910-234535',
      '20260911-072025',
      '20260911-075456'
    ]) {
      await createCompleteBackup(root, name);
    }
    await mkdir(path.join(root, '20260911-080000'));
    await mkdir(path.join(root, 'manual-restore-point'));
    await writeFile(path.join(root, 'backup.log'), 'log');

    const messages = [];
    const result = await pruneProductionBackups({
      backupDir: root,
      keepDays: 3,
      logger: { info(message) { messages.push(message); } }
    });

    assert.deepEqual((await readdir(root)).sort(), [
      '20260909-142220',
      '20260910-234535',
      '20260911-075456',
      '20260911-080000',
      'backup.log',
      'manual-restore-point'
    ]);
    assert.equal(result.kept.length, 3);
    assert.equal(result.removed.length, 4);
    assert.equal(messages.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup retention ignores incomplete and nonstandard directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-retention-safe-'));
  try {
    await createCompleteBackup(root, '20260911-075456');
    await mkdir(path.join(root, '20260911-080000'));
    await mkdir(path.join(root, 'pre-nanjing-restore-20260902-162743'));

    const result = await pruneProductionBackups({ backupDir: root, keepDays: 7, logger: { info() {} } });

    assert.equal(result.removed.length, 0);
    await access(path.join(root, '20260911-080000'));
    await access(path.join(root, 'pre-nanjing-restore-20260902-162743'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup retention refuses a filesystem root and invalid retention counts', async () => {
  await assert.rejects(
    () => pruneProductionBackups({ backupDir: path.parse(process.cwd()).root }),
    /dedicated backup directory/
  );
  await assert.rejects(
    () => pruneProductionBackups({ backupDir: process.cwd(), keepDays: 0 }),
    /between 1 and 365/
  );
});
