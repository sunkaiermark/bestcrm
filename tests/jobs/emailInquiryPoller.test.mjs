import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  pollEmailInquiries,
  previewEmailClassifications,
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
    emailRawArchive: overrides.emailRawArchive || { enabled: false },
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

function rawGoogleAdsEmailWithAttachment(id) {
  return Buffer.from([
    `Message-ID: <${id}@example.com>`,
    'Date: Sat, 01 Aug 2026 04:00:00 +0000',
    'From: Google Ads <ads-noreply@google.com>',
    'To: sales@sunkaier.com',
    'Subject: Google Ads account notice',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="bestcrm-test-boundary"',
    '',
    '--bestcrm-test-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Google Ads notification.',
    '--bestcrm-test-boundary',
    'Content-Type: application/pdf; name="notice.pdf"',
    'Content-Disposition: attachment; filename="notice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('not-an-inquiry').toString('base64'),
    '--bestcrm-test-boundary--'
  ].join('\r\n'));
}

function rawReplyEmail(id, inReplyTo) {
  return Buffer.from([
    `Message-ID: <${id}@example.com>`,
    `In-Reply-To: <${inReplyTo}@example.com>`,
    `References: <${inReplyTo}@example.com>`,
    'Date: Sat, 01 Aug 2026 06:00:00 +0000',
    'From: Alice <alice@example.com>',
    'To: sales@sunkaier.com',
    'Subject: Re: RFQ',
    '',
    'Please revise the quotation.'
  ].join('\r\n'));
}

function enableRawArchiveMemory(archive) {
  const rawMessages = [];
  const rawScans = [];
  const processingAttempts = [];
  const attachmentScans = [];
  const classificationEvents = [];
  Object.assign(archive.repository, {
    async findRawMessageIdentity(identity) {
      return rawMessages.find((raw) => raw.mailboxKey === identity.mailboxKey
        && raw.providerMailbox === identity.providerMailbox
        && raw.providerUidValidity === identity.providerUidValidity
        && Number(raw.providerUid) === Number(identity.providerUid)) || null;
    },
    async createRawMessage(input) {
      const existing = await this.findRawMessageIdentity(input);
      if (existing) return { rawMessage: existing, created: false };
      const rawMessage = { id: rawMessages.length + 1, ...input };
      rawMessages.push(rawMessage);
      return { rawMessage, created: true };
    },
    async createRawScanAttempt(input) { rawScans.push(input); return input; },
    async createRawProcessingAttempt(input) { processingAttempts.push(input); return input; },
    async createAttachmentScanAttempt(input) { attachmentScans.push(input); return input; },
    async createClassificationEvent(input) { classificationEvents.push(input); return input; },
    async linkInboundMessageRawArchive(input) {
      const message = archive.messages.find((item) => item.id === Number(input.messageId));
      if (!message || message.rawMessageId) return null;
      Object.assign(message, input);
      return message;
    }
  });
  return { rawMessages, rawScans, processingAttempts, attachmentScans, classificationEvents };
}

function rawHighConfidenceSpamEmail(id) {
  return Buffer.from([
    `Message-ID: <${id}@example.com>`,
    'Date: Sat, 01 Aug 2026 04:00:00 +0000',
    'From: Outreach <keyword.savvy@topseoagency.co>',
    'To: sales@sunkaier.com',
    'Subject: SEO and backlinks for your website ranking',
    '',
    'We sell SEO services and guest post placements.'
  ].join('\r\n'));
}

