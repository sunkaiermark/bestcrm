import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { processEmailPurgeFileJobs } from '../../src/services/emailPurgeFileCleanupService.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function createQueueRepository(initialJobs) {
  const jobs = initialJobs.map((job) => ({ status: 'pending', attemptCount: 0, ...job }));
  const failures = [];
  return {
    jobs,
    failures,
    async claimEmailPurgeFileJobs({ workerId, purgeAuditIds, limit }) {
      const claimed = jobs
        .filter((job) => job.status === 'pending'
          && (!purgeAuditIds.length || purgeAuditIds.includes(job.purgeAuditId)))
        .slice(0, limit);
      for (const job of claimed) {
        job.status = 'processing';
        job.leaseOwner = workerId;
        job.attemptCount += 1;
      }
      return claimed.map((job) => ({ ...job }));
    },
    async completeEmailPurgeFileJob({ jobId, workerId }) {
      const index = jobs.findIndex((job) => job.id === jobId && job.leaseOwner === workerId);
      if (index < 0) return false;
      jobs.splice(index, 1);
      return true;
    },
    async failEmailPurgeFileJob(input) {
      const job = jobs.find((item) => item.id === input.jobId && item.leaseOwner === input.workerId);
      if (!job) return false;
      failures.push(input);
      job.status = 'pending';
      job.leaseOwner = '';
      return true;
    },
    async countEmailPurgeFileJobs({ purgeAuditIds }) {
      return jobs.filter((job) => !purgeAuditIds.length || purgeAuditIds.includes(job.purgeAuditId)).length;
    }
  };
}

test('purge file worker verifies and removes a queued file before completing its durable job', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-purge-worker-'));
  const storedPath = 'email-raw/queued.eml';
  const content = 'raw email evidence';
  await mkdir(path.join(uploadDir, 'email-raw'), { recursive: true });
  await writeFile(path.join(uploadDir, storedPath), content);
  const repository = createQueueRepository([{
    id: 1,
    purgeAuditId: 91,
    storedPath,
    expectedSize: Buffer.byteLength(content),
    expectedSha256: sha256(content)
  }]);

  try {
    const result = await processEmailPurgeFileJobs({
      emailArchiveRepository: repository,
      uploadDir
    }, { purgeAuditIds: [91], workerId: 'worker-1' });

    assert.equal(result.completed, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.pending, 0);
    assert.equal(repository.jobs.length, 0);
    await assert.rejects(() => readFile(path.join(uploadDir, storedPath)), /ENOENT/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('purge file worker treats an already missing file as idempotent success', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-purge-missing-'));
  const repository = createQueueRepository([{
    id: 2,
    purgeAuditId: 92,
    storedPath: 'email-archive/already-gone.pdf',
    expectedSize: 10,
    expectedSha256: 'a'.repeat(64)
  }]);

  try {
    const result = await processEmailPurgeFileJobs({
      emailArchiveRepository: repository,
      uploadDir
    }, { purgeAuditIds: [92], workerId: 'worker-2' });

    assert.equal(result.completed, 1);
    assert.equal(result.alreadyMissing, 1);
    assert.equal(result.pending, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('purge file worker keeps a mismatched file and schedules a safe retry', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-purge-mismatch-'));
  const storedPath = 'email-archive/mismatch.pdf';
  const content = 'do not delete this unexpected file';
  await mkdir(path.join(uploadDir, 'email-archive'), { recursive: true });
  await writeFile(path.join(uploadDir, storedPath), content);
  const repository = createQueueRepository([{
    id: 3,
    purgeAuditId: 93,
    storedPath,
    expectedSize: Buffer.byteLength(content),
    expectedSha256: 'b'.repeat(64)
  }]);

  try {
    const result = await processEmailPurgeFileJobs({
      emailArchiveRepository: repository,
      uploadDir
    }, { purgeAuditIds: [93], workerId: 'worker-3', maxBatches: 1 });

    assert.equal(result.failed, 1);
    assert.equal(result.pending, 1);
    assert.equal(repository.failures[0].errorCode, 'file_hash_mismatch');
    assert.equal(repository.failures[0].errorDetail, 'Stored file hash did not match the database cleanup job');
    assert.equal(await readFile(path.join(uploadDir, storedPath), 'utf8'), content);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('a queued job finishes after restart when the process stopped after unlink but before job completion', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-purge-restart-'));
  const storedPath = 'email-raw/restart.eml';
  const content = 'remove once, acknowledge later';
  await mkdir(path.join(uploadDir, 'email-raw'), { recursive: true });
  await writeFile(path.join(uploadDir, storedPath), content);
  let firstAttempt = true;
  let done = false;
  const job = {
    id: 4,
    purgeAuditId: 94,
    storedPath,
    expectedSize: Buffer.byteLength(content),
    expectedSha256: sha256(content),
    attemptCount: 1
  };
  const repository = {
    async claimEmailPurgeFileJobs() {
      return done ? [] : [{ ...job }];
    },
    async completeEmailPurgeFileJob() {
      if (firstAttempt) throw new Error('database connection lost after unlink');
      done = true;
      return true;
    },
    async failEmailPurgeFileJob() {
      firstAttempt = false;
      throw new Error('process stopped before lease release');
    },
    async countEmailPurgeFileJobs() {
      return done ? 0 : 1;
    }
  };

  try {
    await assert.rejects(
      () => processEmailPurgeFileJobs({ emailArchiveRepository: repository, uploadDir }, {
        purgeAuditIds: [94], workerId: 'worker-before-restart', maxBatches: 1
      }),
      /process stopped/
    );
    await assert.rejects(() => readFile(path.join(uploadDir, storedPath)), /ENOENT/);

    const afterRestart = await processEmailPurgeFileJobs({ emailArchiveRepository: repository, uploadDir }, {
      purgeAuditIds: [94], workerId: 'worker-after-restart', maxBatches: 1
    });
    assert.equal(afterRestart.completed, 1);
    assert.equal(afterRestart.alreadyMissing, 1);
    assert.equal(afterRestart.pending, 0);
    assert.equal(done, true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('email purge worker pauses before unlink when backup write maintenance becomes active', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-purge-maintenance-'));
  const storedPath = 'email-raw/maintenance.eml';
  const content = 'preserve email evidence during backup';
  await mkdir(path.dirname(path.join(uploadDir, storedPath)), { recursive: true });
  await writeFile(path.join(uploadDir, storedPath), content);
  const repository = createQueueRepository([{
    id: 5, purgeAuditId: 95, storedPath,
    expectedSize: Buffer.byteLength(content), expectedSha256: sha256(content)
  }]);
  let maintenanceChecks = 0;
  try {
    const result = await processEmailPurgeFileJobs({
      emailArchiveRepository: repository, uploadDir
    }, {
      workerId: 'maintenance-worker',
      purgeAuditIds: [95],
      writeMaintenanceFlagPath: '/run/bestcrm/write-maintenance',
      writeMaintenanceFlagExists() {
        maintenanceChecks += 1;
        return maintenanceChecks >= 3;
      }
    });
    assert.equal(result.paused, true);
    assert.equal(result.completed, 0);
    assert.equal(result.failed, 0);
    assert.equal(repository.jobs.length, 1);
    assert.equal(repository.jobs[0].status, 'processing');
    assert.equal(await readFile(path.join(uploadDir, storedPath), 'utf8'), content);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
