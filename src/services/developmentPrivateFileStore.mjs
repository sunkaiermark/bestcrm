import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  DEVELOPMENT_FILE_MAX_BYTES,
  inspectDevelopmentFile
} from './developmentFileInspectionService.mjs';

const COPY_CHUNK_BYTES = 64 * 1024;
const STORED_PATH_PATTERN = /^development\/([1-9]\d*)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const INCOMING_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

export class DevelopmentPrivateFileError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'DevelopmentPrivateFileError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function reject(message, code, statusCode) {
  throw new DevelopmentPrivateFileError(message, code, statusCode);
}

function validTopicId(topicId) {
  const number = Number(topicId);
  if (!Number.isSafeInteger(number) || number < 1) reject('Invalid research topic', 'invalid_topic');
  return number;
}

function uploadRoot(uploadDir) {
  if (typeof uploadDir !== 'string' || !uploadDir.trim()) {
    reject('Research storage is unavailable', 'storage_unavailable', 503);
  }
  return path.resolve(uploadDir);
}

function noFollowReadFlags() {
  return fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
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

async function hashHandle(handle) {
  const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
  const hash = createHash('sha256');
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return { fileSize: position, sha256: hash.digest('hex') };
}

async function copyToRestrictedStaging({ sourcePath, stagingPath }) {
  let source;
  let target;
  try {
    const sourceEntry = await lstat(sourcePath);
    if (!sourceEntry.isFile()) reject('Research source is not a regular file', 'invalid_source');
    source = await open(sourcePath, noFollowReadFlags());
    const sourceStat = await source.stat();
    if (!sourceStat.isFile() || sourceStat.ino !== sourceEntry.ino || sourceStat.size < 1
        || sourceStat.size > DEVELOPMENT_FILE_MAX_BYTES) {
      reject('Research file is empty or exceeds the 100 MB limit', 'invalid_size');
    }
    target = await open(stagingPath, 'wx', 0o600);
    const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
    let readPosition = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, readPosition);
      if (!bytesRead) break;
      readPosition += bytesRead;
      if (readPosition > DEVELOPMENT_FILE_MAX_BYTES) {
        reject('Research file exceeds the 100 MB limit', 'invalid_size');
      }
      let written = 0;
      while (written < bytesRead) {
        const result = await target.write(buffer, written, bytesRead - written);
        if (!result.bytesWritten) reject('Research file staging failed', 'storage_error', 503);
        written += result.bytesWritten;
      }
    }
    if (readPosition < 1 || readPosition !== sourceStat.size) {
      reject('Research file changed during staging', 'source_changed', 409);
    }
    await target.sync();
  } finally {
    await target?.close().catch(() => {});
    await source?.close().catch(() => {});
  }
  await chmod(stagingPath, 0o600).catch(() => {});
}

function storedPathFor(topicId) {
  return `development/${topicId}/${randomUUID()}`;
}

export async function discardDevelopmentIncomingFile({ uploadDir, sourcePath }) {
  const root = uploadRoot(uploadDir);
  const incomingDirectory = path.join(root, 'development', '.incoming');
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    reject('Research source file is required', 'invalid_source');
  }
  const absoluteSource = path.resolve(sourcePath);
  if (path.dirname(absoluteSource) !== incomingDirectory
      || !INCOMING_NAME_PATTERN.test(path.basename(absoluteSource))
      || await realpath(incomingDirectory).catch(() => '') !== incomingDirectory) {
    reject('Research source must be a private server-generated upload', 'invalid_source');
  }
  let entry;
  try {
    entry = await lstat(absoluteSource);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    reject('Research source is not a regular file', 'invalid_source');
  }
  await rm(absoluteSource);
  return true;
}

export function resolveDevelopmentStoredPath({ uploadDir, storedPath, topicId }) {
  const match = STORED_PATH_PATTERN.exec(String(storedPath || ''));
  if (!match || (topicId != null && Number(match[1]) !== validTopicId(topicId))) {
    reject('Invalid research file path', 'invalid_stored_path');
  }
  return path.join(uploadRoot(uploadDir), 'development', match[1], match[2]);
}

/**
 * Copy to a private staging area and scan before promotion. Promotion alone
 * never makes the file readable by a user; the database activation and access
 * policy must be committed separately, after the promoted file is verified.
 */
