import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  assignEmailThreadTriage,
  archiveInboundEmailRecord,
  archiveImportedOutboundEmailRecord,
  canPurgeEmailThread,
  convertEmailThreadToLead,
  convertEmailThreadToInquiry,
  createOpportunityFromEmailThread,
  getEmailCleanupSummary,
  getEmailThreadIntakeContext,
  getEmailSpamCleanupSummary,
  getVisibleEmailThread,
  linkEmailThreadToInquiry,
  linkEmailThreadToOpportunity,
  listEmailLinkableOpportunities,
  listVisibleEmailMailboxes,
  listVisibleEmailThreads,
  purgeEmailThread,
  purgeEligibleEmailFolder,
  purgeEligibleEmailSpam,
  resolveVisibleEmailMailbox,
  setEmailThreadDisposition,
  storeEmailArchiveAttachments
} from '../../src/services/emailArchiveService.mjs';

function parsed(overrides = {}) {
  return {
    message: {
      mailboxKey: 'sales@sunkaier.com', normalizedSubject: 'rfq', messageId: 'rfq@example.com',
      inReplyTo: '', referenceIds: [], replyReferenceIds: [], providerMailbox: 'INBOX',
      providerUidValidity: '5', providerUid: 7, fromAddress: 'buyer@example.com', fromName: 'Buyer',
      toRecipients: [{ address: 'sales@sunkaier.com' }], ccRecipients: [], subject: 'RFQ',
      textBody: 'Need quote', htmlBody: '', safeHeaders: {}, receivedAt: '2026-09-03T01:00:00Z',
      ...overrides
    },
    inquiry: { source: 'email', sourceReference: 'rfq@example.com', requirementText: 'Need quote', status: 'new' },
    attachments: []
  };
}

test('new inbound thread enters pending triage without creating an inquiry', async () => {
  const calls = [];
  const thread = { id: 3, inquiryId: null, opportunityId: null, triageStatus: 'pending', lastMessageAt: '2026-09-03T01:00:00Z' };
  const result = await archiveInboundEmailRecord({
    inquiryRepository: {
      async createInquiry(input) { calls.push(['inquiry', input.sourceReference]); return { id: 8, ...input }; }
    },
    emailArchiveRepository: {
      async findMessageIdentity() { return null; },
      async findThreadByReferences() { return null; },
      async createThread(input) { calls.push(['thread', input.inquiryId]); return thread; },
      async createInboundMessage(input) { calls.push(['message', input.threadId]); return { id: 9, threadId: 3 }; },
      async touchThread() {}
    }
  }, parsed());

  assert.deepEqual(calls, [['thread', null], ['message', 3]]);
  assert.equal(result.inquiry, null);
  assert.equal(result.thread.triageStatus, 'pending');
  assert.equal(result.duplicate, false);
});

test('reply headers join an existing opportunity thread without creating another inquiry', async () => {
  let inquiryCreates = 0;
  const thread = { id: 4, inquiryId: 8, opportunityId: 20, lastMessageAt: '2026-09-01T01:00:00Z' };
  const result = await archiveInboundEmailRecord({
    inquiryRepository: { async createInquiry() { inquiryCreates += 1; } },
    emailArchiveRepository: {
      async findMessageIdentity() { return null; },
      async findThreadByReferences(ids) { assert.deepEqual(ids, ['sent@example.com']); return thread; },
      async createInboundMessage(input) { return { id: 10, threadId: input.threadId }; },
      async touchThread(id) { assert.equal(id, 4); }
    }
  }, parsed({ messageId: 'reply@example.com', inReplyTo: 'sent@example.com', replyReferenceIds: ['sent@example.com'] }));

  assert.equal(inquiryCreates, 0);
  assert.equal(result.thread.opportunityId, 20);
  assert.equal(result.inquiry, null);
});

test('rule-classified spam stays advisory and enters pending without creating an inquiry', async () => {
  const calls = [];
  const spam = parsed();
  spam.inquiry = {
    ...spam.inquiry,
    status: 'spam',
    rawPayload: {
      emailFilter: {
        category: 'marketing_spam',
        reason: 'seo_outreach',
        entryDecision: 'reject_spam',
        spamScore: 8,
        spamSignals: ['confirmed_spam_domain']
      }
    }
  };
  const result = await archiveInboundEmailRecord({
    inquiryRepository: { async createInquiry() { calls.push('inquiry'); } },
    emailArchiveRepository: {
      async findMessageIdentity() { return null; },
      async findThreadByReferences() { return null; },
      async createThread(input) { calls.push('thread'); return { id: 3, ...input }; },
      async createInboundMessage(input) { calls.push('message'); return { id: 9, ...input }; },
      async touchThread() {}
    }
  }, spam);

  assert.deepEqual(calls, ['thread', 'message']);
  assert.equal(result.rejectedSpam, false);
  assert.equal(result.inquiry, null);
  assert.equal(result.thread.triageStatus, 'pending');
  assert.equal(result.thread.archiveDisposition, 'active');
  assert.equal(result.message.archiveDisposition, 'active');
  assert.equal(result.classification.spamScore, 8);
});

