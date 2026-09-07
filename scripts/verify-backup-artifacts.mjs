import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isMainModule } from '../src/utils/moduleEntry.mjs';

const execFileAsync = promisify(execFile);
const shaPattern = /^[a-f0-9]{64}$/;

function parseManifest(text) {
  return Object.fromEntries(String(text || '').split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf('=');
    if (separator <= 0) return [];
    return [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]];
  }));
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function assertSafeTarEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
      throw new Error(`Unsafe upload archive entry: ${entry}`);
    }
    if (normalized.split('/').includes('..')) {
      throw new Error(`Unsafe upload archive entry: ${entry}`);
    }
  }
}

function requireChecksum(manifest, key) {
  const value = manifest[key];
  if (!shaPattern.test(value || '')) throw new Error(`Backup manifest is missing ${key}`);
  return value;
}

function parseRawEmailInventory(value) {
  const seenPaths = new Set();
  return String(value || '').split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const match = line.match(/^([a-f0-9]{64})  (email-raw\/.+\.eml)$/);
    if (!match) throw new Error(`Invalid raw email inventory entry: ${line}`);
    assertSafeTarEntries([match[2]]);
    if (match[2].startsWith('email-raw/.staging/')) {
      throw new Error('Raw email staging files must not enter backups');
    }
    if (seenPaths.has(match[2])) throw new Error(`Duplicate raw email inventory path: ${match[2]}`);
    seenPaths.add(match[2]);
    return [{ sha256: match[1], storedPath: match[2] }];
  });
}

export async function verifyBackupArtifacts({ backupDir, restoreDir = '' }) {
  const directory = path.resolve(backupDir || '');
  const databasePath = path.join(directory, 'database.sql');
  const uploadsPath = path.join(directory, 'uploads.tar.gz');
  const rawEmailInventoryPath = path.join(directory, 'email-raw-files.sha256');
  const manifestPath = path.join(directory, 'manifest.txt');
  await Promise.all([
    access(databasePath), access(uploadsPath), access(rawEmailInventoryPath), access(manifestPath)
  ]);
  const databaseStats = await stat(databasePath);
  if (databaseStats.size < 32) throw new Error('Database backup is empty or incomplete');
  const manifest = parseManifest(await readFile(manifestPath, 'utf8'));
  const expectedDatabaseSha = requireChecksum(manifest, 'database_sha256');
  const expectedUploadsSha = requireChecksum(manifest, 'uploads_sha256');
  const expectedRawInventorySha = requireChecksum(manifest, 'raw_email_inventory_sha256');
  const [databaseSha256, uploadsSha256, rawEmailInventorySha256] = await Promise.all([
    sha256File(databasePath),
    sha256File(uploadsPath),
    sha256File(rawEmailInventoryPath)
  ]);
  if (databaseSha256 !== expectedDatabaseSha) throw new Error('Database backup checksum mismatch');
  if (uploadsSha256 !== expectedUploadsSha) throw new Error('Upload backup checksum mismatch');
  if (rawEmailInventorySha256 !== expectedRawInventorySha) {
    throw new Error('Raw email inventory checksum mismatch');
  }
  const rawEmailEntries = parseRawEmailInventory(await readFile(rawEmailInventoryPath, 'utf8'));
  const expectedRawCount = Number(manifest.raw_email_file_count);
  if (!Number.isSafeInteger(expectedRawCount) || expectedRawCount < 0) {
    throw new Error('Backup manifest has an invalid raw_email_file_count');
  }
  if (rawEmailEntries.length !== expectedRawCount) {
    throw new Error('Raw email inventory count mismatch');
  }
  const expectedRawBytes = Number(manifest.raw_email_size_bytes);
  if (!Number.isSafeInteger(expectedRawBytes) || expectedRawBytes < 0) {
    throw new Error('Backup manifest has an invalid raw_email_size_bytes');
  }
  const { stdout } = await execFileAsync('tar', ['-tzf', uploadsPath], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024
  });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  assertSafeTarEntries(entries);
  const uploadDirectoryName = path.posix.basename(String(manifest.upload_dir || 'uploads').replaceAll('\\', '/'));
  const archivedEntries = new Set(entries);
  const archivedRawEmails = entries.filter((entry) => (
    entry.startsWith(`${uploadDirectoryName}/email-raw/`)
    && entry.endsWith('.eml')
    && !entry.startsWith(`${uploadDirectoryName}/email-raw/.staging/`)
  ));
  if (archivedRawEmails.length !== rawEmailEntries.length) {
    throw new Error('Upload archive raw email count differs from inventory');
  }
  for (const entry of rawEmailEntries) {
    if (!archivedEntries.has(`${uploadDirectoryName}/${entry.storedPath}`)) {
      throw new Error(`Raw email file is missing from upload archive: ${entry.storedPath}`);
    }
  }
  let rawEmailFilesVerified = 0;
  let rawEmailBytesVerified = 0;
  if (restoreDir) {
    const target = path.resolve(restoreDir);
    await mkdir(target, { recursive: true });
    await execFileAsync('tar', ['-xzf', uploadsPath, '-C', target], { windowsHide: true });
    for (const entry of rawEmailEntries) {
      const restoredPath = path.join(target, uploadDirectoryName, ...entry.storedPath.split('/'));
      if (await sha256File(restoredPath) !== entry.sha256) {
        throw new Error(`Restored raw email checksum mismatch: ${entry.storedPath}`);
      }
      rawEmailBytesVerified += (await stat(restoredPath)).size;
      rawEmailFilesVerified += 1;
    }
    if (rawEmailBytesVerified !== expectedRawBytes) {
      throw new Error('Restored raw email byte count differs from manifest');
    }
  }
  return {
    backupDir: directory,
    databaseBytes: databaseStats.size,
    databaseSha256,
    uploadsSha256,
    rawEmailInventorySha256,
    rawEmailEntries,
    rawEmailFilesVerified,
    rawEmailBytesVerified,
    uploadDirectoryName,
    uploadEntries: entries,
    restoredTo: restoreDir ? path.resolve(restoreDir) : null
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--backup-dir', '--restore-dir'].includes(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key === '--backup-dir' ? 'backupDir' : 'restoreDir'] = value;
    index += 1;
  }
  if (!options.backupDir) throw new Error('--backup-dir is required');
  return options;
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await verifyBackupArtifacts(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
