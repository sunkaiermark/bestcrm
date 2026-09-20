import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new EmailOutboundMimeArtifactError(`${label} is required`);
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new EmailOutboundMimeArtifactError(`${label} must be a positive integer`);
  }
  return normalized;
}

function sourceBuffer(source) {
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (typeof source === 'string') return Buffer.from(source);
  throw new EmailOutboundMimeArtifactError('Generated outbound MIME bytes are required');
}

function artifactStoredPath(rfcMessageId, sha256) {
  const messageHash = createHash('sha256').update(rfcMessageId).digest('hex');
  return path.posix.join('email-outbound', messageHash, `${sha256.slice(0, 16)}.eml`);
}

function resolveArtifactPath(uploadDir, storedPath) {
  if (!/^email-outbound\/[0-9a-f]{64}\/[0-9a-f]{16}\.eml$/.test(storedPath)) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME stored path is invalid');
  }
  const uploadRoot = path.resolve(requiredText(uploadDir, 'uploadDir'));
  const outboundRoot = path.resolve(uploadRoot, 'email-outbound');
  const absolutePath = path.resolve(uploadRoot, ...storedPath.split('/'));
  const expectedPrefix = `${outboundRoot}${path.sep}`.toLowerCase();
  if (!absolutePath.toLowerCase().startsWith(expectedPrefix)) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME destination escaped the archive root');
  }
  return { uploadRoot, outboundRoot, absolutePath };
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

async function readAndVerifyArtifact({ artifact, message, uploadDir }) {
  if (Number(artifact?.messageId) !== Number(message.id)) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME database message identity does not match');
  }
  if (String(artifact.rfcMessageId || '').trim() !== String(message.messageId || '').trim()) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME RFC Message-ID does not match');
  }
  const fileSize = positiveInteger(artifact.fileSize, 'Outbound MIME fileSize');
  const sha256 = requiredText(artifact.sha256, 'Outbound MIME sha256');
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME SHA-256 identity is invalid');
  }
  const storedPath = requiredText(artifact.storedPath, 'Outbound MIME storedPath');
  const { absolutePath } = resolveArtifactPath(uploadDir, storedPath);
  let rawMime;
  try {
    rawMime = await readFile(absolutePath);
  } catch (error) {
    throw new EmailOutboundMimeIdentityConflictError(
      error?.code === 'ENOENT'
        ? 'Outbound MIME evidence file is missing'
        : 'Outbound MIME evidence file cannot be read'
    );
  }
  if (rawMime.length !== fileSize) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME file size does not match');
  }
  const actualSha256 = createHash('sha256').update(rawMime).digest('hex');
  if (actualSha256 !== sha256) {
    throw new EmailOutboundMimeIdentityConflictError('Outbound MIME file SHA-256 does not match');
  }
  return { ...artifact, storedPath, fileSize, sha256, absolutePath, rawMime };
}

export class EmailOutboundMimeArtifactError extends Error {
  constructor(message, code = 'email_outbound_mime_artifact_error') {
    super(message);
    this.name = 'EmailOutboundMimeArtifactError';
    this.code = code;
  }
}

export class EmailOutboundMimeIdentityConflictError extends EmailOutboundMimeArtifactError {
  constructor(message = 'Outbound MIME artifact identity conflicts with stored evidence') {
    super(message, 'email_outbound_mime_identity_conflict');
    this.name = 'EmailOutboundMimeIdentityConflictError';
  }
}

export async function prepareOutboundMimeArtifact({
  message,
  rawMime,
  uploadDir,
  emailArchiveRepository
}) {
  const messageId = positiveInteger(message?.id, 'message.id');
  const rfcMessageId = requiredText(message?.messageId, 'message.messageId');
  if (!emailArchiveRepository?.findOutboundMimeArtifact) {
    throw new EmailOutboundMimeArtifactError('Outbound MIME repository is not configured');
  }

  const existing = await emailArchiveRepository.findOutboundMimeArtifact(messageId);
  if (existing) {
    return readAndVerifyArtifact({ artifact: existing, message: { id: messageId, messageId: rfcMessageId }, uploadDir });
  }

  if (!emailArchiveRepository.createOutboundMimeArtifact) {
    throw new EmailOutboundMimeArtifactError('Outbound MIME repository is not configured');
  }

  const buffer = sourceBuffer(rawMime);
  if (buffer.length === 0) throw new EmailOutboundMimeArtifactError('Generated outbound MIME bytes are empty');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const storedPath = artifactStoredPath(rfcMessageId, sha256);
  const { outboundRoot, absolutePath } = resolveArtifactPath(uploadDir, storedPath);
  const stagingDirectory = path.join(outboundRoot, '.staging');
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  await chmod(stagingDirectory, 0o700).catch(() => {});
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

  try {
    await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
    await chmod(path.dirname(absolutePath), 0o700).catch(() => {});
    try {
      await link(stagingPath, absolutePath);
      await chmod(absolutePath, 0o600).catch(() => {});
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existingBytes = await readFile(absolutePath);
      if (existingBytes.length !== buffer.length) {
        throw new EmailOutboundMimeIdentityConflictError('Existing outbound MIME file size does not match');
      }
      const existingSha256 = createHash('sha256').update(existingBytes).digest('hex');
      if (existingSha256 !== sha256) {
        throw new EmailOutboundMimeIdentityConflictError('Existing outbound MIME file SHA-256 does not match');
      }
    }
  } finally {
    await rm(stagingPath, { force: true });
  }
  await syncDirectory(path.dirname(absolutePath));

  const artifact = await emailArchiveRepository.createOutboundMimeArtifact({
    messageId,
    storedPath,
    fileSize: buffer.length,
    sha256,
    rfcMessageId
  });
  return readAndVerifyArtifact({
    artifact,
    message: { id: messageId, messageId: rfcMessageId },
    uploadDir
  });
}
