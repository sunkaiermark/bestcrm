import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { inspectStoredAttachmentFile } from './attachmentFileService.mjs';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 20;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_INTERVAL_MS = 60_000;

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function text(value) {
  return String(value || '').trim();
}

function cleanupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  return text(error?.code || error?.name || 'cleanup_failed').slice(0, 80);
}

function safeErrorDetail(error) {
  const code = safeErrorCode(error);
  if (code === 'file_size_mismatch') return 'Stored file size did not match the database cleanup job';
  if (code === 'file_hash_mismatch') return 'Stored file hash did not match the database cleanup job';
  if (code === 'invalid_stored_path') return 'Stored file path was outside the configured upload directory';
  if (code === 'not_a_file') return 'Stored path was not a regular file';
  return 'Stored inquiry attachment could not be removed';
}

async function verifyAndRemoveFile(uploadDir, job) {
  let inspected;
  try {
    inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath: job.storedPath });
  } catch (error) {
    if (error?.code === 'ENOENT') return { alreadyMissing: true };
    throw error;
  }
  if (Number(inspected.fileSize) !== Number(job.expectedSize)) {
    throw cleanupError('file_size_mismatch', 'Stored file size mismatch');
  }
  if (text(inspected.sha256).toLowerCase() !== text(job.expectedSha256).toLowerCase()) {
    throw cleanupError('file_hash_mismatch', 'Stored file hash mismatch');
  }
  await rm(inspected.absolutePath);
  return { alreadyMissing: false };
}

export function supportsInquiryAttachmentPurgeFileCleanup(repository) {
  return Boolean(
    repository
    && typeof repository.claimInquiryAttachmentPurgeJobs === 'function'
    && typeof repository.completeInquiryAttachmentPurgeJob === 'function'
    && typeof repository.failInquiryAttachmentPurgeJob === 'function'
  );
}

export async function processInquiryAttachmentPurgeFileJobs(dependencies, options = {}) {
  const repository = dependencies?.attachmentIntegrityRepository;
  if (!supportsInquiryAttachmentPurgeFileCleanup(repository)) {
    throw cleanupError('cleanup_queue_unavailable', 'Inquiry attachment cleanup queue is unavailable');
  }
  const uploadDir = dependencies.uploadDir || './var/uploads';
  const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE, 200);
  const maxBatches = positiveInteger(options.maxBatches, DEFAULT_MAX_BATCHES, 200);
  const leaseSeconds = positiveInteger(options.leaseSeconds, DEFAULT_LEASE_SECONDS, 3600);
  const workerId = text(options.workerId) || randomUUID();
  const purgeAuditIds = Array.isArray(options.purgeAuditIds)
    ? [...new Set(options.purgeAuditIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  const result = {
    claimed: 0,
    completed: 0,
    alreadyMissing: 0,
    failed: 0,
    failures: []
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const jobs = await repository.claimInquiryAttachmentPurgeJobs({
      workerId,
      limit: batchSize,
      leaseSeconds,
      purgeAuditIds
    });
    if (!jobs.length) break;
    result.claimed += jobs.length;
    for (const job of jobs) {
      try {
        const removal = await verifyAndRemoveFile(uploadDir, job);
        const completed = await repository.completeInquiryAttachmentPurgeJob({
          jobId: job.id,
          workerId
        });
        if (!completed) {
          result.failed += 1;
          result.failures.push({ jobId: job.id, reason: 'cleanup_lease_changed' });
          continue;
        }
        result.completed += 1;
        if (removal.alreadyMissing) result.alreadyMissing += 1;
      } catch (error) {
        const retryDelaySeconds = Math.min(
          3600,
          30 * (2 ** Math.min(Math.max(Number(job.attemptCount || 1) - 1, 0), 7))
        );
        await repository.failInquiryAttachmentPurgeJob({
          jobId: job.id,
          workerId,
          errorCode: safeErrorCode(error),
          errorDetail: safeErrorDetail(error),
          retryDelaySeconds
        });
        result.failed += 1;
        result.failures.push({ jobId: job.id, reason: safeErrorCode(error) });
      }
    }
  }
  if (typeof repository.countInquiryAttachmentPurgeJobs === 'function') {
    result.pending = await repository.countInquiryAttachmentPurgeJobs({ purgeAuditIds });
  }
  return result;
}

export function startInquiryAttachmentPurgeFileCleanupLoop(dependencies, options = {}) {
  const intervalMs = positiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS, 3_600_000);
  const logger = options.logger || console;
  let stopped = false;
  let running = false;

  const runNow = async () => {
    if (stopped || running) return null;
    running = true;
    try {
      const result = await processInquiryAttachmentPurgeFileJobs(dependencies, options);
      if (result.failed > 0 || result.pending > 0) {
        logger.warn?.(JSON.stringify({
          event: 'inquiry_attachment_purge_file_cleanup_deferred',
          failed: result.failed,
          pending: Number(result.pending || 0)
        }));
      }
      return result;
    } catch (error) {
      logger.error?.(JSON.stringify({
        event: 'inquiry_attachment_purge_file_cleanup_failed',
        code: safeErrorCode(error)
      }));
      return null;
    } finally {
      running = false;
    }
  };

  queueMicrotask(runNow);
  const timer = setInterval(runNow, intervalMs);
  timer.unref?.();
  return {
    runNow,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}