test('one exact existing contact overrides spam heuristics and links the archived thread', async () => {
  const created = {};
  const candidate = parsed();
  candidate.inquiry = {
    ...candidate.inquiry,
    status: 'spam',
    rawPayload: { emailFilter: { category: 'marketing_spam', reason: 'seo_marketing_pitch' } }
  };
  await archiveInboundEmailRecord({
    contactRepository: {
      async findUniqueByEmail(email) {
        assert.equal(email, 'buyer@example.com');
        return { id: 20, contactCode: 'CT000020', customerId: 10 };
      }
    },
    inquiryRepository: {
      async createInquiry(input) { created.inquiry = input; return { id: 8, ...input }; }
    },
    emailArchiveRepository: {
      async findMessageIdentity() { return null; },
      async findThreadByReferences() { return null; },
      async createThread(input) { created.thread = input; return { id: 3, ...input }; },
      async createInboundMessage(input) { created.message = input; return { id: 9, ...input }; },
      async touchThread() {}
    }
  }, candidate);

  assert.equal(created.inquiry, undefined);
  assert.equal(created.thread.customerId, 10);
  assert.equal(created.thread.contactId, 20);
  assert.equal(created.thread.triageStatus, 'pending');
  assert.equal(created.thread.archiveDisposition, 'active');
  assert.equal(created.message.classificationReason, 'known_contact_email');
  assert.equal(created.message.classificationCategory, 'known_contact');
});

test('an existing message thread protects a reply even when content scores as spam', async () => {
  let inquiryCreates = 0;
  const existingThread = {
    id: 4,
    inquiryId: 8,
    opportunityId: 20,
    archiveDisposition: 'active',
    classificationCategory: 'inquiry',
    classificationReason: 'inquiry_intent',
    lastMessageAt: '2026-09-01T01:00:00Z'
  };
  const candidate = parsed({
    messageId: 'reply-spam@example.com',
    inReplyTo: 'original@example.com',
    replyReferenceIds: ['original@example.com']
  });
  candidate.inquiry = {
    ...candidate.inquiry,
    status: 'spam',
    rawPayload: {
      emailFilter: {
        category: 'marketing_spam',
        reason: 'spam_score_threshold',
        entryDecision: 'reject_spam',
        spamScore: 8,
        spamSignals: ['seo_outreach_cluster', 'irrelevant_unsolicited_service']
      }
    }
  };

  const result = await archiveInboundEmailRecord({
    inquiryRepository: { async createInquiry() { inquiryCreates += 1; } },
    emailArchiveRepository: {
      async findMessageIdentity() { return null; },
      async findThreadByReferences() { return existingThread; },
      async createInboundMessage(input) { return { id: 10, ...input }; },
      async touchThread() {}
    }
  }, candidate);

  assert.equal(inquiryCreates, 0);
  assert.equal(result.rejectedSpam, false);
  assert.equal(result.message.threadId, 4);
  assert.equal(result.classification.entryDecision, 'accept');
  assert.deepEqual(result.classification.protectedReasons, ['known_thread_reply']);
});

test('duplicate Message-ID returns the existing archive without creating records', async () => {
  const existing = { id: 10, threadId: 4 };
  const result = await archiveInboundEmailRecord({
    inquiryRepository: { async createInquiry() { throw new Error('must not create'); } },
    emailArchiveRepository: {
      async findMessageIdentity() { return existing; },
      async findThreadById() { return { id: 4, inquiryId: 8, opportunityId: null }; }
    }
  }, parsed());
  assert.equal(result.duplicate, true);
  assert.equal(result.message.id, 10);
});

test('imported sent mail joins the referenced opportunity thread and records its mailbox owner', async () => {
  const thread = { id: 4, inquiryId: 8, opportunityId: 20, lastMessageAt: '2026-09-03T01:00:00Z' };
  const captured = {};
  const rawCapture = {
    mailboxKey: 'markyang@sunkaier.com',
    providerName: 'imap',
    providerMailbox: 'Sent Messages',
    providerUidValidity: '5',
    providerUid: 12,
    rfcMessageIdHint: 'sent@example.com',
    sourceReceivedAt: '2026-09-03T02:00:00Z',
    storedPath: 'email-raw/markyang/sent-12.eml',
    fileSize: 128,
    sha256: 'a'.repeat(64),
    scan: { engine: 'test', verdict: 'clean' }
  };
  const candidate = parsed({
    mailboxKey: 'markyang@sunkaier.com',
    messageId: 'sent@example.com',
    inReplyTo: 'rfq@example.com',
    replyReferenceIds: ['rfq@example.com'],
    providerMailbox: 'Sent Messages',
    providerUid: 12,
    fromAddress: 'markyang@sunkaier.com',
    toRecipients: [{ address: 'buyer@example.com' }],
    receivedAt: null,
    sentAt: '2026-09-03T02:00:00Z'
  });
  const result = await archiveImportedOutboundEmailRecord({
    contactRepository: { async findUniqueByEmail() { return null; } },
    emailArchiveRepository: {
      async findMessageIdentity() { return null; },
      async findThreadByReferences(ids) { assert.deepEqual(ids, ['rfq@example.com']); return thread; },
      async findActivePersonalMailboxOwner(address) { assert.equal(address, 'markyang@sunkaier.com'); return 7; },
      async createRawMessage(input) {
        return { rawMessage: { id: 81, ...input }, created: true };
      },
      async createRawScanAttempt(input) { captured.rawScan = input; return input; },
      async createRawProcessingAttempt(input) { captured.rawProcessing = input; return input; },
      async createImportedOutboundMessage(input) {
        captured.message = input;
        return { id: 13, ...input, direction: 'outbound' };
      },
      async createMailboxDelivery(input) { captured.delivery = input; return input; },
      async touchThread(id, at) { captured.touch = [id, at]; }
    }
  }, candidate, { rawCapture });

  assert.equal(result.duplicate, false);
  assert.equal(captured.message.threadId, 4);
  assert.equal(captured.message.authoredBy, 7);
  assert.equal(captured.message.rawMessageId, 81);
  assert.equal(captured.message.rawEmlStoredPath, 'email-raw/markyang/sent-12.eml');
  assert.equal(captured.message.rawEmlFileSize, 128);
  assert.equal(captured.message.rawEmlSha256, 'a'.repeat(64));
  assert.ok(captured.message.importedAt);
  assert.equal(captured.delivery.direction, 'outbound');
  assert.equal(captured.delivery.mailboxKey, 'markyang@sunkaier.com');
  assert.equal(captured.delivery.rawMessageId, 81);
  assert.equal(captured.rawProcessing.rawMessageId, 81);
  assert.equal(captured.rawProcessing.outcome, 'succeeded');
  assert.deepEqual(captured.touch, [4, '2026-09-03T02:00:00Z']);
});

