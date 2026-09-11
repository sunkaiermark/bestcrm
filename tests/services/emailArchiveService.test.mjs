import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  archiveInboundEmailRecord,
  getVisibleEmailThread,
  listVisibleEmailThreads,
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

test('new inbound thread creates one protected inquiry before archiving the message', async () => {
  const calls = [];
  const thread = { id: 3, inquiryId: 8, opportunityId: null, lastMessageAt: '2026-09-03T01:00:00Z' };
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

  assert.deepEqual(calls, [['inquiry', 'rfq@example.com'], ['thread', 8], ['message', 3]]);
  assert.equal(result.inquiry.id, 8);
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

test('high-confidence spam creates no inquiry, thread, message, or archive record', async () => {
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
      async createThread() { calls.push('thread'); },
      async createInboundMessage() { calls.push('message'); }
    }
  }, spam);

  assert.deepEqual(calls, []);
  assert.equal(result.rejectedSpam, true);
  assert.equal(result.message, null);
  assert.equal(result.thread, null);
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

  assert.equal(created.inquiry.status, 'new');
  assert.equal(created.inquiry.matchedCustomerId, 10);
  assert.equal(created.inquiry.matchedContactId, 20);
  assert.equal(created.thread.archiveDisposition, 'active');
  assert.equal(created.message.classificationReason, 'known_contact_email');
  assert.equal(created.inquiry.rawPayload.emailFilter.entryDecision, 'accept');
  assert.deepEqual(created.inquiry.rawPayload.emailFilter.protectedReasons, ['known_contact_email']);
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
