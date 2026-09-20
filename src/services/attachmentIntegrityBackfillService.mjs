import { inspectStoredAttachmentFile } from './attachmentFileService.mjs';

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function failureReason(error) {
  if (error?.code === 'invalid_stored_path') return 'invalid_stored_path';
  if (error?.code === 'ENOENT') return 'missing_file';
  if (error?.code === 'not_a_file') return 'not_a_file';
  return 'file_read_error';
}

function failure(candidate, reason) {
  return {
    model: candidate.model,
    id: Number(candidate.id),
    storedPath: candidate.storedPath,
    reason
  };
}

export async function backfillLegacyAttachmentHashes({
  repository,
  uploadDir,
  apply = false,
  batchSize = 100
}) {
  if (typeof repository?.listLegacyAttachmentHashCandidates !== 'function'
    || typeof repository?.backfillAttachmentHash !== 'function') {
    throw new Error('Attachment integrity repository is not configured');
  }
  const limit = positiveInteger(batchSize, 100, 1000);
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: 0,
    eligible: 0,
    updated: 0,
    refused: 0,
    batches: 0,
    failures: []
  };
  let afterModel = '';
  let afterId = 0;

  while (true) {
    const candidates = await repository.listLegacyAttachmentHashCandidates({
      afterModel,
      afterId,
      limit
    });
    if (!candidates.length) break;
    result.batches += 1;
    for (const candidate of candidates) {
      result.scanned += 1;
      let inspected;
      try {
        inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath: candidate.storedPath });
      } catch (error) {
        result.refused += 1;
        result.failures.push(failure(candidate, failureReason(error)));
        continue;
      }
      if (Number(inspected.fileSize) !== Number(candidate.fileSize)) {
        result.refused += 1;
        result.failures.push(failure(candidate, 'file_size_mismatch'));
        continue;
      }
      result.eligible += 1;
      if (!apply) continue;
      const updated = await repository.backfillAttachmentHash({
        model: candidate.model,
        id: Number(candidate.id),
        expectedStoredPath: candidate.storedPath,
        expectedFileSize: Number(candidate.fileSize),
        sha256: inspected.sha256
      });
      if (updated) {
        result.updated += 1;
      } else {
        result.refused += 1;
        result.failures.push(failure(candidate, 'identity_changed'));
      }
    }
    const last = candidates.at(-1);
    afterModel = last.model;
    afterId = Number(last.id);
    if (candidates.length < limit) break;
  }
  return result;
}