test('duplicate imported sent mail binds newly captured raw evidence before recording delivery', async () => {
  const captured = {};
  const existing = {
    id: 13,
    threadId: 4,
    direction: 'outbound',
    rawMessageId: null
  };
  const rawCapture = {
    mailboxKey: 'sales@sunkaier.com',
    providerName: 'imap',
    providerMailbox: 'Sent',
    providerUidValidity: '5',
    providerUid: 22,
    storedPath: 'email-raw/sales/sent-22.eml',
    fileSize: 256,
    sha256: 'b'.repeat(64),
    scan: { engine: 'test', verdict: 'clean' }
  };
  const result = await archiveImportedOutboundEmailRecord({
    contactRepository: {},
    emailArchiveRepository: {
      async findMessageIdentity() { return existing; },
      async createRawMessage(input) { return { rawMessage: { id: 82, ...input }, created: true }; },
      async createRawScanAttempt(input) { return input; },
      async createRawProcessingAttempt(input) { return input; },
      async linkImportedOutboundMessageRawArchive(input) {
        captured.binding = input;
        return { ...existing, rawMessageId: input.rawMessageId, rawEmlStoredPath: input.rawEmlStoredPath };
      },
      async createMailboxDelivery(input) { captured.delivery = input; return input; },
      async findThreadById() { return { id: 4, opportunityId: 20 }; }
    }
  }, parsed({
    mailboxKey: 'sales@sunkaier.com',
    messageId: 'sent-22@example.com',
    providerMailbox: 'Sent',
    providerUid: 22,
    fromAddress: 'sales@sunkaier.com',
    receivedAt: null,
    sentAt: '2026-09-03T02:00:00Z'
  }), { rawCapture });

  assert.equal(result.duplicate, true);
  assert.equal(captured.binding.rawMessageId, 82);
  assert.equal(captured.binding.rawEmlStoredPath, rawCapture.storedPath);
  assert.equal(captured.delivery.rawMessageId, 82);
});

