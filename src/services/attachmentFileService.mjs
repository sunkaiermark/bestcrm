import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function currentUploadSubdir() {
  const now = new Date();
  return path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
}

function safeExtension(originalName) {
  const extension = path.extname(String(originalName || ''));
  return extension.length <= 32 ? extension : '';
}

function storedPathForAbsolutePath(uploadDir, filePath) {
  return path.relative(path.resolve(uploadDir), filePath).split(path.sep).join('/');
}

function destinationFor(uploadDir, originalName, prefix) {
  const relativeDir = prefix
    ? path.join(prefix, currentUploadSubdir())
    : currentUploadSubdir();
  const directory = path.join(path.resolve(uploadDir), relativeDir);
  const filename = `${randomUUID()}${safeExtension(originalName)}`;
  return {
    directory,
    absolutePath: path.join(directory, filename)
  };
}

export function resolveStoredPath(uploadDir, storedPath) {
  const uploadRoot = path.resolve(uploadDir);
  const candidate = String(storedPath ?? '');
  const portablePath = candidate.replaceAll('\\', '/');
  const pathSegments = portablePath.split('/');
  if (
    candidate.trim() === ''
    || candidate.includes('\0')
    || portablePath.startsWith('/')
    || /^[A-Za-z]:/.test(portablePath)
    || pathSegments.includes('..')
  ) {
    return null;
  }
  const normalizedSegments = pathSegments.filter((segment) => segment !== '' && segment !== '.');
  if (normalizedSegments.length === 0) return null;
  const resolved = path.resolve(uploadRoot, ...normalizedSegments);
  const normalizedRoot = uploadRoot.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function attachmentFileError(code) {
  const error = new Error(`Attachment file error: ${code}`);
  error.code = code;
  return error;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  let fileSize = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    fileSize += chunk.length;
  }
  return { fileSize, sha256: hash.digest('hex') };
}

export async function inspectStoredAttachmentFile({ uploadDir, storedPath }) {
  const absolutePath = resolveStoredPath(uploadDir, storedPath);
  if (!absolutePath) throw attachmentFileError('invalid_stored_path');
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw attachmentFileError('not_a_file');
  const inspected = await sha256File(absolutePath);
  return {
    absolutePath,
    fileSize: inspected.fileSize,
    sha256: inspected.sha256
  };
}

export async function storeAttachmentBuffer({ uploadDir, originalName, content, prefix = '' }) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '');
  const destination = destinationFor(uploadDir, originalName, prefix);
  await mkdir(destination.directory, { recursive: true });
  await writeFile(destination.absolutePath, buffer);
  const storedPath = storedPathForAbsolutePath(uploadDir, destination.absolutePath);
  const inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
  return {
    absolutePath: destination.absolutePath,
    storedPath,
    fileSize: inspected.fileSize,
    sha256: inspected.sha256
  };
}

export async function copyStoredAttachmentFile({ uploadDir, storedPath, originalName, prefix = '' }) {
  const sourcePath = resolveStoredPath(uploadDir, storedPath);
  if (!sourcePath) {
    throw new Error('Attachment path is invalid');
  }
  const destination = destinationFor(uploadDir, originalName, prefix);
  await mkdir(destination.directory, { recursive: true });
  await copyFile(sourcePath, destination.absolutePath);
  const copiedStoredPath = storedPathForAbsolutePath(uploadDir, destination.absolutePath);
  const inspected = await inspectStoredAttachmentFile({
    uploadDir,
    storedPath: copiedStoredPath
  });
  return {
    absolutePath: destination.absolutePath,
    storedPath: copiedStoredPath,
    fileSize: inspected.fileSize,
    sha256: inspected.sha256
  };
}

export async function removeStoredAttachmentFile(filePath) {
  if (filePath) {
    await rm(filePath, { force: true });
  }
}