function createMemoryArchive() {
  const threads = [];
  const messages = [];
  const attachments = [];
  return {
    threads,
    messages,
    attachments,
    repository: {
      async findMessageIdentity(identity) {
        return messages.find((message) => (
          (identity.messageId && message.messageId === identity.messageId)
          || (message.providerMailbox === identity.providerMailbox
            && message.providerUidValidity === identity.providerUidValidity
            && Number(message.providerUid) === Number(identity.providerUid))
        )) || null;
      },
      async findThreadById(id) { return threads.find((thread) => thread.id === Number(id)) || null; },
      async findThreadByReferences(referenceIds) {
        const parent = messages.find((message) => referenceIds.includes(message.messageId));
        return parent ? threads.find((thread) => thread.id === parent.threadId) : null;
      },
      async createThread(input) {
        const thread = { id: threads.length + 1, ...input, opportunityId: input.opportunityId || null };
        threads.push(thread);
        return thread;
      },
      async createInboundMessage(input) {
        if (messages.some((message) => message.messageId === input.messageId)) return null;
        const message = { id: messages.length + 1, ...input };
        messages.push(message);
        return message;
      },
      async touchThread(id, at) {
        const thread = threads.find((item) => item.id === Number(id));
        thread.lastMessageAt = at;
        return thread;
      },
      async listAttachmentsByMessage(messageId) {
        return attachments.filter((attachment) => attachment.messageId === Number(messageId));
      },
      async createAttachment(input) {
        const record = { id: attachments.length + 1, ...input };
        attachments.push(record);
        return record;
      }
    }
  };
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
    ],
    filtered: [],
    skipped: [],
    mode: 'legacy-unseen',
    backfillComplete: false
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

