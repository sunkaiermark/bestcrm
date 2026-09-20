import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processInquiryAttachmentPurgeFileJobs } from '../../src/services/inquiryAttachmentPurgeFileCleanupService.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createQueueRepository(initialJobs) {
  const jobs = initialJobs.map((job) => ({ status: 'pending', attemptCount: 0, ...job }));
  const failures = [];
  return {
    jobs,
    failures,
    async claimInquiryAttachmentPurgeJobs({ workerId, purgeAuditIds, limit }) {
      const claimed = jobs.filter((job) => job.status === 'pending'
        && (!purgeAuditIds.length || purgeAuditIds.includes(job.purgeAuditId))).slice(0, limit);
      for (const job of claimed) {
        job.status = 'processing';
        job.leaseOwner = workerId;
        job.attemptCount += 1;
      }
      return claimed.map((job) => ({ ...job }));
    },
    async completeInquiryAttachmentPurgeJob({ jobId, workerId }) {
      const index = jobs.findIndex((job) => job.id === jobId && job.leaseOwner === workerId);
      if (index < 0) return false;
      jobs.splice(index, 1);
      return true;
    },
    async failInquiryAttachmentPurgeJob(input) {
      const job = jobs.find((item) => item.id === input.jobId && item.leaseOwner === input.workerId);
      if (!job) return false;
      failures.push(input);
      job.status = 'pending';
      job.leaseOwner = '';
      return true;
    },
    async countInquiryAttachmentPurgeJobs({ purgeAuditIds }) {
      return jobs.filter((job) => !purgeAuditIds.length || purgeAuditIds.includes(job.purgeAuditId)).length;
    }
  };
}

test('inquiry purge worker verifies exact bytes before removing a queued file', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-purge-'));
  const storedPath = 'email-inquiries/queued.pdf';
  const content = 'verified provisional evidence';
  await mkdir(path.dirname(path.join(uploadDir, storedPath)), { recursive: true });
  await writeFile(path.join(uploadDir, storedPath), content);
  const repository = createQueueRepository([{
    id: 1, purgeAuditId: 91, storedPath,
    expectedSize: Buffer.byteLength(content), expectedSha256: sha256(content)
  }]);
  try {
    const result = await processInquiryAttachmentPurgeFileJobs({
      attachmentIntegrityRepository: repository, uploadDir
    }, { workerId: 'worker-1', purgeAuditIds: [91] });
    assert.equal(result.completed, 1);
    assert.equal(result.pending, 0);
    await assert.rejects(() => readFile(path.join(uploadDir, storedPath)), /ENOENT/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('inquiry purge worker treats an already missing intended file as idempotent success', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-purge-missing-'));
  const repository = createQueueRepository([{
    id: 2, purgeAuditId: 92, storedPath: 'email-inquiries/missing.pdf',
    expectedSize: 5, expectedSha256: 'a'.repeat(64)
  }]);
  try {
    const result = await processInquiryAttachmentPurgeFileJobs({
      attachmentIntegrityRepository: repository, uploadDir
    }, { workerId: 'worker-2', purgeAuditIds: [92] });
    assert.equal(result.completed, 1);
    assert.equal(result.alreadyMissing, 1);
    assert.equal(result.pending, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('inquiry purge worker fails closed on size or hash mismatch', async () => {
  for (const mismatch of ['size', 'hash']) {
    const uploadDir = await mkdtemp(path.join(tmpdir(), `bestcrm-inquiry-purge-${mismatch}-`));
    const storedPath = `email-inquiries/${mismatch}.pdf`;
    const content = 'keep unexpected bytes';
    await mkdir(path.dirname(path.join(uploadDir, storedPath)), { recursive: true });
    await writeFile(path.join(uploadDir, storedPath), content);
    const repository = createQueueRepository([{
      id: mismatch === 'size' ? 3 : 4,
      purgeAuditId: 93,
      storedPath,
      expectedSize: mismatch === 'size' ? Buffer.byteLength(content) + 1 : Buffer.byteLength(content),
      expectedSha256: mismatch === 'hash' ? 'b'.repeat(64) : sha256(content)
    }]);
    try {
      const result = await processInquiryAttachmentPurgeFileJobs({
        attachmentIntegrityRepository: repository, uploadDir
      }, { workerId: `worker-${mismatch}`, purgeAuditIds: [93], maxBatches: 1 });
      assert.equal(result.failed, 1);
      assert.equal(repository.failures[0].errorCode, `file_${mismatch}_mismatch`);
      assert.equal(await readFile(path.join(uploadDir, storedPath), 'utf8'), content);
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
  }
});

test('inquiry purge job resumes after a crash between unlink and database acknowledgement', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-purge-restart-'));
  const storedPath = 'email-inquiries/restart.pdf';
  const content = 'unlink once acknowledge later';
  await mkdir(path.dirname(path.join(uploadDir, storedPath)), { recursive: true });
  await writeFile(path.join(uploadDir, storedPath), content);
  let firstAttempt = true;
  let done = false;
  const job = {
    id: 5, purgeAuditId: 94, storedPath,
    expectedSize: Buffer.byteLength(content), expectedSha256: sha256(content), attemptCount: 1
  };
  const repository = {
    async claimInquiryAttachmentPurgeJobs() { return done ? [] : [{ ...job }]; },
    async completeInquiryAttachmentPurgeJob() {
      if (firstAttempt) throw new Error('database connection lost after unlink');
      done = true;
      return true;
    },
    async failInquiryAttachmentPurgeJob() {
      firstAttempt = false;
      throw new Error('process stopped before lease release');
    },
    async countInquiryAttachmentPurgeJobs() { return done ? 0 : 1; }
  };
  try {
    await assert.rejects(() => processInquiryAttachmentPurgeFileJobs({
      attachmentIntegrityRepository: repository, uploadDir
    }, { workerId: 'before-restart', purgeAuditIds: [94], maxBatches: 1 }), /process stopped/);
    const afterRestart = await processInquiryAttachmentPurgeFileJobs({
      attachmentIntegrityRepository: repository, uploadDir
    }, { workerId: 'after-restart', purgeAuditIds: [94], maxBatches: 1 });
    assert.equal(afterRestart.completed, 1);
    assert.equal(afterRestart.alreadyMissing, 1);
    assert.equal(done, true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
