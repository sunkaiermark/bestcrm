import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  assignEmailThreadTriage,
  archiveInboundEmailRecord,
  archiveImportedOutboundEmailRecord,
  convertEmailThreadToInquiry,
  getVisibleEmailThread,
  linkEmailThreadToInquiry,
  linkEmailThreadToOpportunity,
  listEmailLinkableOpportunities,
  listVisibleEmailMailboxes,
  listVisibleEmailThreads,
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
      async createImportedOutboundMessage(input) {
        captured.message = input;
        return { id: 13, ...input, direction: 'outbound' };
      },
      async createMailboxDelivery(input) { captured.delivery = input; return input; },
      async touchThread(id, at) { captured.touch = [id, at]; }
    }
  }, candidate);

  assert.equal(result.duplicate, false);
  assert.equal(captured.message.threadId, 4);
  assert.equal(captured.message.authoredBy, 7);
  assert.equal(captured.delivery.direction, 'outbound');
  assert.equal(captured.delivery.mailboxKey, 'markyang@sunkaier.com');
  assert.deepEqual(captured.touch, [4, '2026-09-03T02:00:00Z']);
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
