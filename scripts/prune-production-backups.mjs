import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BACKUP_NAME_PATTERN = /^(\d{8})-(\d{6})$/;

function normalizeKeepDays(value) {
  const keepDays = Number(value);
  if (!Number.isInteger(keepDays) || keepDays < 1 || keepDays > 365) {
    throw new Error('Backup retention days must be an integer between 1 and 365');
  }
  return keepDays;
}

async function hasRegularManifest(directory) {
  try {
    return (await lstat(path.join(directory, 'manifest.txt'))).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function pruneProductionBackups({ backupDir, keepDays = 7, logger = console } = {}) {
  const root = path.resolve(String(backupDir || ''));
  if (!backupDir || root === path.parse(root).root) {
    throw new Error('A dedicated backup directory is required');
  }
  const retainedDayCount = normalizeKeepDays(keepDays);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    const match = entry.isDirectory() && entry.name.match(BACKUP_NAME_PATTERN);
    if (!match) continue;
    const directory = path.join(root, entry.name);
    if (!await hasRegularManifest(directory)) continue;
    candidates.push({ name: entry.name, day: match[1], directory });
  }

  candidates.sort((left, right) => left.name.localeCompare(right.name));
  const latestByDay = new Map();
  for (const candidate of candidates) latestByDay.set(candidate.day, candidate.directory);

  const retainedDays = new Set(
    [...latestByDay.keys()].sort().reverse().slice(0, retainedDayCount)
  );
  const removed = [];
  const kept = [];

  for (const candidate of candidates) {
    const isLatestForDay = latestByDay.get(candidate.day) === candidate.directory;
    if (isLatestForDay && retainedDays.has(candidate.day)) {
      kept.push(candidate.directory);
      continue;
    }
    await rm(candidate.directory, { recursive: true, force: false });
    removed.push(candidate.directory);
    logger.info?.(`BESTCRM backup pruned: ${candidate.directory}`);
  }

  return { kept, removed, retainedDayCount };
}

const invokedAsMain = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsMain) {
  const backupDir = process.argv[2];
  const keepDays = process.argv[3] || '7';
  pruneProductionBackups({ backupDir, keepDays })
    .then((result) => {
      console.log(`BESTCRM backup retention: kept ${result.kept.length} daily backups; removed ${result.removed.length}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
