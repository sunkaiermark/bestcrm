import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, link, mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new EmailRawArchiveError(`${label} is required`);
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new EmailRawArchiveError(`${label} must be a positive integer`);
  }
  return normalized;
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

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function verifyExistingFile(filePath, expectedSize, expectedSha256) {
  const content = await readFile(filePath);
  if (content.length !== expectedSize) {
    throw new EmailRawIdentityConflictError('Existing raw email file size does not match');
  }
  const actualSha256 = createHash('sha256').update(content).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new EmailRawIdentityConflictError('Existing raw email file SHA-256 does not match');
  }
}

function safeSourceBuffer(source) {
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (typeof source === 'string') return Buffer.from(source);
  throw new EmailRawArchiveError('Raw email source must be bytes');
}

function relativePathFor({ mailboxKey, providerUidValidity, providerUid, sha256 }) {
  const mailboxHash = createHash('sha256').update(mailboxKey).digest('hex');
  return path.posix.join(
    'email-raw',
    mailboxHash,
    providerUidValidity,
    `${providerUid}-${sha256.slice(0, 16)}.eml`
  );
}

export class EmailRawArchiveError extends Error {
  constructor(message, code = 'email_raw_archive_error') {
    super(message);
    this.name = 'EmailRawArchiveError';
    this.code = code;
  }
}

export class EmailRawIdentityConflictError extends EmailRawArchiveError {
  constructor(message = 'Raw email provider identity conflicts with stored evidence') {
    super(message, 'email_raw_identity_conflict');
    this.name = 'EmailRawIdentityConflictError';
  }
}

export class EmailRawMalwareError extends EmailRawArchiveError {
  constructor(scan, capture = {}) {
    super('Raw email failed malware scanning', 'email_raw_malware_detected');
    this.name = 'EmailRawMalwareError';
    this.scan = scan;
    this.capture = Object.freeze({
      mailboxKey: capture.mailboxKey,
      providerName: capture.providerName,
      providerMailbox: capture.providerMailbox,
      providerUidValidity: capture.providerUidValidity,
      providerUid: capture.providerUid,
      sha256: capture.sha256
    });
  }
}

export class EmailRawScanError extends EmailRawArchiveError {
  constructor(scan) {
    super('Raw email malware scanner did not return a clean verdict', 'email_raw_scan_failed');
    this.name = 'EmailRawScanError';
    this.scan = scan;
  }
}

export async function prepareEmailRawCapture({
  source,
  uploadDir,
  mailboxKey,
  providerName = 'imap',
  providerMailbox,
  providerUidValidity,
  providerUid,
  maxBytes,
  scanner
}) {
  const buffer = safeSourceBuffer(source);
  const limit = Number(maxBytes || 0);
  if (buffer.length === 0) throw new EmailRawArchiveError('Raw email source is empty');
  if (Number.isFinite(limit) && limit > 0 && buffer.length > limit) {
    throw new EmailRawArchiveError('Raw email source exceeds configured limit', 'email_raw_too_large');
  }
  if (!scanner || typeof scanner.scanFile !== 'function') {
    throw new EmailRawScanError({ verdict: 'error', findingCode: 'scanner_unavailable' });
  }

  const identity = {
    mailboxKey: requiredText(mailboxKey, 'mailboxKey'),
    providerName: requiredText(providerName, 'providerName'),
    providerMailbox: requiredText(providerMailbox, 'providerMailbox'),
    providerUidValidity: requiredText(providerUidValidity, 'providerUidValidity'),
    providerUid: positiveInteger(providerUid, 'providerUid')
  };
  const uploadRoot = path.resolve(requiredText(uploadDir, 'uploadDir'));
  const rawRoot = path.join(uploadRoot, 'email-raw');
  const stagingDirectory = path.join(rawRoot, '.staging');
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  await chmod(stagingDirectory, 0o700).catch(() => {});

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const storedPath = relativePathFor({ ...identity, sha256 });
  const absolutePath = path.resolve(uploadRoot, ...storedPath.split('/'));
  const expectedPrefix = `${rawRoot}${path.sep}`.toLowerCase();
  if (!absolutePath.toLowerCase().startsWith(expectedPrefix)) {
    throw new EmailRawArchiveError('Raw email destination escaped the archive root');
  }

  const stagingPath = path.join(stagingDirectory, `${randomUUID()}.eml.tmp`);
  let handle;
  try {
    handle = await open(stagingPath, 'wx', 0o600);
    await handle.writeFile(buffer);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
  await chmod(stagingPath, 0o600).catch(() => {});

  let scan;
  try {
    scan = await scanner.scanFile(stagingPath, { sha256, fileSize: buffer.length });
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw new EmailRawScanError({
      verdict: 'error',
      findingCode: 'scanner_exception',
      safeDetail: String(error?.message || 'scanner failed').slice(0, 500)
    });
  }
  if (scan?.verdict !== 'clean') {
    await rm(stagingPath, { force: true });
    if (scan?.verdict === 'malware') {
      throw new EmailRawMalwareError(scan, { ...identity, sha256 });
    }
    throw new EmailRawScanError(scan || { verdict: 'error', findingCode: 'missing_verdict' });
  }

  let state = 'staged';
  return {
    ...identity,
    sha256,
    fileSize: buffer.length,
    storedPath,
    stagingPath,
    scan,
    async commit({ rfcMessageIdHint = '', sourceReceivedAt = null } = {}) {
      if (state === 'discarded') throw new EmailRawArchiveError('Raw email staging file was discarded');
      if (state === 'committed') {
        return {
          ...identity, rfcMessageIdHint, sourceReceivedAt, storedPath,
          absolutePath, fileSize: buffer.length, sha256, scan
        };
      }
      await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(absolutePath), 0o700).catch(() => {});
      try {
        await link(stagingPath, absolutePath);
        await chmod(absolutePath, 0o600).catch(() => {});
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await verifyExistingFile(absolutePath, buffer.length, sha256);
      }
      await rm(stagingPath, { force: true });
      await syncDirectory(path.dirname(absolutePath));
      state = 'committed';
      return {
        ...identity, rfcMessageIdHint, sourceReceivedAt, storedPath,
        absolutePath, fileSize: buffer.length, sha256, scan
      };
    },
    async discard() {
      if (state === 'committed') {
        throw new EmailRawArchiveError('Committed raw email evidence cannot be discarded');
      }
      await rm(stagingPath, { force: true });
      state = 'discarded';
    },
    async verifyCommitted() {
      if (state !== 'committed') return false;
      await verifyExistingFile(absolutePath, buffer.length, sha256);
      return (await sha256File(absolutePath)) === sha256;
    }
  };
}
