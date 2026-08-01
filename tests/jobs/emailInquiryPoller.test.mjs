import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pollEmailInquiries,
  validateEmailIntakeConfig
} from '../../src/jobs/emailInquiryPoller.mjs';

function config(overrides = {}) {
  return {
    databaseUrl: 'postgres://example',
    emailIntake: {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'sales@sunkaier.com',
      password: 'app-password',
      mailbox: 'INBOX',
      maxMessages: 10,
      markSeen: true,
      ...overrides
    }
  };
}

function rawEmail(id, subject = 'RFQ') {
  return Buffer.from([
    `Message-ID: <${id}@example.com>`,
    'Date: Sat, 01 Aug 2026 04:00:00 +0000',
    'From: Alice <alice@example.com>',
    'To: sales@sunkaier.com',
    `Subject: ${subject}`,
    '',
    'Company: Acme Co',
    'Need quote.'
  ].join('\r\n'));
}

test('validateEmailIntakeConfig requires database and IMAP credentials', () => {
  assert.throws(
    () => validateEmailIntakeConfig({ databaseUrl: '', emailIntake: {} }),
    /EMAIL_INTAKE_HOST, EMAIL_INTAKE_USER, EMAIL_INTAKE_PASSWORD, DATABASE_URL/
  );
});

test('pollEmailInquiries imports unseen messages and marks them seen', async () => {
  const calls = [];
  const client = {
    async connect() {
      calls.push(['connect']);
    },
    async mailboxOpen(mailbox) {
      calls.push(['mailboxOpen', mailbox]);
    },
    async search(query, options) {
      calls.push(['search', query, options]);
      return [101, 102];
    },
    async fetchOne(uid, query, options) {
      calls.push(['fetchOne', uid, query, options]);
      return {
        uid: Number(uid),
        source: rawEmail(`rfq-${uid}`, `RFQ ${uid}`),
        internalDate: new Date('2026-08-01T04:00:00.000Z')
      };
    },
    async messageFlagsAdd(uid, flags, options) {
      calls.push(['messageFlagsAdd', uid, flags, options]);
    },
    async logout() {
      calls.push(['logout']);
    }
  };
  const created = [];
  const inquiryRepository = {
    async createInquiry(input) {
      created.push(input);
      return { id: created.length + 10, ...input };
    }
  };

  const result = await pollEmailInquiries({
    config: config(),
    inquiryRepository,
    imapClientFactory: () => client
  });

  assert.deepEqual(result, {
    scanned: 2,
    imported: [
      { uid: 101, inquiryId: 11, duplicate: false },
      { uid: 102, inquiryId: 12, duplicate: false }
    ]
  });
  assert.deepEqual(calls.filter((call) => call[0] === 'messageFlagsAdd'), [
    ['messageFlagsAdd', '101', ['\\Seen'], { uid: true }],
    ['messageFlagsAdd', '102', ['\\Seen'], { uid: true }]
  ]);
  assert.equal(created[0].source, 'email');
  assert.equal(created[0].sourceReference, 'rfq-101@example.com');
  assert.equal(created[0].companyName, 'Acme Co');
});

test('pollEmailInquiries respects maxMessages and markSeen false', async () => {
  const seen = [];
  const client = {
    async connect() {},
    async mailboxOpen() {},
    async search() {
      return [201, 202, 203];
    },
    async fetchOne(uid) {
      return { uid: Number(uid), source: rawEmail(`rfq-${uid}`) };
    },
    async messageFlagsAdd(uid) {
      seen.push(uid);
    },
    async logout() {}
  };
  const inquiryRepository = {
    async createInquiry(input) {
      return { id: Number(input.rawPayload.uid), wasDuplicate: true };
    }
  };

  const result = await pollEmailInquiries({
    config: config({ maxMessages: 1, markSeen: false }),
    inquiryRepository,
    imapClientFactory: () => client
  });

  assert.deepEqual(result.imported, [{ uid: 201, inquiryId: 201, duplicate: true }]);
  assert.deepEqual(seen, []);
});
