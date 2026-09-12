import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  buildPersonalEmailIdentity,
  createCustomerEmailDraft,
  personalEmailSignatureHtmlPreview,
  personalEmailSignaturePreview,
  sendCustomerEmail
} from '../../src/services/customerEmailService.mjs';

function actor(overrides = {}) {
  return {
    id: 7,
    displayName: 'Steven Yang',
    emailSignatureName: 'Steven Yang',
    emailSignatureTitle: 'Sales Manager',
    email: 'steven.yang@sunkaier.com',
    phone: '+65 6000 0000',
    roles: [ROLES.SALESPERSON],
    ...overrides
  };
}

test('signature preview uses the exact identity signature and stays unavailable for incomplete profiles', () => {
  const completeActor = actor();
  assert.equal(
    personalEmailSignaturePreview(completeActor),
    buildPersonalEmailIdentity(completeActor).signature
  );
  assert.equal(
    personalEmailSignatureHtmlPreview(completeActor),
    buildPersonalEmailIdentity(completeActor).signaturePreviewHtml
  );
  assert.match(personalEmailSignaturePreview(completeActor), /W: www\.sunkaier\.com/);
  assert.match(personalEmailSignaturePreview(completeActor), /SUNKAIER Asia Pacific Pte\. Ltd\./);
  assert.match(personalEmailSignaturePreview(completeActor), /2 Venture Drive, #10-30, Vision Exchange, Singapore 608526/);
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /mailto:steven\.yang@sunkaier\.com/);
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /SUNKAIER Asia Pacific Pte\. Ltd\./);
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /src="\/assets\/sunkaier-logo-email\.png"/);
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /2 Venture Drive, #10-30, Vision Exchange, Singapore 608526/);
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /CONFIDENTIALITY NOTICE:/);
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /www\.sunkaier\.com/);
  assert.equal(personalEmailSignaturePreview(actor({ emailSignatureTitle: '' })), '');
  assert.equal(personalEmailSignatureHtmlPreview(actor({ emailSignatureTitle: '' })), '');
});

