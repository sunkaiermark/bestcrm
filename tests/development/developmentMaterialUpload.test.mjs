import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClamAvScanner } from '../../src/services/emailMalwareScannerService.mjs';
import { registerDevelopmentMaterialUpload } from '../../src/services/developmentMaterialUploadService.mjs';
import { auditDevelopmentMaterialRecovery } from '../../src/services/developmentMaterialRecoveryService.mjs';
import { resolveDevelopmentStoredPath } from '../../src/services/developmentPrivateFileStore.mjs';

const actor = { id: 7, isActive: true };
const pdf = Buffer.from('%PDF-1.7\nresearch data\n');

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-upload-'));
  const uploadDir = path.join(directory, 'uploads');
  const incoming = path.join(uploadDir, 'development', '.incoming');
  await mkdir(incoming, { recursive: true });
  const sourcePath = path.join(incoming, `${randomUUID()}.tmp`);
  await writeFile(sourcePath, pdf);
  return { directory, uploadDir, sourcePath };
}

const scanner = {
  async scanFile() {
    return { verdict: 'clean', engine: 'isolated-test-scanner',
      engineVersion: '1', signatureVersion: 'test',
      completedAt: new Date().toISOString() };
  }
};

test('P3c upload coordinator promotes only after a clean scan and preserves uncertain commit', async () => {
  const { directory, uploadDir, sourcePath } = await fixture();
  const records = [];
  const repository = {
    async registerScannedVersion({ prepared, promote }) {
      await promote();
      records.push({ versionId: 42, topicId: 9, storedPath: prepared.storedPath,
        fileSize: prepared.fileSize, sha256: prepared.sha256, activated: true });
      return { id: 42, versionNo: 1 };
    },
    async listVersionStorageRecords() { return records; }
  };
  try {
    assert.deepEqual(await registerDevelopmentMaterialUpload({
      repository, uploadDir, sourcePath, topicId: 9, materialId: 10,
      actor, originalName: 'result.pdf', accessClass: 'restricted', scanner
    }), { id: 42, versionNo: 1 });
    assert.deepEqual(await readFile(resolveDevelopmentStoredPath({
      uploadDir, storedPath: records[0].storedPath, topicId: 9
    })), pdf);
    await assert.rejects(access(sourcePath), { code: 'ENOENT' });
    const clean = await auditDevelopmentMaterialRecovery({ repository, uploadDir });
    assert.equal(clean.ok, true);
    assert.equal(clean.activated, 1);

    const secondSource = path.join(uploadDir, 'development', '.incoming', `${randomUUID()}.tmp`);
    await writeFile(secondSource, pdf);
    let uncertainPath;
    await assert.rejects(registerDevelopmentMaterialUpload({
      repository: {
        async registerScannedVersion({ prepared, promote }) {
          uncertainPath = prepared.storedPath;
          await promote();
          throw new Error('COMMIT response lost');
        }
      },
      uploadDir, sourcePath: secondSource, topicId: 9, materialId: 10,
      actor, originalName: 'second.pdf', accessClass: 'internal', scanner
    }), /COMMIT response lost/);
    assert.deepEqual(await readFile(resolveDevelopmentStoredPath({
      uploadDir, storedPath: uncertainPath, topicId: 9
    })), pdf);
    await assert.rejects(access(secondSource), { code: 'ENOENT' });
    const uncertain = await auditDevelopmentMaterialRecovery({ repository, uploadDir });
    assert.equal(uncertain.ok, false);
    assert.deepEqual(uncertain.unregisteredPrivateFiles.map((item) => item.storedPath),
      [uncertainPath]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P3c upload failures do not leave staged or readable files', async () => {
  const { directory, uploadDir, sourcePath } = await fixture();
  let databaseCalls = 0;
  const repository = {
    async registerScannedVersion() { databaseCalls += 1; }
  };
  const params = { repository, uploadDir, sourcePath, topicId: 9, materialId: 10,
    actor, originalName: 'research.pdf', accessClass: 'internal' };
  try {
    await assert.rejects(registerDevelopmentMaterialUpload({ ...params, scanner: null }),
      (error) => error.code === 'scanner_unavailable');
    await writeFile(sourcePath, pdf);
    await assert.rejects(registerDevelopmentMaterialUpload({ ...params, scanner: {
      async scanFile() { return { verdict: 'error' }; }
    } }), (error) => error.code === 'scanner_error');
    assert.equal(databaseCalls, 0);
    assert.deepEqual(await readdir(path.join(uploadDir, 'development', '.staging')), []);

    await writeFile(sourcePath, pdf);
    await assert.rejects(registerDevelopmentMaterialUpload({
      ...params, scanner,
      repository: { async registerScannedVersion() { throw new Error('quota rejected'); } }
    }), /quota rejected/);
    assert.deepEqual(await readdir(path.join(uploadDir, 'development', '.staging')), []);
    const audit = await auditDevelopmentMaterialRecovery({
      repository: { async listVersionStorageRecords() { return []; } }, uploadDir
    });
    assert.equal(audit.unregisteredPrivateFiles.length, 0);
    assert.equal(audit.temporaryFileCounts.incoming, 0);
    await writeFile(sourcePath, pdf);
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(sourcePath, oldDate, oldDate);
    const interrupted = await auditDevelopmentMaterialRecovery({
      repository: { async listVersionStorageRecords() { return []; } }, uploadDir
    });
    assert.equal(interrupted.ok, false);
    assert.equal(interrupted.staleTemporaryFiles.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P3c recovery audit flags a durable version without activation', async () => {
  const { directory, uploadDir } = await fixture();
  try {
    const audit = await auditDevelopmentMaterialRecovery({
      repository: { async listVersionStorageRecords() {
        return [{ versionId: 99, topicId: 9,
          storedPath: `development/9/${randomUUID()}`,
          fileSize: pdf.length, sha256: '0'.repeat(64), activated: false }];
      } },
      uploadDir
    });
    assert.equal(audit.ok, false);
    assert.deepEqual(audit.unactivatedVersions, [99]);
    assert.deepEqual(audit.unavailableActivated, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P3c real ClamAV adapter fails closed on unavailable scanner, timeout or signature failure', async () => {
  const { directory, uploadDir, sourcePath } = await fixture();
  const repository = { async registerScannedVersion() {
    throw new Error('Database must not be called when scanner is unsafe');
  } };
  const params = { repository, uploadDir, sourcePath, topicId: 9, materialId: 10,
    actor, originalName: 'research.pdf', accessClass: 'internal' };
  try {
    for (const scannerError of [
      Object.assign(new Error('missing scanner'), { code: 'ENOENT' }),
      Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' })
    ]) {
      await writeFile(sourcePath, pdf);
      const failedScanner = createClamAvScanner({ execFileImpl: async (_command, args) => {
        if (args[0] === '--version') return { stdout: 'ClamAV 1.4.2/27999' };
        throw scannerError;
      } });
      await assert.rejects(registerDevelopmentMaterialUpload({
        ...params, scanner: failedScanner
      }), (error) => error.code === 'scanner_error');
    }
    for (const versionOutput of [null,
      'VERSION command disabled in clamd, printing the local version.\nClamAV 1.5.3']) {
      await writeFile(sourcePath, pdf);
      const unknownSignatures = createClamAvScanner({ execFileImpl: async (_command, args) => {
        if (args[0] === '--version') {
          if (versionOutput === null) throw new Error('version unavailable');
          return { stdout: versionOutput, code: 0 };
        }
        return { stdout: '', code: 0 };
      } });
      await assert.rejects(registerDevelopmentMaterialUpload({
        ...params, scanner: unknownSignatures
      }), (error) => error.code === 'scanner_error');
    }
    assert.deepEqual(await readdir(path.join(uploadDir, 'development', '.staging')), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