test('archived attachments retain checksum and independent email-archive file', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-archive-'));
  const records = [];
  try {
    const result = await storeEmailArchiveAttachments({
      emailArchiveRepository: {
        async listAttachmentsByMessage() { return []; },
        async createAttachment(input) { records.push(input); return { id: 1, ...input }; }
      },
      messageId: 10,
      attachments: [{ filename: 'spec.pdf', contentType: 'application/pdf', content: Buffer.from('safe-content') }],
      uploadDir,
      maxUploadMb: 1
    });
    assert.equal(result.stored.length, 1);
    assert.equal(records[0].sha256, '63a2f0f94f2efe262dee71613926b2bb5ceda47b0aa2950d9403dcfd5a089ec8');
    assert.match(records[0].storedPath, /^email-archive\//);
    assert.equal(await readFile(path.resolve(uploadDir, records[0].storedPath), 'utf8'), 'safe-content');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('attachment scan evidence can be retried without deleting an attachment already indexed', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-scan-retry-'));
  const attachment = {
    id: 51,
    messageId: 10,
    sourceIndex: 0,
    storedPath: 'email-archive/retry.pdf'
  };
  const scanAttempts = [];
  try {
    const result = await storeEmailArchiveAttachments({
      emailArchiveRepository: {
        async listAttachmentsByMessage() { return [attachment]; },
        async createAttachment() { assert.fail('duplicate attachment must not be inserted again'); },
        async createAttachmentScanAttempt(input) { scanAttempts.push(input); return input; }
      },
      messageId: 10,
      attachments: [{ filename: 'retry.pdf', content: Buffer.from('safe-content') }],
      attachmentScans: [{
        engine: 'clamav',
        engineVersion: '1.4',
        signatureVersion: '20260908',
        verdict: 'clean',
        findingCode: '',
        safeDetail: '',
        startedAt: '2026-09-08T00:00:00.000Z',
        completedAt: '2026-09-08T00:00:01.000Z'
      }],
      uploadDir,
      maxUploadMb: 1
    });

    assert.deepEqual(result, { stored: [], skipped: [{ sourceIndex: 0, reason: 'duplicate' }] });
    assert.equal(scanAttempts.length, 1);
    assert.equal(scanAttempts[0].attachmentId, 51);
    assert.equal(scanAttempts[0].verdict, 'clean');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('attachment file remains recoverable when scan evidence insert fails after indexing', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-scan-event-fail-'));
  let indexedAttachment;
  try {
    await assert.rejects(() => storeEmailArchiveAttachments({
      emailArchiveRepository: {
        async listAttachmentsByMessage() { return []; },
        async createAttachment(input) {
          indexedAttachment = { id: 61, ...input };
          return indexedAttachment;
        },
        async createAttachmentScanAttempt() { throw new Error('scan event database failure'); }
      },
      messageId: 10,
      attachments: [{ filename: 'recoverable.pdf', content: Buffer.from('safe-content') }],
      attachmentScans: [{
        engine: 'clamav',
        verdict: 'clean',
        startedAt: '2026-09-08T00:00:00.000Z',
        completedAt: '2026-09-08T00:00:01.000Z'
      }],
      uploadDir,
      maxUploadMb: 1
    }), /scan event database failure/);

    assert.ok(indexedAttachment);
    assert.equal(
      await readFile(path.resolve(uploadDir, indexedAttachment.storedPath), 'utf8'),
      'safe-content'
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('thread visibility keeps shared unlinked mail manager-only and personal unlinked mail owner-only', async () => {
  const unlinked = { id: 1, inquiryId: 8, opportunityId: null };
  const linked = { id: 2, inquiryId: 9, opportunityId: 20 };
  const personal = { id: 3, mailboxOwnerUserId: 7, inquiryId: null, opportunityId: null };
  const dependencies = {
    emailArchiveRepository: {
      async listThreads() { return [unlinked, linked, personal]; },
      async findThreadById(id) {
        return Number(id) === 3 ? personal : Number(id) === 2 ? linked : unlinked;
      },
      async getThreadDetail(id) {
        const selected = Number(id) === 3 ? personal : Number(id) === 2 ? linked : unlinked;
        return { ...selected, messages: [] };
      }
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return { id: 20, salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3, technicalManagerId: 6, commercialManagerId: 9 };
      }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } }
  };

  const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };
  const otherSalesperson = { id: 8, roles: [ROLES.SALESPERSON] };
  const manager = { id: 2, roles: [ROLES.SALES_MANAGER] };
  assert.deepEqual((await listVisibleEmailThreads(dependencies, salesperson)).map((item) => item.id), [2, 3]);
  assert.deepEqual((await listVisibleEmailThreads(dependencies, otherSalesperson)).map((item) => item.id), []);
  assert.deepEqual((await listVisibleEmailThreads(dependencies, manager)).map((item) => item.id), [1, 2]);
  await assert.rejects(() => getVisibleEmailThread(dependencies, salesperson, 1), /Forbidden/);
  assert.equal((await getVisibleEmailThread(dependencies, salesperson, 2)).id, 2);
  assert.equal((await getVisibleEmailThread(dependencies, salesperson, 3)).id, 3);
  await assert.rejects(() => getVisibleEmailThread(dependencies, manager, 3), /Forbidden/);
});

test('one deduplicated thread remains visible to every personal mailbox that received it', async () => {
  const sharedDelivery = {
    id: 3,
    mailboxOwnerUserIds: [7, 8],
    inquiryId: null,
    opportunityId: null
  };
  const dependencies = {
    emailArchiveRepository: { async listThreads() { return [sharedDelivery]; } }
  };

  assert.equal((await listVisibleEmailThreads(dependencies, { id: 7, roles: [ROLES.SALESPERSON] })).length, 1);
  assert.equal((await listVisibleEmailThreads(dependencies, { id: 8, roles: [ROLES.SALESPERSON] })).length, 1);
  assert.equal((await listVisibleEmailThreads(dependencies, { id: 9, roles: [ROLES.SALESPERSON] })).length, 0);
});

test('a shared mailbox delivery keeps manager visibility after the message is deduplicated with personal mail', async () => {
  const sharedDelivery = {
    id: 4,
    mailboxKey: 'markyang@sunkaier.com',
    mailboxOwnerUserIds: [7],
    hasSharedMailboxDelivery: true,
    inquiryId: 8,
    opportunityId: null
  };
  const dependencies = {
    emailArchiveRepository: { async listThreads() { return [sharedDelivery]; } }
  };

  assert.equal((await listVisibleEmailThreads(dependencies, { id: 7, roles: [ROLES.SALESPERSON] })).length, 1);
  assert.equal((await listVisibleEmailThreads(dependencies, { id: 2, roles: [ROLES.SALES_MANAGER] })).length, 1);
  assert.equal((await listVisibleEmailThreads(dependencies, { id: 8, roles: [ROLES.SALESPERSON] })).length, 0);
});

test('manual opportunity linking is limited to visible active opportunities and cannot be changed', async () => {
  const actor = { id: 7, roles: [ROLES.SALESPERSON] };
  const thread = { id: 3, mailboxOwnerUserId: 7, inquiryId: null, opportunityId: null, triageStatus: 'pending' };
  const opportunity = {
    id: 20,
    salespersonId: 7,
    salesManagerId: 2,
    quotationEngineerId: 3,
    technicalManagerId: 6,
    commercialManagerId: 9
  };
  let listFilter;
  let linked;
  const dependencies = {
    emailArchiveRepository: {
      async findThreadById() { return thread; },
      async linkThreadToOpportunity(threadId, opportunityId) {
        linked = [threadId, opportunityId];
        thread.opportunityId = Number(opportunityId);
        return thread;
      },
      async transitionThreadTriage(input) {
        assert.equal(input.expectedStatus, 'pending');
        thread.triageStatus = input.triageStatus;
        return thread;
      },
      async createTriageEvent(input) {
        assert.equal(input.eventType, 'linked_opportunity');
        return input;
      },
      async getThreadDetail() { return { ...thread, messages: [] }; }
    },
    opportunityRepository: {
      async listOpportunities(filter) { listFilter = filter; return [opportunity]; },
      async getOpportunityDetail(id) { return Number(id) === 20 ? opportunity : null; }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } }
  };

  assert.equal((await listEmailLinkableOpportunities(dependencies, actor)).length, 1);
  assert.deepEqual(listFilter, { archiveScope: 'active', visibleToUserId: 7 });
  assert.equal((await linkEmailThreadToOpportunity(dependencies, actor, 3, 20)).opportunityId, 20);
  assert.deepEqual(linked, [3, 20]);
  await assert.rejects(
    () => linkEmailThreadToOpportunity(dependencies, actor, 3, 21),
    (error) => error.statusCode === 409
  );
});

test('thread visibility forwards the requested archive folder without changing RBAC checks', async () => {
  let receivedFilter;
  const dependencies = {
    emailArchiveRepository: {
      async listThreads(filter) { receivedFilter = filter; return [{ id: 1, inquiryId: 8, opportunityId: null }]; }
    }
  };

  const manager = { id: 2, roles: [ROLES.SALES_MANAGER] };
  const threads = await listVisibleEmailThreads(dependencies, manager, { archiveDisposition: 'spam' });
  assert.equal(threads.length, 1);
  assert.deepEqual(receivedFilter, { archiveDisposition: 'spam' });
});

test('mailbox picker keeps shared and personal mailbox boundaries role-scoped', async () => {
  const dependencies = {
    sharedAddress: 'sales@sunkaier.com',
    emailArchiveRepository: {
      async listActivePersonalMailboxAssignments() {
        return [
          { userId: 7, mailboxAddress: 'markyang@sunkaier.com', displayName: 'Mark' },
          { userId: 8, mailboxAddress: 'helena@sunkaier.com', displayName: 'Helena' }
        ];
      }
    }
  };

  const manager = await listVisibleEmailMailboxes(dependencies, { id: 2, roles: [ROLES.SALES_MANAGER] });
  assert.deepEqual(manager.map((mailbox) => mailbox.key), ['sales@sunkaier.com']);
  const owner = await listVisibleEmailMailboxes(dependencies, { id: 7, roles: [ROLES.SALESPERSON] });
  assert.deepEqual(owner.map((mailbox) => mailbox.key), ['markyang@sunkaier.com']);
  const administrator = await listVisibleEmailMailboxes(dependencies, { id: 1, roles: [ROLES.ADMINISTRATOR] });
  assert.deepEqual(administrator.map((mailbox) => mailbox.key), [
    'sales@sunkaier.com',
    'markyang@sunkaier.com',
    'helena@sunkaier.com'
  ]);
  await assert.rejects(
    () => resolveVisibleEmailMailbox(dependencies, { id: 7, roles: [ROLES.SALESPERSON] }, 'helena@sunkaier.com'),
    (error) => error.statusCode === 403
  );
});

function triageMemory(threadOverrides = {}) {
  const thread = {
    id: 30,
    mailboxKey: 'sales@sunkaier.com',
    mailboxKeys: ['sales@sunkaier.com'],
    mailboxOwnerUserIds: [],
    hasSharedMailboxDelivery: true,
    triageStatus: 'pending',
    triageAssignedUserId: null,
    inquiryId: null,
    opportunityId: null,
    customerId: null,
    contactId: null,
    customerName: '',
    messages: [{
      id: 40,
      direction: 'inbound',
      messageId: 'pending@example.com',
      fromAddress: 'buyer@example.com',
      fromName: 'Buyer',
      subject: 'RFQ',
      textBody: 'Please quote',
      receivedAt: '2026-09-12T01:00:00Z'
    }],
    ...threadOverrides
  };
  const events = [];
  const repository = {
    async findThreadById() { return thread; },
    async getThreadDetail() { return thread; },
    async linkThreadToInquiry(id, inquiryId) {
      if (thread.inquiryId) return null;
      thread.inquiryId = Number(inquiryId);
      return thread;
    },
    async linkThreadToOpportunity(id, opportunityId) {
      if (thread.opportunityId) return null;
      thread.opportunityId = Number(opportunityId);
      return thread;
    },
    async assignThreadTriage(input) {
      if (thread.triageStatus !== 'pending') return null;
      thread.triageAssignedUserId = Number(input.assignedUserId);
      return thread;
    },
    async transitionThreadTriage(input) {
      if (thread.triageStatus !== input.expectedStatus) return null;
      thread.triageStatus = input.triageStatus;
      thread.archiveDisposition = input.archiveDisposition;
      return thread;
    },
    async createTriageEvent(input) { events.push(input); return input; }
  };
  return { thread, events, repository };
}

test('manual inquiry conversion is atomic idempotent and records one audit event', async () => {
  const memory = triageMemory();
  const inquiries = [];
  const inquiryRepository = {
    async createInquiry(input) {
      const inquiry = { id: 91, ...input };
      inquiries.push(inquiry);
      return inquiry;
    },
    async findById(id) { return Number(id) === 91 ? inquiries[0] : null; }
  };
  const dependencies = {
    emailArchiveRepository: memory.repository,
    inquiryRepository,
    now: () => '2026-09-12T02:00:00Z',
    emailArchiveTransaction: (callback) => callback({
      emailArchiveRepository: memory.repository,
      inquiryRepository
    })
  };
  const actor = { id: 2, roles: [ROLES.SALES_MANAGER] };

  const first = await convertEmailThreadToInquiry(dependencies, actor, 30);
  const second = await convertEmailThreadToInquiry(dependencies, actor, 30);

  assert.equal(first.inquiry.id, 91);
  assert.equal(second.inquiry.id, 91);
  assert.equal(inquiries.length, 1);
  assert.equal(inquiries[0].sourceReference, 'pending@example.com');
  assert.equal(inquiries[0].requirementText, 'Please quote');
  assert.equal(memory.thread.triageStatus, 'converted_inquiry');
  assert.equal(memory.events.length, 1);
  assert.equal(memory.events[0].eventType, 'converted_inquiry');
  assert.equal(memory.events[0].inquiryId, 91);
});

test('email intake context prefills a lead and converted mail becomes a lead instead of an inquiry', async () => {
  const memory = triageMemory();
  const leads = [];
  const users = [
    { id: 2, displayName: 'Manager', isActive: true, roles: [ROLES.SALES_MANAGER] },
    { id: 7, displayName: 'Sales', isActive: true, roles: [ROLES.SALESPERSON] }
  ];
  const inquiryRepository = {
    async createInquiry(input) {
      const lead = { id: 92, ...input };
      leads.push(lead);
      return lead;
    },
    async findById(id) { return Number(id) === 92 ? leads[0] : null; }
  };
  const userRepository = { async listUsersWithRoles() { return users; } };
  const dependencies = {
    emailArchiveRepository: memory.repository,
    inquiryRepository,
    userRepository,
    now: () => '2026-09-12T02:00:00Z',
    emailArchiveTransaction: (callback) => callback({
      emailArchiveRepository: memory.repository,
      inquiryRepository,
      userRepository
    })
  };
  const actor = users[0];

  const context = await getEmailThreadIntakeContext(dependencies, actor, 30);
  assert.equal(context.draft.sourceChannel, 'email');
  assert.equal(context.draft.contactEmail, 'buyer@example.com');
  assert.equal(context.draft.requirementText, 'Please quote');

  const first = await convertEmailThreadToLead(dependencies, actor, 30, {
    submissionToken: '05ab97d9-7bc5-4db0-973a-d68315c4ae8c',
    assignedUserId: 2,
    recommendedSalespersonId: 7,
    companyName: 'Acme',
    requirementText: 'Please quote one mixer'
  });
  const second = await convertEmailThreadToLead(dependencies, actor, 30, {});

  assert.equal(first.lead.id, 92);
  assert.equal(second.lead.id, 92);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].submissionType, 'sales_lead');
  assert.equal(leads[0].sourceChannel, 'email');
  assert.equal(leads[0].rawPayload.emailThreadId, 30);
  assert.equal(memory.thread.triageStatus, 'converted_lead');
  assert.equal(memory.events[0].eventType, 'converted_lead');
});

test('existing-customer email creates and links one opportunity atomically', async () => {
  const memory = triageMemory({ customerId: 10, contactId: 20 });
  const created = [];
  const customerRepository = {
    async getCustomerDetail(id) {
      return Number(id) === 10 ? { id: 10, ownerUserId: 7, archivedAt: null } : null;
    }
  };
  const contactRepository = {
    async getContactDetail(id) {
      return Number(id) === 20
        ? { id: 20, customerId: 10, customerOwnerUserId: 7, archivedAt: null }
        : null;
    }
  };
  const opportunityRepository = {
    async createOpportunity(input) {
      const opportunity = { id: 51, ...input };
      created.push(opportunity);
      return opportunity;
    }
  };
  const userRepository = {
    async listUsersByRole() {
      return [{ id: 7, isActive: true, roles: [ROLES.SALESPERSON] }];
    }
  };
  const dependencies = {
    emailArchiveRepository: memory.repository,
    customerRepository,
    contactRepository,
    opportunityRepository,
    userRepository,
    now: () => '2026-09-12T02:00:00Z',
    emailArchiveTransaction: (callback) => callback({
      emailArchiveRepository: memory.repository,
      customerRepository,
      contactRepository,
      opportunityRepository,
      userRepository
    })
  };

  const result = await createOpportunityFromEmailThread(
    dependencies,
    { id: 2, roles: [ROLES.SALES_MANAGER] },
    30,
    {
      salespersonId: 7,
      customerId: 10,
      primaryContactId: 20,
      title: 'Mixer project',
      requirement: 'Please quote one mixer'
    }
  );

  assert.equal(result.opportunity.id, 51);
  assert.equal(created.length, 1);
  assert.equal(created[0].originInquiryId, null);
  assert.equal(memory.thread.opportunityId, 51);
  assert.equal(memory.thread.triageStatus, 'linked_opportunity');
  assert.equal(memory.events[0].opportunityId, 51);
});

test('linking an existing inquiry completes pending triage without creating another inquiry', async () => {
  const memory = triageMemory();
  let created = 0;
  const dependencies = {
    emailArchiveRepository: memory.repository,
    inquiryRepository: {
      async findById(id) { return Number(id) === 81 ? { id: 81, status: 'new' } : null; },
      async createInquiry() { created += 1; }
    },
    now: () => '2026-09-12T02:00:00Z'
  };
  const actor = { id: 2, roles: [ROLES.SALES_MANAGER] };

  await linkEmailThreadToInquiry(dependencies, actor, 30, 81);

  assert.equal(created, 0);
  assert.equal(memory.thread.inquiryId, 81);
  assert.equal(memory.thread.triageStatus, 'linked_inquiry');
  assert.equal(memory.events[0].eventType, 'linked_inquiry');
});

test('assignment and archive actions are idempotent and append audit events once', async () => {
  const memory = triageMemory();
  const actor = { id: 2, roles: [ROLES.SALES_MANAGER], isActive: true };
  const dependencies = {
    emailArchiveRepository: memory.repository,
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === 2 ? actor : null;
      }
    },
    now: () => '2026-09-12T02:00:00Z'
  };

  await assignEmailThreadTriage(dependencies, actor, 30, 2);
  await assignEmailThreadTriage(dependencies, actor, 30, 2);
  await setEmailThreadDisposition(dependencies, actor, 30, 'archive', 'not actionable');
  await setEmailThreadDisposition(dependencies, actor, 30, 'archive', 'not actionable');

  assert.equal(memory.thread.triageAssignedUserId, 2);
  assert.equal(memory.thread.triageStatus, 'archived');
  assert.equal(memory.thread.archiveDisposition, 'archived');
  assert.deepEqual(memory.events.map((event) => event.eventType), ['assigned', 'archived']);
  assert.equal(memory.events[1].note, 'not actionable');
});

