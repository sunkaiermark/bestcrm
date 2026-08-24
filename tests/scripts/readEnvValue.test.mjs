import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { parseEnvText, readEnvValue } from '../../scripts/read-env-value.mjs';

test('parseEnvText parses dotenv values without executing shell syntax', () => {
  const values = parseEnvText([
    '# production settings',
    'DATABASE_URL="postgres://crm:secret@db.internal:5432/bestcrm?sslmode=require"',
    "SINGLE_QUOTED='literal value' # retained as data",
    'export EMPTY=',
    'SHELL_PAYLOAD=$(touch /tmp/must-not-run)',
    'EQUALS=a=b=c',
  ].join('\r\n'));

  assert.equal(values.get('DATABASE_URL'), 'postgres://crm:secret@db.internal:5432/bestcrm?sslmode=require');
  assert.equal(values.get('SINGLE_QUOTED'), 'literal value');
  assert.equal(values.get('EMPTY'), '');
  assert.equal(values.get('SHELL_PAYLOAD'), '$(touch /tmp/must-not-run)');
  assert.equal(values.get('EQUALS'), 'a=b=c');
});

test('readEnvValue returns only the requested value', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-env-reader-'));
  const envPath = path.join(directory, 'bestcrm.env');
  try {
    await writeFile(envPath, 'DATABASE_URL=postgres://localhost/bestcrm\nSECRET=do-not-print\n', 'utf8');
    assert.equal(readEnvValue(envPath, 'DATABASE_URL'), 'postgres://localhost/bestcrm');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI prints the requested value and fails closed for missing keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-env-reader-cli-'));
  const envPath = path.join(directory, 'bestcrm.env');
  const scriptPath = path.resolve('scripts/read-env-value.mjs');
  try {
    await writeFile(envPath, 'DATABASE_URL="postgres://localhost/bestcrm"\n', 'utf8');

    const success = spawnSync(process.execPath, [scriptPath, envPath, 'DATABASE_URL'], { encoding: 'utf8' });
    assert.equal(success.status, 0);
    assert.equal(success.stdout, 'postgres://localhost/bestcrm');
    assert.equal(success.stderr, '');

    const missing = spawnSync(process.execPath, [scriptPath, envPath, 'MISSING_KEY'], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, '');
    assert.match(missing.stderr, /Required environment key is missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
