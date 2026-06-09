import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('development config can use the local session secret default', () => {
  const config = loadConfig({ NODE_ENV: 'development' });

  assert.equal(config.sessionSecret, 'dev-session-secret');
});

test('production config requires an explicit session secret', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /SESSION_SECRET is required in production/
  );
});

test('production config accepts an explicit session secret', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-production-only-secret'
  });

  assert.equal(config.sessionSecret, 'a-production-only-secret');
});
