import { randomUUID } from 'node:crypto';
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
  const resolved = path.resolve(uploadRoot, storedPath);
  const normalizedRoot = uploadRoot.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

export async function storeAttachmentBuffer({ uploadDir, originalName, content, prefix = '' }) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '');
  const destination = destinationFor(uploadDir, originalName, prefix);
  await mkdir(destination.directory, { recursive: true });
  await writeFile(destination.absolutePath, buffer);
  return {
    absolutePath: destination.absolutePath,
    storedPath: storedPathForAbsolutePath(uploadDir, destination.absolutePath),
    fileSize: buffer.length
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
  const fileStat = await stat(destination.absolutePath);
  return {
    absolutePath: destination.absolutePath,
    storedPath: storedPathForAbsolutePath(uploadDir, destination.absolutePath),
    fileSize: fileStat.size
  };
}

export async function removeStoredAttachmentFile(filePath) {
  if (filePath) {
    await rm(filePath, { force: true });
  }
}
