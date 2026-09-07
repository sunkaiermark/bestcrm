import test from 'node:test';
import assert from 'node:assert/strict';
import { previewEmailRawBackfill } from '../../src/jobs/emailRawBackfillPreview.mjs';

test('raw email backfill preview is read-only and compares provider UIDs with database coverage', async () => {
  const calls = [];
  const client = {
    mailbox: { uidValidity: 44n },
    async connect() { calls.push('connect'); },
    async mailboxOpen(mailbox) { calls.push(['open', mailbox]); },
    async search(query, options) { calls.push(['search', query, options]); return [4, 1, 3, 2]; },
    async fetchOne() { assert.fail('preview must not fetch message content'); },
    async messageFlagsAdd() { assert.fail('preview must not change mailbox flags'); },
    async logout() { calls.push('logout'); }
  };
  const queryCalls = [];
  const queryTarget = {
    async query(sql, params) {
      queryCalls.push({ sql: String(sql), params });
      return queryCalls.length === 1
        ? { rows: [{ provider_uid: '2' }, { provider_uid: '4' }] }
        : { rows: [{ inbound_messages: 10, inbound_missing_raw: 8 }] };
    }
  };
  const config = {
    databaseUrl: 'postgres://example',
    emailIntake: {
      host: 'imap.example.com', user: 'sales@sunkaier.com', password: 'secret',
      mailbox: 'INBOX', mailboxKey: 'sales@sunkaier.com'
    }
  };

  const result = await previewEmailRawBackfill({ config, queryTarget, imapClientFactory: () => client });
  assert.deepEqual(result, {
    mode: 'read_only', mailbox: 'INBOX', uidValidity: '44', providerMessages: 4,
    indexedRawMessages: 2, missingRawMessages: 2, newestMissingUid: 3, oldestMissingUid: 1,
    inboundMessages: 10, inboundMissingRaw: 8
  });
  assert.deepEqual(calls, [
    'connect', ['open', 'INBOX'], ['search', { uid: '1:*' }, { uid: true }], 'logout'
  ]);
  assert.deepEqual(queryCalls[0].params, ['sales@sunkaier.com', 'INBOX', '44']);
});
