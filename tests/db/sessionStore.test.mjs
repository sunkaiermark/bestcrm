import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSessionStore } from '../../src/db/sessionStore.mjs';

const migrationPath = new URL('../../src/db/migrations/002_session_store.sql', import.meta.url);

test('PostgreSQL session store exposes express-session methods', () => {
  const fakePool = {
    async query() {
      return { rows: [] };
    },
    on() {}
  };

  const store = createSessionStore(fakePool);

  assert.equal(typeof store.get, 'function');
  assert.equal(typeof store.set, 'function');
  assert.equal(typeof store.destroy, 'function');
});

test('session migration declares connect-pg-simple compatible table', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS "session"/);
  assert.match(sql, /"sid" varchar NOT NULL/);
  assert.match(sql, /"sess" json NOT NULL/);
  assert.match(sql, /"expire" timestamp\(6\) NOT NULL/);
  assert.match(sql, /PRIMARY KEY \("sid"\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "IDX_session_expire"/);
});
