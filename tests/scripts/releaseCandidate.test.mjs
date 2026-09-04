import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertEmailFlagsDisabled,
  assertPortableShellScripts,
  assertSafeReleaseTree,
  buildReleaseCandidate,
  forbiddenReleasePath,
  validateReleaseVersion
} from '../../scripts/build-release-candidate.mjs';

test('release shell scripts must be portable LF-only files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-release-eol-test-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await writeFile(path.join(root, 'scripts', 'portable.sh'), '#!/bin/sh\necho ok\n');
    await writeFile(path.join(root, 'scripts', 'windows.sh'), '#!/bin/sh\r\necho no\r\n');
    await assert.doesNotReject(() => assertPortableShellScripts(root, ['scripts/portable.sh']));
    await assert.rejects(
      () => assertPortableShellScripts(root, ['scripts/windows.sh']),
      /must use LF line endings/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release candidate naming and tree rules reject secrets and local artifacts', () => {
  assert.equal(validateReleaseVersion('v2026.09.03-01-rc.1'), 'v2026.09.03-01-rc.1');
  assert.throws(() => validateReleaseVersion('latest'), /vYYYY/);
  for (const file of ['.env', 'config/.env.production', 'node_modules/a.js', 'uploads/customer.pdf', 'private.pem', 'bestcrm-old.zip']) {
    assert.equal(forbiddenReleasePath(file), true, file);
  }
  for (const file of ['.env.example', 'src/server.mjs', 'docs/operation-runbook.md']) {
    assert.equal(forbiddenReleasePath(file), false, file);
  }
  assert.throws(() => assertSafeReleaseTree(['package.json', 'src/server.mjs', '.env']), /forbidden/);
  assert.doesNotThrow(() => assertSafeReleaseTree(['package.json', 'src/server.mjs', '.env.example']));
});

test('release candidate requires every email feature flag to remain disabled', () => {
  assert.doesNotThrow(() => assertEmailFlagsDisabled([
    'CRM_EMAIL_CENTER_ENABLED=false',
    'EMAIL_INTAKE_ENABLED=false',
    'CRM_EMAIL_SENDING_ENABLED=false'
  ].join('\n')));
  assert.throws(() => assertEmailFlagsDisabled([
    'CRM_EMAIL_CENTER_ENABLED=true',
    'EMAIL_INTAKE_ENABLED=false',
    'CRM_EMAIL_SENDING_ENABLED=false'
  ].join('\n')), /must keep email flags false/);
});

test('release builder creates a reproducible commit-only archive and checksum manifest', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-release-test-'));
  try {
    const cwd = path.resolve(import.meta.dirname, '..', '..');
    const result = await buildReleaseCandidate({
      cwd,
      ref: 'HEAD',
      version: 'v2099.01.01-01-rc.1',
      outputDir
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    const checksum = await readFile(result.checksumPath, 'utf8');
    assert.equal(manifest.commit, result.commit);
    assert.equal(manifest.sha256, result.sha256);
    assert.equal(manifest.reproducibleArchiveVerified, true);
    assert.match(checksum, new RegExp(`^${result.sha256}  bestcrm-v2099\\.01\\.01-01-rc\\.1\\.zip`));
    assert.match(manifest.latestMigration, /037_quotation_package_documents\.sql$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
