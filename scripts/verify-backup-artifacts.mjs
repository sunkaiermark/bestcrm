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

export async function verifyBackupArtifacts({ backupDir, restoreDir = '' }) {
  const directory = path.resolve(backupDir || '');
  const databasePath = path.join(directory, 'database.sql');
  const uploadsPath = path.join(directory, 'uploads.tar.gz');
  const manifestPath = path.join(directory, 'manifest.txt');
  await Promise.all([access(databasePath), access(uploadsPath), access(manifestPath)]);
  const databaseStats = await stat(databasePath);
  if (databaseStats.size < 32) throw new Error('Database backup is empty or incomplete');
  const manifest = parseManifest(await readFile(manifestPath, 'utf8'));
  const expectedDatabaseSha = requireChecksum(manifest, 'database_sha256');
  const expectedUploadsSha = requireChecksum(manifest, 'uploads_sha256');
  const [databaseSha256, uploadsSha256] = await Promise.all([
    sha256File(databasePath),
    sha256File(uploadsPath)
  ]);
  if (databaseSha256 !== expectedDatabaseSha) throw new Error('Database backup checksum mismatch');
  if (uploadsSha256 !== expectedUploadsSha) throw new Error('Upload backup checksum mismatch');
  const { stdout } = await execFileAsync('tar', ['-tzf', uploadsPath], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024
  });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  assertSafeTarEntries(entries);
  if (restoreDir) {
    const target = path.resolve(restoreDir);
    await mkdir(target, { recursive: true });
    await execFileAsync('tar', ['-xzf', uploadsPath, '-C', target], { windowsHide: true });
  }
  return {
    backupDir: directory,
    databaseBytes: databaseStats.size,
    databaseSha256,
    uploadsSha256,
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
