import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { openVerifiedDevelopmentPrivateFile } from './developmentPrivateFileStore.mjs';

const PRIVATE_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEMPORARY_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
const STALE_TEMPORARY_MS = 24 * 60 * 60 * 1000;

async function children(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Read-only recovery inventory. An unregistered promoted file might be a
 * concurrent upload or the result of an uncertain COMMIT, so this audit never
 * deletes or moves it. Operators must investigate before any cleanup.
 */
export async function auditDevelopmentMaterialRecovery({ repository, uploadDir }) {
  const records = await repository.listVersionStorageRecords();
  const referenced = new Set(records.map((record) => record.storedPath));
  const root = path.join(path.resolve(uploadDir), 'development');
  const report = {
    activated: 0,
    unactivatedVersions: [],
    unavailableActivated: [],
    unregisteredPrivateFiles: [],
    temporaryFileCounts: { incoming: 0, staging: 0 },
    staleTemporaryFiles: [],
    unexpectedStorageEntries: [],
    ok: true
  };

  try {
    const rootEntry = await lstat(root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      report.unexpectedStorageEntries.push('development storage root is not a private directory');
      report.ok = false;
      return report;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  for (const record of records) {
    if (!record.activated) {
      report.unactivatedVersions.push(record.versionId);
      continue;
    }
    report.activated += 1;
    try {
      const handle = await openVerifiedDevelopmentPrivateFile({
        uploadDir, storedPath: record.storedPath, topicId: record.topicId,
        expectedSize: record.fileSize, expectedSha256: record.sha256
      });
      await handle.close();
    } catch (error) {
      report.unavailableActivated.push({ versionId: record.versionId,
        code: error.code || 'verification_failed' });
    }
  }

  for (const topicEntry of await children(root)) {
    if (topicEntry.name === '.incoming' || topicEntry.name === '.staging') {
      if (!topicEntry.isDirectory() || topicEntry.isSymbolicLink()) {
        report.unexpectedStorageEntries.push(topicEntry.name);
        continue;
      }
      const directory = path.join(root, topicEntry.name);
      const entries = await children(directory);
      report.temporaryFileCounts[topicEntry.name.slice(1)] = entries.length;
      for (const entry of entries) {
        const relativePath = `development/${topicEntry.name}/${entry.name}`;
        if (!TEMPORARY_FILE_NAME.test(entry.name) || !entry.isFile()
            || entry.isSymbolicLink()) {
          report.unexpectedStorageEntries.push(relativePath);
          continue;
        }
        const detail = await lstat(path.join(directory, entry.name));
        if (Date.now() - detail.mtimeMs > STALE_TEMPORARY_MS) {
          report.staleTemporaryFiles.push({ path: relativePath,
            fileSize: detail.size, modifiedAt: detail.mtime.toISOString() });
        }
      }
      continue;
    }
    if (!/^[1-9]\d*$/.test(topicEntry.name) || !topicEntry.isDirectory()
        || topicEntry.isSymbolicLink()) {
      report.unexpectedStorageEntries.push(topicEntry.name);
      continue;
    }
    for (const entry of await children(path.join(root, topicEntry.name))) {
      const storedPath = `development/${topicEntry.name}/${entry.name}`;
      if (!PRIVATE_FILE_NAME.test(entry.name) || !entry.isFile()
          || entry.isSymbolicLink()) {
        report.unexpectedStorageEntries.push(storedPath);
      } else if (!referenced.has(storedPath)) {
        const detail = await lstat(path.join(root, topicEntry.name, entry.name));
        report.unregisteredPrivateFiles.push({ storedPath,
          fileSize: detail.size, modifiedAt: detail.mtime.toISOString() });
      }
    }
  }
  report.ok = report.unactivatedVersions.length === 0
    && report.unavailableActivated.length === 0
    && report.unregisteredPrivateFiles.length === 0
    && report.staleTemporaryFiles.length === 0
    && report.unexpectedStorageEntries.length === 0;
  return report;
}
