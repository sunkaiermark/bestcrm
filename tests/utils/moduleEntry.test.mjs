import test from 'node:test';
import assert from 'node:assert/strict';
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
