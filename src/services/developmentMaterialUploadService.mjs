import {
  discardDevelopmentIncomingFile, prepareDevelopmentPrivateFile
} from './developmentPrivateFileStore.mjs';

function positiveId(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new TypeError('Invalid research upload identity');
  }
  return number;
}

/**
 * Local P3c coordinator; deliberately not mounted as an HTTP route.
 * The caller supplies a server-generated .incoming source. This coordinator
 * cleans it after a completed/failed attempt; a process crash leaves it for
 * the read-only stale-temporary-file recovery audit.
 * An error after promotion may mean COMMIT reached PostgreSQL; retaining the
 * private file is safer than deleting evidence that may already be active.
 * The read-only recovery audit identifies any unregistered promoted file.
 */
export async function registerDevelopmentMaterialUpload({
  repository, uploadDir, sourcePath, topicId, materialId,
  actor, originalName, accessClass, scanner
}) {
  if (actor?.isActive !== true) throw new TypeError('Active login required');
  const actorUserId = positiveId(actor.id);
  const targetTopicId = positiveId(topicId);
  const targetMaterialId = positiveId(materialId);
  if (!['internal', 'restricted'].includes(accessClass)) {
    throw new TypeError('Research access class is required');
  }
  if (!repository || typeof repository.registerScannedVersion !== 'function') {
    throw new TypeError('Research file repository is unavailable');
  }

  try {
    const prepared = await prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: targetTopicId, originalName, scanner
    });
    let promoted = false;
    try {
      return await repository.registerScannedVersion({
        topicId: targetTopicId, materialId: targetMaterialId, actorUserId,
        accessClass, prepared,
        promote: async () => {
          await prepared.promote();
          promoted = true;
        }
      });
    } finally {
      if (!promoted) await prepared.discard();
    }
  } finally {
    // A failure here must not turn a committed upload into a reported failure
    // (which could cause a retry and duplicate evidence). The audit reports
    // any source that remains after an OS-level cleanup failure.
    await discardDevelopmentIncomingFile({ uploadDir, sourcePath }).catch(() => {});
  }
}
