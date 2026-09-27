import { openVerifiedDevelopmentPrivateFile } from './developmentPrivateFileStore.mjs';

export class DevelopmentMaterialFileError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'DevelopmentMaterialFileError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new DevelopmentMaterialFileError('Invalid research file request', 'invalid_request', 422);
  }
  return id;
}

const previewableMimeTypes = new Set(['application/pdf', 'image/png', 'image/jpeg']);

/**
 * Authorize, verify the exact stored bytes, then record the access before a
 * caller may stream from the returned file handle. A future HTTP route must
 * close that handle after streaming and must not expose storedPath in a URL.
 */
export async function openDevelopmentMaterialFile({
  repository, uploadDir, actor, topicId, versionId, accessKind = 'download'
}) {
  if (actor?.isActive !== true) {
    throw new DevelopmentMaterialFileError('Active login required', 'unauthorized', 403);
  }
  const actorUserId = positiveId(actor.id);
  const targetTopicId = positiveId(topicId);
  const targetVersionId = positiveId(versionId);
  if (!['download', 'preview'].includes(accessKind)) {
    throw new DevelopmentMaterialFileError('Invalid research file request', 'invalid_request', 422);
  }
  const version = await repository.findReadableVersion({
    topicId: targetTopicId, versionId: targetVersionId, actorUserId
  });
  if (!version) {
    throw new DevelopmentMaterialFileError('Research file not found', 'not_found', 404);
  }
  if (accessKind === 'preview' && !previewableMimeTypes.has(version.mimeType)) {
    throw new DevelopmentMaterialFileError('Preview is not available for this format',
      'preview_unavailable', 415);
  }
  let handle;
  try {
    handle = await openVerifiedDevelopmentPrivateFile({
      uploadDir, storedPath: version.storedPath, topicId: targetTopicId,
      expectedSize: version.fileSize, expectedSha256: version.sha256
    });
    await repository.recordFileAccess({
      versionId: targetVersionId, actorUserId, accessKind
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === 'P0001'
        && /Research file access is not authorized/.test(String(error.message || ''))) {
      throw new DevelopmentMaterialFileError('Research file not found', 'not_found', 404);
    }
    if (['ENOENT', 'EACCES', 'evidence_mismatch', 'invalid_stored_path',
      'invalid_stored_file', 'invalid_evidence'].includes(error?.code)) {
      throw new DevelopmentMaterialFileError(
        'Research file is unavailable or failed integrity verification',
        'evidence_unavailable', 409
      );
    }
    throw error;
  }
  return {
    handle,
    originalName: version.originalName,
    mimeType: version.mimeType,
    fileSize: version.fileSize,
    sha256: version.sha256
  };
}
