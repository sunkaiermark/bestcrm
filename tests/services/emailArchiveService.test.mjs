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

test('thread visibility keeps unlinked mail manager-only and uses opportunity membership when linked', async () => {
  const unlinked = { id: 1, inquiryId: 8, opportunityId: null };
  const linked = { id: 2, inquiryId: 9, opportunityId: 20 };
  const dependencies = {
    emailArchiveRepository: {
      async listThreads() { return [unlinked, linked]; },
      async findThreadById(id) { return Number(id) === 2 ? linked : unlinked; },
      async getThreadDetail(id) { return { ...(Number(id) === 2 ? linked : unlinked), messages: [] }; }
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return { id: 20, salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3, technicalManagerId: 6, commercialManagerId: 9 };
      }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } }
  };

  const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };
  const manager = { id: 2, roles: [ROLES.SALES_MANAGER] };
  assert.deepEqual((await listVisibleEmailThreads(dependencies, salesperson)).map((item) => item.id), [2]);
  assert.deepEqual((await listVisibleEmailThreads(dependencies, manager)).map((item) => item.id), [1, 2]);
  await assert.rejects(() => getVisibleEmailThread(dependencies, salesperson, 1), /Forbidden/);
  assert.equal((await getVisibleEmailThread(dependencies, salesperson, 2)).id, 2);
});