test('pollEmailInquiries skips attachment storage for archived or spam messages', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-skip-'));
  const client = {
    async connect() {},
    async mailboxOpen() {},
    async search() {
      return [401];
    },
    async fetchOne(uid) {
      return { uid: Number(uid), source: rawGoogleAdsEmailWithAttachment(`notice-${uid}`) };
    },
    async messageFlagsAdd() {},
    async logout() {}
  };
  const created = [];
  const attachmentCalls = [];
  const inquiryRepository = {
    async createInquiry(input) {
      created.push(input);
      return { id: 98, ...input };
    }
  };
  const inquiryAttachmentRepository = {
    async listByInquiry() {
      attachmentCalls.push(['listByInquiry']);
      return [];
    },
    async createAttachment(input) {
      attachmentCalls.push(['createAttachment', input]);
      return { id: 1, ...input };
    }
  };

  try {
    const result = await pollEmailInquiries({
      config: config({ uploadDir }),
      inquiryRepository,
      inquiryAttachmentRepository,
      imapClientFactory: () => client
    });

    assert.equal(created[0].status, 'archived');
    assert.equal(created[0].rawPayload.emailFilter.reason, 'google_ads_notification');
    assert.deepEqual(attachmentCalls, []);
    assert.deepEqual(result.imported, [
      { uid: 401, inquiryId: 98, duplicate: false, attachments: 0, skippedAttachments: 1 }
    ]);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('archive polling deduplicates repeated Message-ID before marking both provider records seen', async () => {
  const archive = createMemoryArchive();
  const inquiries = [];
  const seen = [];
  const client = {
    mailbox: { uidValidity: 44n },
    async connect() {}, async mailboxOpen() {}, async search() { return [501, 502]; },
    async fetchOne(uid) { return { uid: Number(uid), source: rawEmail('same-message') }; },
    async messageFlagsAdd(uid) { seen.push(uid); }, async logout() {}
  };
  const result = await pollEmailInquiries({
    config: config(),
    inquiryRepository: {
      async createInquiry(input) { const inquiry = { id: inquiries.length + 1, ...input }; inquiries.push(inquiry); return inquiry; }
    },
    emailArchiveRepository: archive.repository,
    imapClientFactory: () => client
  });

  assert.equal(inquiries.length, 1);
  assert.equal(archive.threads.length, 1);
  assert.equal(archive.messages.length, 1);
  assert.deepEqual(result.imported.map((item) => item.duplicate), [false, true]);
  assert.deepEqual(seen, ['501', '502']);
});

test('archive polling uses reply headers to append to the original inquiry thread', async () => {
  const archive = createMemoryArchive();
  const inquiries = [];
  let pass = 0;
  const client = {
    mailbox: { uidValidity: 55n },
    async connect() {}, async mailboxOpen() {}, async search() { return [601 + pass]; },
    async fetchOne(uid) {
      return { uid: Number(uid), source: pass === 0 ? rawEmail('root-thread') : rawReplyEmail('reply-thread', 'root-thread') };
    },
    async messageFlagsAdd() {}, async logout() { pass += 1; }
  };
  const options = {
    config: config(),
    inquiryRepository: {
      async createInquiry(input) { const inquiry = { id: inquiries.length + 1, ...input }; inquiries.push(inquiry); return inquiry; }
    },
    emailArchiveRepository: archive.repository,
    imapClientFactory: () => client
  };
  await pollEmailInquiries(options);
  const reply = await pollEmailInquiries(options);

  assert.equal(inquiries.length, 1);
  assert.equal(archive.threads.length, 1);
  assert.equal(archive.messages.length, 2);
  assert.equal(reply.imported[0].threadId, archive.threads[0].id);
});

test('attachment archive failure leaves mail unseen and a retry completes the same message', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-retry-'));
  const archive = createMemoryArchive();
  const originalCreateAttachment = archive.repository.createAttachment;
  let attachmentAttempts = 0;
  archive.repository.createAttachment = async (input) => {
    attachmentAttempts += 1;
    if (attachmentAttempts === 1) throw new Error('temporary storage metadata failure');
    return originalCreateAttachment(input);
  };
  const seen = [];
  const client = {
    mailbox: { uidValidity: 66n },
    async connect() {}, async mailboxOpen() {}, async search() { return [701]; },
    async fetchOne(uid) { return { uid: Number(uid), source: rawEmailWithAttachment('retry-message') }; },
    async messageFlagsAdd(uid) { seen.push(uid); }, async logout() {}
  };
  const inquiryRepository = {
    async createInquiry(input) { return { id: 1, ...input }; }
  };

  try {
    await assert.rejects(() => pollEmailInquiries({
      config: config({ uploadDir }), inquiryRepository, emailArchiveRepository: archive.repository, imapClientFactory: () => client
    }), /temporary storage metadata failure/);
    assert.deepEqual(seen, []);

    const retried = await pollEmailInquiries({
      config: config({ uploadDir }), inquiryRepository, emailArchiveRepository: archive.repository, imapClientFactory: () => client
    });
    assert.equal(retried.imported[0].duplicate, true);
    assert.equal(archive.attachments.length, 1);
    assert.deepEqual(seen, ['701']);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('high-confidence spam advances the checkpoint without writing any CRM record', async () => {
  const archive = createMemoryArchive();
  const checkpoints = [];
  const state = {
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '144',
    incrementalLastUid: 900, backfillBeforeUid: 902, backfillComplete: false
  };
  Object.assign(archive.repository, {
    async initializeImapSyncState() { return { ...state }; },
    async updateImapIncrementalCheckpoint(input) {
      checkpoints.push(input.uid);
      state.incrementalLastUid = Number(input.uid);
      return { ...state };
    },
    async updateImapBackfillCheckpoint() { return { ...state }; }
  });
  let inquiryCreates = 0;
  const client = {
    mailbox: { uidValidity: 144n, uidNext: 902n },
    async connect() {},
    async mailboxOpen() {},
    async search(query, options) {
      assert.deepEqual({ query, options }, { query: { uid: '901:*' }, options: { uid: true } });
      return [901];
    },
    async fetchOne(uid) { return { uid: Number(uid), source: rawHighConfidenceSpamEmail('spam-901') }; },
    async messageFlagsAdd() { assert.fail('checkpointed filtering must not change mailbox read state'); },
    async logout() {}
  };

  const result = await pollEmailInquiries({
    config: config({ markSeen: false }),
    inquiryRepository: { async createInquiry() { inquiryCreates += 1; } },
    emailArchiveRepository: archive.repository,
    imapClientFactory: () => client
  });

  assert.equal(inquiryCreates, 0);
  assert.equal(archive.threads.length, 0);
  assert.equal(archive.messages.length, 0);
  assert.equal(archive.attachments.length, 0);
  assert.deepEqual(result.imported, []);
  assert.deepEqual(result.filtered, [{ uid: 901, reason: 'reject_spam', category: 'marketing_spam', spamScore: 16 }]);
  assert.deepEqual(checkpoints, [901]);
});

test('checkpointed incremental sync uses UID ranges without changing mailbox read state', async () => {
  const archive = createMemoryArchive();
  const inquiries = [];
  const searches = [];
  const checkpoints = [];
  const state = {
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '77',
    incrementalLastUid: 100, backfillBeforeUid: 105, backfillComplete: false
  };
  Object.assign(archive.repository, {
    async initializeImapSyncState() { return { ...state }; },
    async updateImapIncrementalCheckpoint(input) {
      checkpoints.push(input.uid);
      state.incrementalLastUid = Math.max(state.incrementalLastUid, Number(input.uid));
      return { ...state };
    },
    async updateImapBackfillCheckpoint() { return { ...state }; }
  });
  const client = {
    mailbox: { uidValidity: 77n, uidNext: 105n },
    async connect() {}, async mailboxOpen() {},
    async search(query, options) { searches.push({ query, options }); return [104, 101, 103, 102]; },
    async fetchOne(uid) { return { uid: Number(uid), source: rawEmail(`uid-${uid}`) }; },
    async messageFlagsAdd() { assert.fail('checkpointed sync must not change read state'); },
    async logout() {}
  };

  const result = await pollEmailInquiries({
    config: config({ maxMessages: 3, markSeen: false }),
    inquiryRepository: {
      async createInquiry(input) { const inquiry = { id: inquiries.length + 1, ...input }; inquiries.push(inquiry); return inquiry; }
    },
    emailArchiveRepository: archive.repository,
    imapClientFactory: () => client
  });

  assert.deepEqual(searches, [{ query: { uid: '101:*' }, options: { uid: true } }]);
  assert.deepEqual(result.imported.map((item) => item.uid), [101, 102, 103]);
  assert.deepEqual(checkpoints, [101, 102, 103]);
  assert.equal(result.mode, 'incremental');
});

test('fresh checkpointed incremental sync starts at mailbox head while backfill remains available', async () => {
  const archive = createMemoryArchive();
  const checkpoints = [];
  const state = {
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '88',
    incrementalLastUid: 204, backfillBeforeUid: 205, backfillComplete: false
  };
  Object.assign(archive.repository, {
    async initializeImapSyncState(input) {
      assert.equal(input.incrementalLastUid, 204);
      assert.equal(input.backfillBeforeUid, 205);
      return { ...state };
    },
    async updateImapIncrementalCheckpoint(input) {
      checkpoints.push(input.uid);
      return { ...state };
    },
    async updateImapBackfillCheckpoint() { return { ...state }; }
  });
  const client = {
    mailbox: { uidValidity: 88n, uidNext: 205n },
    async connect() {}, async mailboxOpen() {},
    async search() { assert.fail('fresh incremental sync should not search historical mail'); },
    async logout() {}
  };

  const result = await pollEmailInquiries({
    config: config({ markSeen: false }),
    inquiryRepository: { async createInquiry() { assert.fail('no message should be imported'); } },
    emailArchiveRepository: archive.repository,
    imapClientFactory: () => client
  });

  assert.equal(result.scanned, 0);
  assert.deepEqual(checkpoints, [204]);
  assert.equal(result.backfillComplete, false);
});

test('historical backfill walks UIDs newest-first and marks the cursor complete', async () => {
  const archive = createMemoryArchive();
  const checkpoints = [];
  const state = {
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '99',
    incrementalLastUid: 120, backfillBeforeUid: 101, backfillComplete: false
  };
  Object.assign(archive.repository, {
    async initializeImapSyncState() { return { ...state }; },
    async updateImapIncrementalCheckpoint() { return { ...state }; },
    async updateImapBackfillCheckpoint(input) {
      checkpoints.push({ beforeUid: input.beforeUid, complete: input.complete });
      if (input.beforeUid) state.backfillBeforeUid = Number(input.beforeUid);
      state.backfillComplete = Boolean(input.complete);
      return { ...state };
    }
  });
  const client = {
    mailbox: { uidValidity: 99n, uidNext: 121n },
    async connect() {}, async mailboxOpen() {},
    async search(query, options) {
      assert.deepEqual({ query, options }, { query: { uid: '1:100' }, options: { uid: true } });
      return [50, 100, 75];
    },
    async fetchOne(uid) { return { uid: Number(uid), source: rawEmail(`history-${uid}`) }; },
    async logout() {}
  };

  const result = await pollEmailInquiries({
    config: config({ maxMessages: 5, markSeen: false }),
    inquiryRepository: { async createInquiry(input) { return { id: Number(input.rawPayload.uid), ...input }; } },
    emailArchiveRepository: archive.repository,
    imapClientFactory: () => client,
    syncMode: 'backfill'
  });

  assert.deepEqual(result.imported.map((item) => item.uid), [100, 75, 50]);
  assert.deepEqual(checkpoints, [
    { beforeUid: 100, complete: false },
    { beforeUid: 75, complete: false },
    { beforeUid: 50, complete: false },
    { beforeUid: 50, complete: true }
  ]);
  assert.equal(result.backfillComplete, true);
});

test('classification preview is read-only and prioritizes exact CRM contacts', async () => {
  const calls = [];
  const client = {
    mailbox: { uidValidity: 123n, uidNext: 4n },
    async connect() {}, async mailboxOpen() {},
    async search(query, options) { calls.push(['search', query, options]); return [1, 2, 3]; },
    async fetchOne(uid) {
      calls.push(['fetchOne', uid]);
      return {
        uid: Number(uid),
        source: Number(uid) === 3
          ? rawGoogleAdsEmailWithAttachment('ads-preview')
          : rawEmail(`preview-${uid}`, Number(uid) === 2 ? 'SEO opportunities and backlinks' : 'RFQ')
      };
    },
    async messageFlagsAdd() { assert.fail('preview must not change mailbox flags'); },
    async logout() {}
  };
  const result = await previewEmailClassifications({
    config: config({ maxMessages: 2, markSeen: false }),
    contactRepository: {
      async findUniqueByEmail(email) {
        return email === 'alice@example.com'
          ? { id: 20, contactCode: 'CT000020', customerId: 10 }
          : null;
      }
    },
    emailArchiveRepository: { async findThreadByReferences() { return null; } },
    imapClientFactory: () => client,
    maxMessages: 2
  });

  assert.deepEqual(calls[0], ['search', { uid: '1:*' }, { uid: true }]);
  assert.equal(result.scanned, 2);
  assert.deepEqual(result.counts, { active: 1, archived: 1, spam: 0 });
  assert.deepEqual(result.entryCounts, { accept: 2, manual_review: 0, reject_spam: 0 });
  assert.equal(result.items[0].classificationReason, 'google_ads_notification');
  assert.equal(result.items[1].classificationReason, 'known_contact_email');
  assert.equal(result.items[1].matchedContactId, 20);
});

test('raw-enabled polling scans source and attachments before binding one immutable EML record', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-poller-'));
  const archive = createMemoryArchive();
  const evidence = enableRawArchiveMemory(archive);
  const checkpoints = [];
  const state = {
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '177',
    incrementalLastUid: 700, backfillBeforeUid: 702, backfillComplete: false
  };
  Object.assign(archive.repository, {
    async initializeImapSyncState() { return { ...state }; },
    async updateImapIncrementalCheckpoint(input) {
      checkpoints.push(input.uid);
      state.incrementalLastUid = Number(input.uid);
      return { ...state };
    },
    async updateImapBackfillCheckpoint() { return { ...state }; }
  });
  const client = {
    mailbox: { uidValidity: 177n, uidNext: 702n },
    async connect() {}, async mailboxOpen() {},
    async search() { return [701]; },
    async fetchOne(uid) { return { uid: Number(uid), source: rawEmailWithAttachment('raw-701') }; },
    async messageFlagsAdd() { assert.fail('checkpointed sync must not change read state'); },
    async logout() {}
  };
  const scanCalls = [];
  const cleanScan = () => ({
    engine: 'fake-clamav', engineVersion: '1', signatureVersion: '2', verdict: 'clean',
    findingCode: '', safeDetail: '', startedAt: '2026-09-08T00:00:00Z', completedAt: '2026-09-08T00:00:01Z'
  });
  const malwareScanner = {
    async scanFile(filePath) { scanCalls.push(['source', filePath]); return cleanScan(); },
    async scanBuffer(content) { scanCalls.push(['attachment', content.toString()]); return cleanScan(); }
  };
  const inquiryRepository = {
    async createInquiry(input) { return { id: 1, ...input }; }
  };
  const transaction = (callback) => callback({
    emailArchiveRepository: archive.repository,
    inquiryRepository,
    contactRepository: { async findUniqueByEmail() { return null; } }
  });

  try {
    const result = await pollEmailInquiries({
      config: config({
        uploadDir,
        markSeen: false,
        emailRawArchive: { enabled: true, maxBytes: 1024 * 1024 }
      }),
      inquiryRepository,
      emailArchiveRepository: archive.repository,
      contactRepository: { async findUniqueByEmail() { return null; } },
      emailArchiveTransaction: transaction,
      malwareScanner,
      imapClientFactory: () => client
    });

    assert.equal(result.imported.length, 1);
    assert.deepEqual(scanCalls.map(([kind]) => kind), ['source', 'attachment']);
    assert.equal(evidence.rawMessages.length, 1);
    assert.equal(evidence.rawScans.length, 1);
    assert.equal(evidence.processingAttempts[0].outcome, 'succeeded');
    assert.equal(evidence.attachmentScans.length, 1);
    assert.equal(evidence.classificationEvents.length, 1);
    assert.equal(archive.messages[0].rawMessageId, evidence.rawMessages[0].id);
    assert.match(evidence.rawMessages[0].storedPath, /^email-raw\//);
    assert.equal(await readFile(path.join(uploadDir, ...evidence.rawMessages[0].storedPath.split('/')), 'utf8'), rawEmailWithAttachment('raw-701').toString());
    assert.deepEqual(checkpoints, [701]);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw-enabled polling discards high-confidence spam after scanning and stores no CRM evidence', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-spam-'));
  const archive = createMemoryArchive();
  const evidence = enableRawArchiveMemory(archive);
  const client = {
    mailbox: { uidValidity: 188n },
    async connect() {}, async mailboxOpen() {}, async search() { return [801]; },
    async fetchOne(uid) { return { uid: Number(uid), source: rawHighConfidenceSpamEmail('raw-spam-801') }; },
    async messageFlagsAdd() {}, async logout() {}
  };
  const inquiryRepository = { async createInquiry() { assert.fail('spam must not create inquiry'); } };
  const contactRepository = { async findUniqueByEmail() { return null; } };
  const transaction = (callback) => callback({ emailArchiveRepository: archive.repository, inquiryRepository, contactRepository });

  try {
    const result = await pollEmailInquiries({
      config: config({ uploadDir, emailRawArchive: { enabled: true, maxBytes: 1024 * 1024 } }),
      inquiryRepository,
      emailArchiveRepository: archive.repository,
      contactRepository,
      emailArchiveTransaction: transaction,
      malwareScanner: {
        async scanFile() { return { engine: 'fake', verdict: 'clean' }; },
        async scanBuffer() { return { engine: 'fake', verdict: 'clean' }; }
      },
      imapClientFactory: () => client
    });

    assert.equal(result.filtered.length, 1);
    assert.equal(evidence.rawMessages.length, 0);
    assert.equal(archive.messages.length, 0);
    assert.deepEqual(await readdir(path.join(uploadDir, 'email-raw', '.staging')), []);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw-enabled polling does not advance the checkpoint when malware is detected', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-malware-'));
  const archive = createMemoryArchive();
  enableRawArchiveMemory(archive);
  let checkpointUpdates = 0;
  const state = {
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '199',
    incrementalLastUid: 900, backfillBeforeUid: 902, backfillComplete: false
  };
  Object.assign(archive.repository, {
    async initializeImapSyncState() { return { ...state }; },
    async updateImapIncrementalCheckpoint() { checkpointUpdates += 1; return { ...state }; },
    async updateImapBackfillCheckpoint() { return { ...state }; },
    async recordImapSyncError() { return { ...state }; }
  });
  const client = {
    mailbox: { uidValidity: 199n, uidNext: 902n },
    async connect() {}, async mailboxOpen() {}, async search() { return [901]; },
    async fetchOne(uid) { return { uid: Number(uid), source: rawEmail('malware-901') }; },
    async logout() {}
  };
  const inquiryRepository = { async createInquiry() { assert.fail('malware must not create inquiry'); } };
  const contactRepository = { async findUniqueByEmail() { return null; } };

  try {
    await assert.rejects(() => pollEmailInquiries({
      config: config({ uploadDir, markSeen: false, emailRawArchive: { enabled: true, maxBytes: 1024 * 1024 } }),
      inquiryRepository,
      emailArchiveRepository: archive.repository,
      contactRepository,
      emailArchiveTransaction: (callback) => callback({ emailArchiveRepository: archive.repository, inquiryRepository, contactRepository }),
      malwareScanner: { async scanFile() { return { engine: 'fake', verdict: 'malware', findingCode: 'test-malware' }; } },
      imapClientFactory: () => client
    }), /failed malware scanning/);
    assert.equal(checkpointUpdates, 0);
    assert.equal(archive.messages.length, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