export async function prepareDevelopmentPrivateFile({
  uploadDir, sourcePath, topicId, originalName, scanner
}) {
  const root = uploadRoot(uploadDir);
  const id = validTopicId(topicId);
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    reject('Research source file is required', 'invalid_source');
  }
  const incomingDirectory = path.join(root, 'development', '.incoming');
  const absoluteSource = path.resolve(sourcePath);
  if (path.dirname(absoluteSource) !== incomingDirectory
      || !INCOMING_NAME_PATTERN.test(path.basename(absoluteSource))
      || await realpath(incomingDirectory).catch(() => '') !== incomingDirectory) {
    reject('Research source must be a private server-generated upload', 'invalid_source');
  }
  await chmod(incomingDirectory, 0o700).catch(() => {});
  const stagingDirectory = path.join(root, 'development', '.staging');
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  if (await realpath(stagingDirectory) !== stagingDirectory) {
    reject('Research staging directory is unsafe', 'storage_unavailable', 503);
  }
  await chmod(stagingDirectory, 0o700).catch(() => {});
  const stagingPath = path.join(stagingDirectory, `${randomUUID()}.tmp`);
  let inspection;
  try {
    await copyToRestrictedStaging({ sourcePath: absoluteSource, stagingPath });
    inspection = await inspectDevelopmentFile({ stagingPath, originalName, scanner });
  } catch (error) {
    await rm(stagingPath, { force: true });
    throw error;
  }

  const storedPath = storedPathFor(id);
  const absolutePath = resolveDevelopmentStoredPath({ uploadDir: root, storedPath, topicId: id });
  let state = 'staged';
  return {
    ...inspection,
    storedPath,
    async promote() {
      if (state === 'discarded') reject('Research staging was discarded', 'staging_discarded', 409);
      if (state === 'promoted') return { ...inspection, storedPath };
      const destinationDirectory = path.dirname(absolutePath);
      await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
      if (await realpath(destinationDirectory) !== destinationDirectory) {
        reject('Research destination directory is unsafe', 'storage_unavailable', 503);
      }
      await chmod(destinationDirectory, 0o700).catch(() => {});
      let linked = false;
      try {
        // The source and destination share a filesystem. link() creates an
        // immutable, no-overwrite name; there is no public URL for this path.
        await link(stagingPath, absolutePath);
        linked = true;
        const verified = await openVerifiedDevelopmentPrivateFile({
          uploadDir: root, storedPath, topicId: id,
          expectedSize: inspection.fileSize, expectedSha256: inspection.sha256
        });
        await verified.close();
        await syncDirectory(destinationDirectory);
        await rm(stagingPath);
        state = 'promoted';
        return { ...inspection, storedPath };
      } catch (error) {
        if (linked) await rm(absolutePath, { force: true });
        throw error;
      }
    },
    async discard() {
      if (state === 'promoted') {
        reject('Promoted research evidence cannot be discarded', 'already_promoted', 409);
      }
      await rm(stagingPath, { force: true });
      state = 'discarded';
    }
  };
}

/** Return the same file handle that was hashed, for a later authorized stream. */
export async function openVerifiedDevelopmentPrivateFile({
  uploadDir, storedPath, topicId, expectedSize, expectedSha256
}) {
  const absolutePath = resolveDevelopmentStoredPath({ uploadDir, storedPath, topicId });
  const root = uploadRoot(uploadDir);
  const expectedDirectory = path.join(root, 'development', String(validTopicId(topicId)));
  const actualDirectory = await realpath(path.dirname(absolutePath));
  const canonicalExpected = await realpath(expectedDirectory);
  if (actualDirectory !== canonicalExpected || canonicalExpected !== expectedDirectory) {
    reject('Research storage path is invalid', 'invalid_stored_path');
  }
  const before = await lstat(absolutePath);
  if (!before.isFile()) reject('Research file is not a regular file', 'invalid_stored_file');
  const size = Number(expectedSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > DEVELOPMENT_FILE_MAX_BYTES
      || !/^[0-9a-f]{64}$/.test(String(expectedSha256 || ''))) {
    reject('Research evidence identity is invalid', 'invalid_evidence');
  }
  const handle = await open(absolutePath, noFollowReadFlags());
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== size || opened.ino !== before.ino) {
      reject('Research file size or identity differs from its record', 'evidence_mismatch', 409);
    }
    const inspected = await hashHandle(handle);
    const after = await handle.stat();
    if (inspected.fileSize !== size || inspected.sha256 !== expectedSha256
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
      reject('Research file integrity check failed', 'evidence_mismatch', 409);
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
