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

function parseEmailEvidenceInventory(value, { legacyRawOnly = false } = {}) {
  const seenPaths = new Set();
  return String(value || '').split(/\r?\n/).flatMap((line) => {
    if (!line) return [];
    const match = line.match(/^([a-f0-9]{64})  ((?:email-raw|email-outbound)\/.+\.eml)$/);
    if (!match || (legacyRawOnly && !match[2].startsWith('email-raw/'))) {
      throw new Error(`Invalid email evidence inventory entry: ${line}`);
    }
    assertSafeTarEntries([match[2]]);
    if (match[2].startsWith('email-raw/.staging/')
        || match[2].startsWith('email-outbound/.staging/')) {
      throw new Error('Email evidence staging files must not enter backups');
    }
    if (seenPaths.has(match[2])) throw new Error(`Duplicate email evidence inventory path: ${match[2]}`);
    seenPaths.add(match[2]);
    return [{ sha256: match[1], storedPath: match[2] }];
  });
}

const attachmentEvidenceLifecycle = new Map([
  ['opportunity_attachment', new Set(['active', 'retired'])],
  ['inquiry_attachment', new Set(['retained'])],
  ['inquiry_attachment_purge_job', new Set(['pending', 'processing', 'failed'])]
]);

export function parseAttachmentEvidenceInventory(value) {
  const seenPaths = new Set();
  const seenRecords = new Set();
  return String(value || '').split(/\r?\n/).flatMap((line, index) => {
    if (!line) return [];
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error(`Invalid attachment evidence inventory JSON at line ${index + 1}`);
    }
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      throw new Error(`Invalid attachment evidence inventory entry at line ${index + 1}`);
    }
    const model = String(entry.model ?? '');
    const allowedLifecycle = attachmentEvidenceLifecycle.get(model);
    if (!allowedLifecycle) throw new Error(`Invalid attachment evidence model: ${model}`);
    if (!Number.isSafeInteger(entry.recordId) || entry.recordId <= 0) {
      throw new Error(`Invalid attachment evidence record id at line ${index + 1}`);
    }
    if (typeof entry.storedPath !== 'string' || !entry.storedPath || entry.storedPath.includes('\\')) {
      throw new Error(`Unsafe attachment evidence path: ${entry.storedPath ?? ''}`);
    }
    assertSafeTarEntries([entry.storedPath]);
    if (/[\0-\x1f\x7f]/.test(entry.storedPath)) {
      throw new Error(`Unsafe attachment evidence path: ${entry.storedPath}`);
    }
    if (seenPaths.has(entry.storedPath)) {
      throw new Error(`Duplicate attachment evidence path: ${entry.storedPath}`);
    }
    seenPaths.add(entry.storedPath);
    const recordKey = `${model}:${entry.recordId}`;
    if (seenRecords.has(recordKey)) {
      throw new Error(`Duplicate attachment evidence record: ${recordKey}`);
    }
    seenRecords.add(recordKey);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid attachment evidence size: ${entry.storedPath}`);
    }
    if (!shaPattern.test(entry.sha256 || '')) {
      throw new Error(`Invalid attachment evidence checksum: ${entry.storedPath}`);
    }
    if (!allowedLifecycle.has(entry.lifecycleState)) {
      throw new Error(`Invalid attachment evidence lifecycle state: ${entry.lifecycleState ?? ''}`);
    }
    if (typeof entry.verified !== 'boolean') {
      throw new Error(`Invalid attachment evidence verification state: ${entry.storedPath}`);
    }
    return [{
      model,
      recordId: entry.recordId,
      storedPath: entry.storedPath,
      size: entry.size,
      sha256: entry.sha256,
      lifecycleState: entry.lifecycleState,
      verified: entry.verified
    }];
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function verifyBackupArtifacts({ backupDir, restoreDir = '' }) {
  const directory = path.resolve(backupDir || '');
  const databasePath = path.join(directory, 'database.sql');
  const uploadsPath = path.join(directory, 'uploads.tar.gz');
  const emailEvidenceInventoryPath = path.join(directory, 'email-evidence-files.sha256');
  const legacyRawEmailInventoryPath = path.join(directory, 'email-raw-files.sha256');
  const attachmentEvidenceInventoryPath = path.join(directory, 'attachment-evidence-files.jsonl');
  const manifestPath = path.join(directory, 'manifest.txt');
  const hasCombinedEvidenceInventory = await fileExists(emailEvidenceInventoryPath);
  const inventoryPath = hasCombinedEvidenceInventory
    ? emailEvidenceInventoryPath
    : legacyRawEmailInventoryPath;
  await Promise.all([access(databasePath), access(uploadsPath), access(inventoryPath), access(manifestPath)]);
  const databaseStats = await stat(databasePath);
  if (databaseStats.size < 32) throw new Error('Database backup is empty or incomplete');
  const manifest = parseManifest(await readFile(manifestPath, 'utf8'));
  const hasAttachmentEvidenceFile = await fileExists(attachmentEvidenceInventoryPath);
  const hasAttachmentEvidenceManifest = Object.hasOwn(
    manifest,
    'attachment_evidence_inventory_sha256'
  );
  const hasAttachmentEvidenceInventory = hasAttachmentEvidenceFile || hasAttachmentEvidenceManifest;
  if (hasAttachmentEvidenceInventory && !hasAttachmentEvidenceFile) {
    throw new Error('Attachment evidence inventory file is missing');
  }
  const expectedDatabaseSha = requireChecksum(manifest, 'database_sha256');
  const expectedUploadsSha = requireChecksum(manifest, 'uploads_sha256');
  const inventoryShaKey = hasCombinedEvidenceInventory
    ? 'email_evidence_inventory_sha256'
    : 'raw_email_inventory_sha256';
  const expectedEvidenceInventorySha = requireChecksum(manifest, inventoryShaKey);
  const [databaseSha256, uploadsSha256, emailEvidenceInventorySha256] = await Promise.all([
    sha256File(databasePath),
    sha256File(uploadsPath),
    sha256File(inventoryPath)
  ]);
  if (databaseSha256 !== expectedDatabaseSha) throw new Error('Database backup checksum mismatch');
  if (uploadsSha256 !== expectedUploadsSha) throw new Error('Upload backup checksum mismatch');
  if (emailEvidenceInventorySha256 !== expectedEvidenceInventorySha) {
    throw new Error('Email evidence inventory checksum mismatch');
  }
  let attachmentEvidenceInventorySha256 = null;
  let attachmentEvidenceEntries = [];
  let expectedAttachmentEvidenceBytes = 0;
  let expectedAttachmentEvidenceUnverifiedCount = 0;
  if (hasAttachmentEvidenceInventory) {
    const expectedAttachmentInventorySha = requireChecksum(
      manifest,
      'attachment_evidence_inventory_sha256'
    );
    attachmentEvidenceInventorySha256 = await sha256File(attachmentEvidenceInventoryPath);
    if (attachmentEvidenceInventorySha256 !== expectedAttachmentInventorySha) {
      throw new Error('Attachment evidence inventory checksum mismatch');
    }
    attachmentEvidenceEntries = parseAttachmentEvidenceInventory(
      await readFile(attachmentEvidenceInventoryPath, 'utf8')
    );
    const expectedAttachmentEvidenceCount = Number(manifest.attachment_evidence_file_count);
    if (!Number.isSafeInteger(expectedAttachmentEvidenceCount) || expectedAttachmentEvidenceCount < 0) {
      throw new Error('Backup manifest has an invalid attachment_evidence_file_count');
    }
    if (attachmentEvidenceEntries.length !== expectedAttachmentEvidenceCount) {
      throw new Error('Attachment evidence inventory count mismatch');
    }
    expectedAttachmentEvidenceBytes = Number(manifest.attachment_evidence_size_bytes);
    if (!Number.isSafeInteger(expectedAttachmentEvidenceBytes) || expectedAttachmentEvidenceBytes < 0) {
      throw new Error('Backup manifest has an invalid attachment_evidence_size_bytes');
    }
    const inventoryBytes = attachmentEvidenceEntries.reduce((total, entry) => total + entry.size, 0);
    if (inventoryBytes !== expectedAttachmentEvidenceBytes) {
      throw new Error('Attachment evidence inventory byte count mismatch');
    }
    expectedAttachmentEvidenceUnverifiedCount = Number(
      manifest.attachment_evidence_unverified_count
    );
    if (
      !Number.isSafeInteger(expectedAttachmentEvidenceUnverifiedCount)
      || expectedAttachmentEvidenceUnverifiedCount < 0
    ) {
      throw new Error('Backup manifest has an invalid attachment_evidence_unverified_count');
    }
    const inventoryUnverifiedCount = attachmentEvidenceEntries.filter((entry) => !entry.verified).length;
    if (inventoryUnverifiedCount !== expectedAttachmentEvidenceUnverifiedCount) {
      throw new Error('Attachment evidence inventory unverified count mismatch');
    }
  }
  const emailEvidenceEntries = parseEmailEvidenceInventory(await readFile(inventoryPath, 'utf8'), {
    legacyRawOnly: !hasCombinedEvidenceInventory
  });
  const countKey = hasCombinedEvidenceInventory ? 'email_evidence_file_count' : 'raw_email_file_count';
  const expectedEvidenceCount = Number(manifest[countKey]);
  if (!Number.isSafeInteger(expectedEvidenceCount) || expectedEvidenceCount < 0) {
    throw new Error(`Backup manifest has an invalid ${countKey}`);
  }
  if (emailEvidenceEntries.length !== expectedEvidenceCount) {
    throw new Error('Email evidence inventory count mismatch');
  }
  const sizeKey = hasCombinedEvidenceInventory ? 'email_evidence_size_bytes' : 'raw_email_size_bytes';
  const expectedEvidenceBytes = Number(manifest[sizeKey]);
  if (!Number.isSafeInteger(expectedEvidenceBytes) || expectedEvidenceBytes < 0) {
    throw new Error(`Backup manifest has an invalid ${sizeKey}`);
  }
  const { stdout } = await execFileAsync('tar', ['-tzf', uploadsPath], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024
  });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  assertSafeTarEntries(entries);
  const uploadDirectoryName = path.posix.basename(String(manifest.upload_dir || 'uploads').replaceAll('\\', '/'));
  const archivedEntries = new Set(entries);
  const archivedEmailEvidence = entries.filter((entry) => (
    (entry.startsWith(`${uploadDirectoryName}/email-raw/`)
      || entry.startsWith(`${uploadDirectoryName}/email-outbound/`))
    && entry.endsWith('.eml')
    && !entry.startsWith(`${uploadDirectoryName}/email-raw/.staging/`)
    && !entry.startsWith(`${uploadDirectoryName}/email-outbound/.staging/`)
  ));
  if (archivedEmailEvidence.length !== emailEvidenceEntries.length) {
    throw new Error('Upload archive email evidence count differs from inventory');
  }
  for (const entry of emailEvidenceEntries) {
    if (!archivedEntries.has(`${uploadDirectoryName}/${entry.storedPath}`)) {
      throw new Error(`Email evidence file is missing from upload archive: ${entry.storedPath}`);
    }
  }
  for (const entry of attachmentEvidenceEntries) {
    if (!archivedEntries.has(`${uploadDirectoryName}/${entry.storedPath}`)) {
      throw new Error(`Attachment evidence file is missing from upload archive: ${entry.storedPath}`);
    }
  }
  const rawEmailEntries = emailEvidenceEntries.filter((entry) => entry.storedPath.startsWith('email-raw/'));
  const outboundMimeEntries = emailEvidenceEntries.filter((entry) => entry.storedPath.startsWith('email-outbound/'));
  let emailEvidenceFilesVerified = 0;
  let emailEvidenceBytesVerified = 0;
  let rawEmailFilesVerified = 0;
  let rawEmailBytesVerified = 0;
  let outboundMimeFilesVerified = 0;
  let outboundMimeBytesVerified = 0;
  let attachmentEvidenceFilesVerified = 0;
  let attachmentEvidenceBytesVerified = 0;
  if (restoreDir) {
    const target = path.resolve(restoreDir);
    await mkdir(target, { recursive: true });
    await execFileAsync('tar', ['-xzf', uploadsPath, '-C', target], { windowsHide: true });
    for (const entry of emailEvidenceEntries) {
      const restoredPath = path.join(target, uploadDirectoryName, ...entry.storedPath.split('/'));
      if (await sha256File(restoredPath) !== entry.sha256) {
        throw new Error(`Restored email evidence checksum mismatch: ${entry.storedPath}`);
      }
      const restoredBytes = (await stat(restoredPath)).size;
      emailEvidenceBytesVerified += restoredBytes;
      emailEvidenceFilesVerified += 1;
      if (entry.storedPath.startsWith('email-raw/')) {
        rawEmailBytesVerified += restoredBytes;
        rawEmailFilesVerified += 1;
      } else {
        outboundMimeBytesVerified += restoredBytes;
        outboundMimeFilesVerified += 1;
      }
    }
    if (emailEvidenceBytesVerified !== expectedEvidenceBytes) {
      throw new Error('Restored email evidence byte count differs from manifest');
    }
    for (const entry of attachmentEvidenceEntries) {
      const restoredPath = path.join(target, uploadDirectoryName, ...entry.storedPath.split('/'));
      const restoredSha256 = await sha256File(restoredPath);
      const restoredBytes = (await stat(restoredPath)).size;
      if (restoredBytes !== entry.size) {
        throw new Error(
          `Restored attachment evidence size mismatch: ${entry.storedPath} `
          + `(expected ${entry.size}, received ${restoredBytes})`
        );
      }
      if (restoredSha256 !== entry.sha256) {
        throw new Error(`Restored attachment evidence checksum mismatch: ${entry.storedPath}`);
      }
      attachmentEvidenceFilesVerified += 1;
      attachmentEvidenceBytesVerified += restoredBytes;
    }
    if (attachmentEvidenceBytesVerified !== expectedAttachmentEvidenceBytes) {
      throw new Error('Restored attachment evidence byte count differs from manifest');
    }
  }
  return {
    backupDir: directory,
    databaseBytes: databaseStats.size,
    databaseSha256,
    uploadsSha256,
    inventoryFormat: hasCombinedEvidenceInventory ? 'email-evidence' : 'legacy-email-raw',
    emailEvidenceInventorySha256,
    emailEvidenceEntries,
    emailEvidenceFilesVerified,
    emailEvidenceBytesVerified,
    rawEmailEntries,
    rawEmailFilesVerified,
    rawEmailBytesVerified,
    outboundMimeEntries,
    outboundMimeFilesVerified,
    outboundMimeBytesVerified,
    hasAttachmentEvidenceInventory,
    attachmentEvidenceInventorySha256,
    attachmentEvidenceEntries,
    attachmentEvidenceFilesVerified,
    attachmentEvidenceBytesVerified,
    attachmentEvidenceUnverifiedCount: expectedAttachmentEvidenceUnverifiedCount,
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
