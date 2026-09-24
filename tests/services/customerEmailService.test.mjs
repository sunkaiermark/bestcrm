import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { simpleParser } from 'mailparser';
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
  assert.match(personalEmailSignatureHtmlPreview(completeActor), /width="245" height="36"/);
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
  const outboundMimeArtifacts = [];
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
  const approvedFileSources = options.approvedFileSources || [];
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
    async findOutboundMimeArtifact(id) {
      return outboundMimeArtifacts.find((item) => item.messageId === Number(id)) || null;
    },
    async createOutboundMimeArtifact(input) {
      const existing = outboundMimeArtifacts.find((item) => item.messageId === Number(input.messageId));
      if (existing) return existing;
      const artifact = { id: outboundMimeArtifacts.length + 1, ...input };
      outboundMimeArtifacts.push(artifact);
      return artifact;
    },
    async touchThread(id, at) { thread.lastMessageAt = at; return thread; },
    async claimOutboundForSend(id) {
      const message = messages.find((item) => item.id === Number(id));
      if (!message || !['draft', 'failed'].includes(message.deliveryStatus)) return null;
      if (!outboundMimeArtifacts.some((item) => item.messageId === Number(id))) {
        throw new Error('Outbound MIME must be archived before the message is claimed');
      }
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
    async listApprovedEmailAttachmentChoices() {
      return approvedFileSources.map(({ content, storedPath, ...source }) => source);
    },
    async getApprovedEmailAttachmentSources(input) {
      const technicalIds = new Set(input.technicalDocumentIds.map(Number));
      const attachmentIds = new Set(input.opportunityAttachmentIds.map(Number));
      return approvedFileSources.filter((source) => (
        source.sourceKind === 'technical_document'
          ? technicalIds.has(Number(source.sourceId))
          : attachmentIds.has(Number(source.sourceId))
      ));
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
    transport: options.transport || { async sendMail() { return { messageId: '<provider-default@example.com>' }; } },
    sharedAddress: 'sales@sunkaier.com',
    uploadDir,
    maxUploadMb: options.maxUploadMb ?? 5,
    now: () => '2026-09-03T10:00:00.000Z',
    randomUUID: () => '00000000-0000-4000-8000-000000000009',
    state: { thread, messages, attachments, attempts, sentPackages, outboundMimeArtifacts, packageVersion }
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
    const archivedLogo = dependencies.state.attachments.find((attachment) => (
      attachment.contentId === 'sunkaier-signature-logo@sunkaier.com'
    ));
    assert.equal(archivedLogo.originalName, 'sunkaier-logo.png');
    assert.equal(archivedLogo.mimeType, 'image/png');
    assert.equal(archivedLogo.contentDisposition, 'inline');
    assert.ok(archivedLogo.fileSize > 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('selected approved opportunity files are revalidated and copied into the immutable outbound archive', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  const sent = [];
  const content = Buffer.from('approved technical datasheet');
  const commercialContent = Buffer.from('approved commercial quote');
  const commercialStoredPath = 'approved/Commercial_Quote.pdf';
  const source = {
    token: 'technical_document:61',
    sourceKind: 'technical_document',
    sourceId: 61,
    category: 'technical',
    versionNo: 2,
    versionLabel: 'TS-V2',
    fileType: 'datasheet',
    originalName: 'Mixer_Datasheet.pdf',
    mimeType: 'application/pdf',
    byteSize: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    content,
    storedPath: ''
  };
  const commercialSource = {
    token: 'opportunity_attachment:71',
    sourceKind: 'opportunity_attachment',
    sourceId: 71,
    category: 'commercial',
    versionNo: 3,
    versionLabel: 'CQ-V3',
    fileType: 'commercial_quote',
    originalName: 'Commercial_Quote.pdf',
    mimeType: 'application/pdf',
    byteSize: commercialContent.length,
    sha256: createHash('sha256').update(commercialContent).digest('hex'),
    content: null,
    storedPath: commercialStoredPath
  };
  try {
    await mkdir(path.join(uploadDir, 'approved'), { recursive: true });
    await writeFile(path.join(uploadDir, commercialStoredPath), commercialContent);
    const dependencies = createDependencies(uploadDir, {
      approvedFileSources: [source, commercialSource],
      transport: { async sendMail(message) { sent.push(message); return { messageId: '<approved-file@example.com>' }; } }
    });
    const result = await createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      approvedOpportunityFileTokens: [source.token, commercialSource.token],
      to: 'buyer@example.com',
      subject: 'Approved datasheet',
      body: 'Please find the approved datasheet attached.',
      action: 'send'
    });

    assert.equal(result.deliveryStatus, 'sent');
    const archived = dependencies.state.attachments.find((item) => item.sourceTechnicalDocumentId === 61);
    assert.equal(archived.sourceOpportunityAttachmentId, null);
    assert.equal(archived.originalName, 'Mixer_Datasheet.pdf');
    assert.equal(archived.sha256, source.sha256);
    assert.deepEqual(await readFile(path.join(uploadDir, archived.storedPath)), content);
    const archivedCommercial = dependencies.state.attachments.find((item) => item.sourceOpportunityAttachmentId === 71);
    assert.equal(archivedCommercial.sourceTechnicalDocumentId, null);
    assert.equal(archivedCommercial.sha256, commercialSource.sha256);
    assert.deepEqual(await readFile(path.join(uploadDir, archivedCommercial.storedPath)), commercialContent);
    const parsed = await simpleParser(sent[0].raw);
    assert.deepEqual(
      parsed.attachments.find((item) => item.filename === 'Mixer_Datasheet.pdf').content,
      content
    );
    assert.deepEqual(
      parsed.attachments.find((item) => item.filename === 'Commercial_Quote.pdf').content,
      commercialContent
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('tampered or no-longer-approved opportunity file selections are rejected before draft creation', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  try {
    const dependencies = createDependencies(uploadDir);
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      approvedOpportunityFileTokens: 'technical_document:999',
      to: 'buyer@example.com',
      subject: 'Datasheet',
      body: 'Please find the datasheet attached.',
      action: 'draft'
    }), /no longer approved for this opportunity/);
    assert.equal(dependencies.state.messages.filter((item) => item.direction === 'outbound').length, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('formal package, approved opportunity files, and local uploads share one total attachment limit', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  const content = Buffer.alloc(1024 * 1024 + 1, 1);
  try {
    const dependencies = createDependencies(uploadDir, {
      maxUploadMb: 1,
      approvedFileSources: [{
        token: 'technical_document:61',
        sourceKind: 'technical_document',
        sourceId: 61,
        originalName: 'Large_Datasheet.pdf',
        mimeType: 'application/pdf',
        byteSize: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        content,
        storedPath: ''
      }]
    });
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      approvedOpportunityFileTokens: 'technical_document:61',
      to: 'buyer@example.com',
      subject: 'Datasheet',
      body: 'Please find the datasheet attached.',
      action: 'draft'
    }), /Total email attachments exceed 1 MB/);
    assert.equal(dependencies.state.messages.filter((item) => item.direction === 'outbound').length, 0);
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
    assert.deepEqual(sent[0].envelope, {
      from: 'sales@sunkaier.com',
      to: ['buyer@example.com', 'procurement@example.com']
    });
    assert.equal(Buffer.isBuffer(sent[0].raw), true);
    const parsed = await simpleParser(sent[0].raw);
    assert.deepEqual(parsed.from.value[0], { address: 'sales@sunkaier.com', name: 'Steven Yang | SUNKAIER' });
    assert.deepEqual(parsed.to.value.map((item) => item.address), ['buyer@example.com']);
    assert.deepEqual(parsed.cc.value.map((item) => item.address), ['procurement@example.com']);
    assert.equal(parsed.subject, 'Re: Mixer RFQ');
    assert.match(parsed.text, /Steven Yang\nSales Manager\nSUNKAIER Asia Pacific Pte\. Ltd\./);
    assert.match(parsed.text, /W: www\.sunkaier\.com/);
    assert.match(parsed.text, /CONFIDENTIALITY NOTICE:/);
    assert.match(parsed.html, /Steven Yang/);
    assert.match(parsed.html, /src="data:image\/png;base64,/);
    assert.match(sent[0].raw.toString('utf8'), /Content-ID: <sunkaier-signature-logo@sunkaier\.com>/i);
    assert.match(parsed.html, /Attached is our approved quotation\./);
    assert.equal(parsed.messageId, '<bestcrm-00000000-0000-4000-8000-000000000009@sunkaier.com>');
    assert.equal(parsed.inReplyTo, '<buyer-1@example.com>');
    assert.deepEqual(parsed.references, ['<root@example.com>', '<buyer-1@example.com>']);
    const quotationAttachment = parsed.attachments.find((item) => item.filename === 'QP-V2.pdf');
    assert.deepEqual(quotationAttachment.content, Buffer.from('approved quotation'));
    const inlineLogo = parsed.attachments.find((item) => item.filename === 'sunkaier-logo.png');
    assert.equal(inlineLogo.filename, 'sunkaier-logo.png');
    assert.equal(inlineLogo.contentType, 'image/png');
    assert.equal(inlineLogo.contentId, '<sunkaier-signature-logo@sunkaier.com>');
    assert.equal(inlineLogo.contentDisposition, 'inline');
    assert.equal(dependencies.state.outboundMimeArtifacts.length, 1);
    const artifact = dependencies.state.outboundMimeArtifacts[0];
    assert.equal(artifact.rfcMessageId, parsed.messageId);
    assert.equal(artifact.fileSize, sent[0].raw.length);
    assert.equal(artifact.sha256, createHash('sha256').update(sent[0].raw).digest('hex'));
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
  const submittedRaw = [];
  try {
    const dependencies = createDependencies(uploadDir, {
      transport: {
        async sendMail(message) {
          submittedRaw.push(Buffer.from(message.raw));
          if (fail) throw Object.assign(new Error('temporary SMTP rejection'), { code: 'ETEMP' });
          return { messageId: '<provider-retry@example.com>' };
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
    assert.equal(dependencies.state.outboundMimeArtifacts.length, 1);
    assert.equal(submittedRaw.length, 2);
    assert.deepEqual(submittedRaw[1], submittedRaw[0]);
    assert.equal(
      dependencies.state.outboundMimeArtifacts[0].sha256,
      createHash('sha256').update(submittedRaw[0]).digest('hex')
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