test('misclassified spam can be restored to pending with an immutable reopen event', async () => {
  const memory = triageMemory({ triageStatus: 'spam', archiveDisposition: 'spam' });
  const actor = { id: 2, roles: [ROLES.SALES_MANAGER] };

  await setEmailThreadDisposition({
    emailArchiveRepository: memory.repository,
    now: () => '2026-10-12T02:00:00Z'
  }, actor, 30, 'restore');

  assert.equal(memory.thread.triageStatus, 'pending');
  assert.equal(memory.thread.archiveDisposition, 'active');
  assert.equal(memory.events[0].eventType, 'reopened');
  assert.equal(memory.events[0].fromStatus, 'spam');
  assert.equal(memory.events[0].toStatus, 'pending');
});

test('spam cleanup summary is administrator-only and immediate during system debugging', async () => {
  const calls = [];
  const dependencies = {
    emailArchiveRepository: {
      async getSpamCleanupSummary(input) {
        calls.push(input);
        return { eligibleThreads: 4, messages: 5, attachments: 2, attachmentBytes: 100, rawMessages: 5, rawMessageBytes: 200 };
      }
    }
  };
  await assert.rejects(
    () => getEmailSpamCleanupSummary(dependencies, { id: 2, roles: [ROLES.SALES_MANAGER] }),
    (error) => error.statusCode === 403
  );

  const summary = await getEmailSpamCleanupSummary(
    dependencies,
    { id: 1, roles: [ROLES.ADMINISTRATOR] },
    'Sales@Sunkaier.com'
  );
  assert.equal(summary.eligibleThreads, 4);
  assert.deepEqual(calls[0], {
    mailboxKey: 'sales@sunkaier.com'
  });
});

