import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openVerifiedDevelopmentPrivateFile, prepareDevelopmentPrivateFile,
  resolveDevelopmentStoredPath
} from '../../src/services/developmentPrivateFileStore.mjs';

const scanner = {
  async scanFile() {
    return {
      verdict: 'clean', engine: 'isolated-test-scanner',
      engineVersion: '1', signatureVersion: 'test',
      completedAt: new Date().toISOString()
    };
  }
};

test('P3c private research storage is staged, scanned and immutable by identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-private-'));
  const uploadDir = path.join(directory, 'uploads');
  const incomingDirectory = path.join(uploadDir, 'development', '.incoming');
  const sourcePath = path.join(incomingDirectory, `${randomUUID()}.tmp`);
  const content = Buffer.from('%PDF-1.7\nprivate research data\n');
  try {
    await mkdir(incomingDirectory, { recursive: true });
    await writeFile(sourcePath, content);
    const staged = await prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: 31, originalName: 'review.pdf', scanner
    });
    const destination = resolveDevelopmentStoredPath({
      uploadDir, storedPath: staged.storedPath, topicId: 31
    });
    assert.match(staged.storedPath,
      /^development\/31\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
    await staged.promote();
    assert.deepEqual(await readFile(destination), content);
    assert.equal((await lstat(destination)).isFile(), true);
    await assert.rejects(staged.discard(), (error) => error.code === 'already_promoted');
    assert.equal((await staged.promote()).sha256, staged.sha256);

    const handle = await openVerifiedDevelopmentPrivateFile({
      uploadDir, storedPath: staged.storedPath, topicId: 31,
      expectedSize: staged.fileSize, expectedSha256: staged.sha256
    });
    assert.deepEqual(await handle.readFile(), content);
    await handle.close();
    await assert.rejects(openVerifiedDevelopmentPrivateFile({
      uploadDir, storedPath: staged.storedPath, topicId: 32,
      expectedSize: staged.fileSize, expectedSha256: staged.sha256
    }), (error) => error.code === 'invalid_stored_path');
    await assert.rejects(openVerifiedDevelopmentPrivateFile({
      uploadDir, storedPath: staged.storedPath, topicId: 31,
      expectedSize: staged.fileSize, expectedSha256: '0'.repeat(64)
    }), (error) => error.code === 'evidence_mismatch');
    await writeFile(destination, Buffer.from('%PDF-1.7\ntampered\n'));
    await assert.rejects(openVerifiedDevelopmentPrivateFile({
      uploadDir, storedPath: staged.storedPath, topicId: 31,
      expectedSize: staged.fileSize, expectedSha256: staged.sha256
    }), (error) => error.code === 'evidence_mismatch');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P3c private research storage fails closed and never exposes a staging file', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-private-'));
  const uploadDir = path.join(directory, 'uploads');
  const incomingDirectory = path.join(uploadDir, 'development', '.incoming');
  const sourcePath = path.join(incomingDirectory, `${randomUUID()}.tmp`);
  try {
    await mkdir(incomingDirectory, { recursive: true });
    await writeFile(sourcePath, Buffer.from('%PDF-1.7\nsecret\n'));
    await assert.rejects(prepareDevelopmentPrivateFile({
      uploadDir, sourcePath: path.join(directory, 'outside.pdf'), topicId: 9,
      originalName: 'research.pdf', scanner
    }), (error) => error.code === 'invalid_source');
    await assert.rejects(prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: 9, originalName: 'research.pdf',
      scanner: { async scanFile() { return { verdict: 'error' }; } }
    }), (error) => error.code === 'scanner_error');
    assert.deepEqual(await readdir(path.join(uploadDir, 'development', '.staging')), []);

    const staged = await prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: 9, originalName: 'research.pdf', scanner
    });
    await staged.discard();
    await assert.rejects(staged.promote(), (error) => error.code === 'staging_discarded');
    assert.deepEqual(await readdir(path.join(uploadDir, 'development', '.staging')), []);
    const tampered = await prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: 9, originalName: 'research.pdf', scanner
    });
    const stagingDirectory = path.join(uploadDir, 'development', '.staging');
    const stagingName = (await readdir(stagingDirectory))[0];
    await writeFile(path.join(stagingDirectory, stagingName), Buffer.from('%PDF-1.7\nchanged\n'));
    await assert.rejects(tampered.promote(), (error) => error.code === 'evidence_mismatch');
    await assert.rejects(lstat(resolveDevelopmentStoredPath({
      uploadDir, storedPath: tampered.storedPath, topicId: 9
    })), { code: 'ENOENT' });
    await tampered.discard();
    const collision = await prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: 9, originalName: 'research.pdf', scanner
    });
    const collisionPath = resolveDevelopmentStoredPath({
      uploadDir, storedPath: collision.storedPath, topicId: 9
    });
    await mkdir(path.dirname(collisionPath), { recursive: true });
    await writeFile(collisionPath, Buffer.from('existing evidence'));
    await assert.rejects(collision.promote(), { code: 'EEXIST' });
    assert.deepEqual(await readFile(collisionPath), Buffer.from('existing evidence'));
    await collision.discard();
    assert.throws(() => resolveDevelopmentStoredPath({
      uploadDir, storedPath: `development/9/../${randomUUID()}`, topicId: 9
    }), (error) => error.code === 'invalid_stored_path');
    assert.throws(() => resolveDevelopmentStoredPath({
      uploadDir, storedPath: `development/9/${randomUUID()}`, topicId: 8
    }), (error) => error.code === 'invalid_stored_path');
    const symlinkPath = path.join(incomingDirectory, `${randomUUID()}.tmp`);
    try {
      await symlink(sourcePath, symlinkPath);
      await assert.rejects(prepareDevelopmentPrivateFile({
        uploadDir, sourcePath: symlinkPath, topicId: 9, originalName: 'research.pdf', scanner
      }), (error) => error.code === 'invalid_source');
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
      context.diagnostic('Windows account cannot create symlinks; this assertion runs on Linux');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