test('HTML signature escapes employee-controlled profile fields', () => {
  const signature = personalEmailSignatureHtmlPreview(actor({
    emailSignatureName: '<script>alert(1)</script>',
    emailSignatureTitle: 'Sales & Service',
    phone: '<img src=x onerror=alert(2)>'
  }));
  assert.doesNotMatch(signature, /<script>|<img src=x/);
  assert.match(signature, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(signature, /Sales &amp; Service/);
  assert.match(signature, /&lt;img src=x onerror=alert\(2\)&gt;/);
});

function createDependencies(uploadDir, options = {}) {
  const messages = [];
  const attachments = [];
  const attempts = [];
  const sentPackages = [];
  const parent = {
    id: 10,
    threadId: 1,
    direction: 'inbound',
    messageId: '<buyer-1@example.com>',
    inReplyTo: '',
    referenceIds: ['<root@example.com>'],
    deliveryStatus: 'received'
  };
  messages.push(parent);
  const thread = {
    id: 1,
    mailboxKey: 'sales@sunkaier.com',
    subject: 'Mixer RFQ',
    inquiryId: 8,
    opportunityId: 20,
    customerId: 3,
    contactId: 4,
    lastMessageAt: '2026-09-03T00:00:00.000Z'
  };
  const packageContent = Buffer.from('approved quotation');
  const packageVersion = {
    id: 71,
    opportunityId: 20,
    status: options.packageStatus || 'approved',
    versionNo: 2,
    label: 'QP-V2',
    currency: 'USD',
    totalPrice: 1000
  };
  let messageSequence = 20;
  const emailArchiveRepository = {
    async findThreadById(id) { return Number(id) === thread.id ? thread : null; },
    async findLatestThreadByOpportunity() { return options.existingThread === false ? null : thread; },
    async findLatestThreadByInquiry() { return options.existingThread === false ? null : thread; },
    async getThreadDetail() { return { ...thread, messages }; },
    async findMessageById(id) { return messages.find((item) => item.id === Number(id)) || null; },
    async createThread(input) { return Object.assign(thread, input); },
    async createOutboundMessage(input) {
      const message = {
        id: ++messageSequence,
        direction: 'outbound',
        providerMessageId: '',
        failureCode: '',
        failureDetail: '',
        sentAt: null,
        ...input
      };
      messages.push(message);
      return message;
    },
    async createAttachment(input) {
      const attachment = { id: attachments.length + 1, ...input };
      attachments.push(attachment);
      return attachment;
    },
    async listAttachmentsByMessage(id) { return attachments.filter((item) => item.messageId === Number(id)); },
    async touchThread(id, at) { thread.lastMessageAt = at; return thread; },
    async claimOutboundForSend(id) {
      const message = messages.find((item) => item.id === Number(id));
      if (!message || !['draft', 'failed'].includes(message.deliveryStatus)) return null;
      message.deliveryStatus = 'pending';
      message.failureCode = '';
      message.failureDetail = '';
      return message;
    },
    async completeOutboundDelivery(input) {
      const message = messages.find((item) => item.id === Number(input.messageId));
      if (!message || message.deliveryStatus !== 'pending') return null;
      Object.assign(message, {
        deliveryStatus: input.status,
        providerMessageId: input.providerMessageId || '',
        failureCode: input.failureCode || '',
        failureDetail: input.failureDetail || '',
        sentAt: input.sentAt || message.sentAt
      });
      return message;
    },
    async createDeliveryAttempt(input) {
      const attempt = { id: attempts.length + 1, attemptNumber: attempts.length + 1, ...input };
      attempts.push(attempt);
      return attempt;
    }
  };
  const quotationPackageRepository = {
    async getPackageDetail(id) { return Number(id) === packageVersion.id ? packageVersion : null; },
    async listByOpportunity() { return [packageVersion]; },
    async getEmailAttachmentSources() {
      return [{
        sourceType: 'technical_solution_document',
        originalName: 'QP-V2.pdf',
        mimeType: 'application/pdf',
        byteSize: packageContent.length,
        sha256: createHash('sha256').update(packageContent).digest('hex'),
        content: packageContent,
        storedPath: ''
      }];
    },
    async markSent(input) {
      if (packageVersion.status !== 'approved') return null;
      packageVersion.status = 'sent';
      sentPackages.push(input);
      return packageVersion;
    }
  };
  return {
    emailArchiveRepository,
    inquiryRepository: { async findById() { return { id: 8, contactEmail: 'buyer@example.com' }; } },
    opportunityRepository: {
      async getOpportunityDetail() {
        return {
          id: 20,
          opportunityNo: '800020',
          title: 'Mixer Project',
          customerId: 3,
          primaryContactId: 4,
          salespersonId: 7,
          salesManagerId: 2,
          quotationEngineerId: 6,
          technicalManagerId: 9,
          commercialManagerId: 12
        };
      }
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() { return options.teamMembers || []; }
    },
    quotationPackageRepository,
    transport: options.transport || { async sendMail(message) { return { messageId: message.messageId }; } },
    sharedAddress: 'sales@sunkaier.com',
    uploadDir,
    maxUploadMb: 5,
    now: () => '2026-09-03T10:00:00.000Z',
    randomUUID: () => '00000000-0000-4000-8000-000000000009',
    state: { thread, messages, attachments, attempts, sentPackages, packageVersion }
  };
}

test('a CRM-native outbound opportunity thread starts linked and never enters pending triage', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  try {
    const dependencies = createDependencies(uploadDir, { existingThread: false });
    const draft = await createCustomerEmailDraft(dependencies, actor(), {
      opportunityId: 20,
      to: 'buyer@example.com',
      subject: 'Mixer proposal',
      body: 'Please review our proposal.',
      action: 'draft'
    });

    assert.equal(draft.deliveryStatus, 'draft');
    assert.equal(dependencies.state.thread.opportunityId, 20);
    assert.equal(dependencies.state.thread.triageStatus, 'linked_opportunity');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('supporting engineer without per-opportunity permission can save but cannot send a draft', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  try {
    const supporting = actor({
      id: 15,
      roles: [ROLES.QUOTATION_ENGINEER],
      emailSignatureName: 'Alex Chen',
      emailSignatureTitle: 'Supporting Engineer'
    });
    const dependencies = createDependencies(uploadDir, {
      teamMembers: [{ userId: 15, isActive: true, canSendExternalEmail: false }]
    });
    const draft = await createCustomerEmailDraft(dependencies, supporting, {
      threadId: 1,
      to: 'buyer@example.com',
      subject: 'Technical clarification',
      body: 'Please review the clarification.',
      action: 'draft'
    });
    assert.equal(draft.deliveryStatus, 'draft');
    await assert.rejects(() => sendCustomerEmail(dependencies, supporting, draft.id), /save a draft but cannot send/);
    assert.equal(dependencies.state.attempts.length, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('fake SMTP receives fixed shared sender, personal signature, reply headers, and frozen QP attachment', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  const sent = [];
  try {
    const dependencies = createDependencies(uploadDir, {
      transport: { async sendMail(message) { sent.push(message); return { messageId: '<provider-accepted@example.com>' }; } }
    });
    const result = await createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      replyToMessageId: 10,
      quotationPackageVersionId: 71,
      to: 'buyer@example.com',
      cc: 'procurement@example.com',
      subject: 'Re: Mixer RFQ',
      body: 'Attached is our approved quotation.',
      action: 'send'
    });

    assert.equal(result.deliveryStatus, 'sent');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].from, { name: 'Steven Yang | SUNKAIER', address: 'sales@sunkaier.com' });
    assert.match(sent[0].text, /Steven Yang\nSales Manager\nSUNKAIER Asia Pacific Pte\. Ltd\./);
    assert.match(sent[0].text, /W: www\.sunkaier\.com/);
    assert.match(sent[0].text, /CONFIDENTIALITY NOTICE:/);
    assert.match(sent[0].html, /Steven Yang/);
    assert.match(sent[0].html, /src="cid:sunkaier-signature-logo@sunkaier\.com"/);
    assert.match(sent[0].html, /Attached is our approved quotation\./);
    assert.equal(sent[0].messageId, '<bestcrm-00000000-0000-4000-8000-000000000009@sunkaier.com>');
    assert.equal(sent[0].inReplyTo, '<buyer-1@example.com>');
    assert.deepEqual(sent[0].references, ['<root@example.com>', '<buyer-1@example.com>']);
    assert.equal(sent[0].attachments[0].filename, 'QP-V2.pdf');
    const inlineLogo = sent[0].attachments.at(-1);
    assert.equal(inlineLogo.filename, 'sunkaier-logo.png');
    assert.equal(inlineLogo.contentType, 'image/png');
    assert.match(inlineLogo.path, /src[\\/]public[\\/]assets[\\/]sunkaier-logo-email\.png$/);
    assert.equal(inlineLogo.cid, 'sunkaier-signature-logo@sunkaier.com');
    assert.equal(inlineLogo.contentDisposition, 'inline');
    assert.equal(dependencies.state.sentPackages.length, 1);
    assert.equal(dependencies.state.sentPackages[0].sentEmailMessageId, result.id);
    assert.equal(dependencies.state.attempts[0].status, 'sent');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('unapproved quotation package is rejected before an outbound archive record is created', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  try {
    const dependencies = createDependencies(uploadDir, { packageStatus: 'pending' });
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      quotationPackageVersionId: 71,
      to: 'buyer@example.com',
      subject: 'Quotation',
      body: 'Please see quotation.',
      action: 'send'
    }), /Only an approved QP-Vn/);
    assert.equal(dependencies.state.messages.filter((item) => item.direction === 'outbound').length, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('failed delivery retries the same archived formal quotation message without creating another version', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  let fail = true;
  try {
    const dependencies = createDependencies(uploadDir, {
      transport: {
        async sendMail(message) {
          if (fail) throw Object.assign(new Error('temporary SMTP rejection'), { code: 'ETEMP' });
          return { messageId: message.messageId };
        }
      }
    });
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      quotationPackageVersionId: 71,
      to: 'buyer@example.com',
      subject: 'Quotation',
      body: 'Please see quotation.',
      action: 'send'
    }), /temporary SMTP rejection/);
    const outbound = dependencies.state.messages.find((item) => item.direction === 'outbound');
    assert.equal(outbound.deliveryStatus, 'failed');
    const stableMessageId = outbound.messageId;
    fail = false;
    const retried = await sendCustomerEmail(dependencies, actor(), outbound.id);
    assert.equal(retried.deliveryStatus, 'sent');
    assert.equal(retried.messageId, stableMessageId);
    assert.equal(dependencies.state.messages.filter((item) => item.direction === 'outbound').length, 1);
    assert.deepEqual(dependencies.state.attempts.map((item) => item.status), ['failed', 'sent']);
    assert.equal(dependencies.state.sentPackages.length, 1);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
