import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../../src/utils/moduleEntry.mjs';

test('isMainModule compares file URLs with platform paths', () => {
  const modulePath = path.resolve('src/server.mjs');
  const moduleUrl = pathToFileURL(modulePath).href;

  assert.equal(isMainModule(moduleUrl, modulePath), true);
  assert.equal(isMainModule(moduleUrl, path.resolve('src/db/migrate.mjs')), false);
});

test('isMainModule returns false when no argv path exists', () => {
  assert.equal(isMainModule(pathToFileURL(path.resolve('src/server.mjs')).href, undefined), false);
});

test('isMainModule resolves a release directory symlink', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-module-entry-'));
  const realDirectory = path.join(directory, 'release');
  const aliasDirectory = path.join(directory, 'app');
  const modulePath = path.join(realDirectory, 'entry.mjs');
  try {
    await mkdir(realDirectory);
    await writeFile(modulePath, '// fixture\n', 'utf8');
    await symlink(
      realDirectory,
      aliasDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    assert.equal(
      isMainModule(pathToFileURL(modulePath).href, path.join(aliasDirectory, 'entry.mjs')),
      true
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