test('non-business cleanup uses the separate folder scope and administrator guard', async () => {
  const calls = [];
  const dependencies = {
    emailArchiveRepository: {
      async getCleanupSummary(input) {
        calls.push(input);
        return { eligibleThreads: 2, messages: 3, attachments: 0, attachmentBytes: 0, rawMessages: 3, rawMessageBytes: 600 };
      },
      async listCleanupCandidates(input) {
        calls.push(input);
        return calls.filter((item) => item.limit).length === 1
          ? [{ threadId: 8, subject: 'System notice' }]
          : [];
      },
      async purgeEmailThread(input) {
        calls.push(input);
        return {
          threadId: 8,
          messageCount: 1,
          attachmentBytes: 0,
          rawMessageBytes: 200,
          attachmentPaths: [],
          rawMessagePaths: []
        };
      }
    },
    uploadDir: './var/uploads'
  };

  const actor = { id: 1, roles: [ROLES.ADMINISTRATOR] };
  const summary = await getEmailCleanupSummary(dependencies, actor, 'Sales@Sunkaier.com', 'non_business');
  assert.equal(summary.eligibleThreads, 2);
  assert.deepEqual(calls[0], { mailboxKey: 'sales@sunkaier.com', folder: 'non_business' });

  const purged = await purgeEligibleEmailFolder(dependencies, actor, {
    mailboxKey: 'sales@sunkaier.com',
    folder: 'non_business',
    confirmation: 'DELETE'
  });
  assert.equal(purged.purgedThreads, 1);
  assert.match(calls.find((item) => item.reason)?.reason || '', /non-business mail list/);
});

