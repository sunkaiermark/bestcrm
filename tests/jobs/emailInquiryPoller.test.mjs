import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    },
    uploadDir: overrides.uploadDir || './var/uploads',
    maxUploadMb: overrides.maxUploadMb || 25
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

function rawEmailWithAttachment(id) {
  return Buffer.from([
    `Message-ID: <${id}@example.com>`,
    'Date: Sat, 01 Aug 2026 04:00:00 +0000',
    'From: Alice <alice@example.com>',
    'To: sales@sunkaier.com',
    'Subject: RFQ with attachment',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="bestcrm-test-boundary"',
    '',
    '--bestcrm-test-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Company: Acme Co',
    'Need quote with attached process data.',
    '--bestcrm-test-boundary',
    'Content-Type: application/pdf; name="process.pdf"',
    'Content-Disposition: attachment; filename="process.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('fake-pdf-content').toString('base64'),
    '--bestcrm-test-boundary--'
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
      { uid: 101, inquiryId: 11, duplicate: false, attachments: 0, skippedAttachments: 0 },
      { uid: 102, inquiryId: 12, duplicate: false, attachments: 0, skippedAttachments: 0 }
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

  assert.deepEqual(result.imported, [{ uid: 201, inquiryId: 201, duplicate: true, attachments: 0, skippedAttachments: 0 }]);
  assert.deepEqual(seen, []);
});

test('pollEmailInquiries stores email attachment files in the inquiry attachment repository', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-'));
  const createdAttachments = [];
  const client = {
    async connect() {},
    async mailboxOpen() {},
    async search() {
      return [301];
    },
    async fetchOne(uid) {
      return { uid: Number(uid), source: rawEmailWithAttachment(`rfq-${uid}`) };
    },
    async messageFlagsAdd() {},
    async logout() {}
  };
  const inquiryRepository = {
    async createInquiry(input) {
      return { id: 88, ...input };
    }
  };
  const inquiryAttachmentRepository = {
    async listByInquiry() {
      return [];
    },
    async createAttachment(input) {
      createdAttachments.push(input);
      return { id: createdAttachments.length, ...input };
    }
  };

  try {
    const result = await pollEmailInquiries({
      config: config({ uploadDir }),
      inquiryRepository,
      inquiryAttachmentRepository,
      imapClientFactory: () => client
    });

    assert.deepEqual(result.imported, [
      { uid: 301, inquiryId: 88, duplicate: false, attachments: 1, skippedAttachments: 0 }
    ]);
    assert.equal(createdAttachments.length, 1);
    assert.equal(createdAttachments[0].inquiryId, 88);
    assert.equal(createdAttachments[0].sourceIndex, 0);
    assert.equal(createdAttachments[0].originalName, 'process.pdf');
    assert.equal(createdAttachments[0].mimeType, 'application/pdf');
    assert.equal(createdAttachments[0].fileSize, 'fake-pdf-content'.length);
    assert.match(createdAttachments[0].storedPath, /^email-inquiries\//);
    const stored = await readFile(path.resolve(uploadDir, createdAttachments[0].storedPath), 'utf8');
    assert.equal(stored, 'fake-pdf-content');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
