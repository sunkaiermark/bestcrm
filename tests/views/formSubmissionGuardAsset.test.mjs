import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

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

test('global form guard reads the action attribute when named controls shadow form.action', async () => {
  const source = await readFile(new URL('../../src/public/assets/form-submission-guard.js', import.meta.url), 'utf8');
  const tokenField = { value: 'email_submission_token_12345' };
  const attributes = new Map([
    ['action', '/email-center/messages'],
    ['method', 'post']
  ]);
  const form = {
    action: { toString: () => '[object RadioNodeList]' },
    dataset: {},
    querySelector(selector) {
      return selector === 'input[name="_submissionToken"]' ? tokenField : null;
    },
    querySelectorAll() {
      return [];
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    addEventListener() {}
  };

  runInNewContext(source, {
    URL,
    document: {
      forms: [form],
      documentElement: { lang: 'en' },
      querySelectorAll() {
        return [];
      }
    },
    location: new URL('https://crm.sunkaier.com/email-center/compose'),
    addEventListener() {}
  });

  assert.equal(
    attributes.get('action'),
    '/email-center/messages?_submissionToken=email_submission_token_12345'
  );
  assert.doesNotMatch(attributes.get('action'), /RadioNodeList/);
});
