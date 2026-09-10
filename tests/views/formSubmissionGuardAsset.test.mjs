import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('global form guard preserves the clicked action and prevents repeat submits', async () => {
  const source = await readFile(new URL('../../src/public/assets/form-submission-guard.js', import.meta.url), 'utf8');

  assert.match(source, /event\.submitter/);
  assert.match(source, /dataset\.submitterValue/);
  assert.match(source, /form\.dataset\.submitting === 'true'/);
  assert.match(source, /control\.disabled = true/);
  assert.match(source, /searchParams\.set\('_submissionToken'/);
  assert.match(source, /button:not\(\[type\]\)/);
});

test('correspondence timeline keeps only one message expanded', async () => {
  const source = await readFile(new URL('../../src/public/assets/form-submission-guard.js', import.meta.url), 'utf8');

  assert.match(source, /details\.correspondence-item\[open\]/);
  assert.match(source, /sibling\.open = false/);
});
