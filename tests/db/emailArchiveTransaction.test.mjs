import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailArchiveTransaction } from '../../src/db/emailArchiveTransaction.mjs';

test('email archive transaction exposes scoped repositories and commits', async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql).trim().split(/\s+/)[0]);
      return { rows: [] };
    },
    release() { calls.push('RELEASE'); }
  };
  const transaction = createEmailArchiveTransaction({
    async connect() { calls.push('CONNECT'); return client; }
  });

  const result = await transaction(async (repositories) => {
    assert.equal(typeof repositories.emailArchiveRepository.createInboundMessage, 'function');
    assert.equal(typeof repositories.contactRepository.findUniqueByEmail, 'function');
    assert.equal(typeof repositories.inquiryRepository.createInquiry, 'function');
    assert.equal(typeof repositories.quotationPackageRepository.markSent, 'function');
    return 'archived';
  });

  assert.equal(result, 'archived');
  assert.deepEqual(calls, ['CONNECT', 'BEGIN', 'COMMIT', 'RELEASE']);
});

test('email archive transaction rolls back on failure', async () => {
  const calls = [];
  const client = {
    async query(sql) { calls.push(String(sql).trim().split(/\s+/)[0]); return { rows: [] }; },
    release() { calls.push('RELEASE'); }
  };
  const transaction = createEmailArchiveTransaction({ async connect() { calls.push('CONNECT'); return client; } });

  await assert.rejects(() => transaction(async () => {
    throw new Error('archive failed');
  }), /archive failed/);
  assert.deepEqual(calls, ['CONNECT', 'BEGIN', 'ROLLBACK', 'RELEASE']);
});