test('administrator spam purge requires typed confirmation and continues until every listed spam thread is gone', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-spam-purge-'));
  const attachmentPath = 'email-archive/spam.pdf';
  const rawPath = 'email-raw/spam.eml';
  await mkdir(path.join(uploadDir, 'email-archive'), { recursive: true });
  await mkdir(path.join(uploadDir, 'email-raw'), { recursive: true });
  await writeFile(path.join(uploadDir, attachmentPath), 'spam attachment');
  await writeFile(path.join(uploadDir, rawPath), 'raw spam');
  const administrator = { id: 1, roles: [ROLES.ADMINISTRATOR] };
  const purgeCalls = [];
  let listCalls = 0;
  const repository = {
    async listSpamPurgeCandidates(input) {
      assert.equal(input.mailboxKey, 'sales@sunkaier.com');
      listCalls += 1;
      if (listCalls === 1) return [{ threadId: 8, subject: 'SEO spam' }];
      if (listCalls === 2) return [{ threadId: 9, subject: 'More spam' }];
      return [];
    },
    async purgeEmailThread(input) {
      purgeCalls.push(input);
      if (Number(input.threadId) === 9) {
        return {
          threadId: 9,
          messageCount: 1,
          attachmentCount: 0,
          attachmentBytes: 0,
          rawMessageCount: 0,
          rawMessageBytes: 0,
          attachmentPaths: [],
          rawMessagePaths: []
        };
      }
      return {
        threadId: 8,
        messageCount: 1,
        attachmentCount: 1,
        attachmentBytes: 15,
        rawMessageCount: 1,
        rawMessageBytes: 8,
        attachmentPaths: [attachmentPath],
        rawMessagePaths: [rawPath]
      };
    }
  };
  const dependencies = {
    uploadDir,
    emailArchiveRepository: repository,
    emailArchiveTransaction: (callback) => callback({ emailArchiveRepository: repository })
  };
  try {
    await assert.rejects(
      () => purgeEligibleEmailSpam(dependencies, administrator, { confirmation: 'delete' }),
      (error) => error.statusCode === 400
    );
    const result = await purgeEligibleEmailSpam(dependencies, administrator, {
      confirmation: 'DELETE',
      mailboxKey: 'sales@sunkaier.com'
    });
    assert.equal(result.purgedThreads, 2);
    assert.equal(result.purgedMessages, 2);
    assert.equal(result.purgedBytes, 23);
    assert.deepEqual(result.fileFailures, []);
    assert.equal(purgeCalls[0].actorUserId, 1);
    assert.match(purgeCalls[0].subjectSha256, /^[0-9a-f]{64}$/);
    assert.match(purgeCalls[0].reason, /permanent deletion from the spam list/);
    assert.equal(purgeCalls.length, 2);
    assert.equal(listCalls, 3);
    await assert.rejects(() => readFile(path.join(uploadDir, attachmentPath)), /ENOENT/);
    await assert.rejects(() => readFile(path.join(uploadDir, rawPath)), /ENOENT/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('administrator may immediately delete only a repository-approved unlinked inbound thread', async () => {
  const administrator = { id: 1, roles: [ROLES.ADMINISTRATOR] };
  const manager = { id: 2, roles: [ROLES.SALES_MANAGER] };
  const unlinked = {
    id: 8,
    subject: 'test message',
    mailboxKey: 'sales@sunkaier.com',
    inquiryId: null,
    opportunityId: null,
    customerId: null,
    contactId: null
  };
  let eligible = true;
  const repository = {
    async findThreadById(id) { return Number(id) === 8 ? unlinked : null; },
    async isThreadPurgeEligible(id) { return Number(id) === 8 && eligible; },
    async purgeEmailThread(input) {
      if (!eligible) return null;
      assert.equal(input.threadId, 8);
      assert.equal(input.actorUserId, 1);
      assert.match(input.subjectSha256, /^[0-9a-f]{64}$/);
      return {
        threadId: 8,
        messageCount: 1,
        attachmentBytes: 0,
        rawMessageBytes: 0,
        attachmentPaths: [],
        rawMessagePaths: []
      };
    }
  };
  const dependencies = {
    emailArchiveRepository: repository,
    emailArchiveTransaction: (callback) => callback({ emailArchiveRepository: repository })
  };

  assert.equal(await canPurgeEmailThread(dependencies, manager, 8), false);
  assert.equal(await canPurgeEmailThread(dependencies, administrator, 8), true);
  await assert.rejects(
    () => purgeEmailThread(dependencies, manager, 8, { confirmation: 'DELETE' }),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    () => purgeEmailThread(dependencies, administrator, 8, { confirmation: 'delete' }),
    (error) => error.statusCode === 400
  );
  const result = await purgeEmailThread(dependencies, administrator, 8, { confirmation: 'DELETE' });
  assert.equal(result.purgedThreads, 1);
  assert.equal(result.purgedMessages, 1);

  eligible = false;
  assert.equal(await canPurgeEmailThread(dependencies, administrator, 8), false);
  await assert.rejects(
    () => purgeEmailThread(dependencies, administrator, 8, { confirmation: 'DELETE' }),
    (error) => error.statusCode === 409
  );
});
