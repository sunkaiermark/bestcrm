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
  getCustomerEmailComposeContext,
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
  const chinaIdentity = buildPersonalEmailIdentity(actor({ representedCompanyCode: 'sunkaier_china' }));
  assert.match(chinaIdentity.signature, /JIANGSU SUNKAIER INDUSTRIAL TECHNOLOGY CO\., LTD/);
  assert.match(chinaIdentity.signature, /Yixing, Jiangsu Province, China/);
  assert.doesNotMatch(chinaIdentity.signature, /SUNKAIER Asia Pacific Pte\. Ltd\./);
  assert.throws(
    () => buildPersonalEmailIdentity(actor({ representedCompanyCode: 'unknown_company' })),
    /User represented company is invalid/
  );
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
    async hasUnreleasedTechnicalAttachments() { return options.packageReleaseRevoked === true; },
    async hasUnreleasedArchivedTechnicalAttachments() { return options.directReleaseRevoked === true; },
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
    salesCommercialQuotationDraftRepository: options.salesQuotationRepository,
    transport: options.transport || { async sendMail() { return { messageId: '<provider-default@example.com>' }; } },
    sharedAddress: 'sales@sunkaier.com',
    uploadDir,
    maxUploadMb: options.maxUploadMb ?? 5,
    now: () => '2026-09-03T10:00:00.000Z',
    randomUUID: () => '00000000-0000-4000-8000-000000000009',
    state: { thread, messages, attachments, attempts, sentPackages, outboundMimeArtifacts, packageVersion }
  };
}

test('only a signed, integrity-checked quotation PDF is bound to its opportunity email', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  const content = Buffer.from('%PDF-1.7\nSigned commercial quotation');
  const pdfSha256 = createHash('sha256').update(content).digest('hex');
  const storedPath = 'signed-sales-quotations/frozen.pdf';
  const source = { technicalDraftId: 41, technicalDraftRevisionNo: 1, attachmentId: 51,
    sha256: 'a'.repeat(64), technicalStatus: 'approved' };
  const version = {
    id: 81, opportunityId: 20, quotationNo: 'Q-800020-V1', versionNo: 1,
    status: 'signed', sourceTechnicalDraftId: 41, sourceAttachmentId: 51,
    sourceSha256: source.sha256, pdfStoredPath: storedPath,
    pdfSha256, pdfFileSize: content.length,
    snapshot: { seller: { code: 'sunkaier_china', legalName: '江苏胜开尔工业技术有限公司',
      address: 'Approved address', phone: '+86 000', website: 'https://www.sunkaier.com',
      email: 'sales@sunkaier.com' } }
  };
  let newerSource = null;
  const salesQuotationRepository = {
    async getFormalVersion() { return version; },
    async listFormalVersions() { return [version]; },
    async getTechnicalSource() { return source; },
    async listTechnicalSources() { return newerSource ? [source, newerSource] : [source]; }
  };
  const sent = [];
  const chinaSender = actor({ representedCompanyCode: 'sunkaier_china' });
  try {
    await mkdir(path.dirname(path.join(uploadDir, storedPath)), { recursive: true });
    await writeFile(path.join(uploadDir, storedPath), content);
    const dependencies = createDependencies(uploadDir, {
      salesQuotationRepository,
      transport: { async sendMail(message) { sent.push(message); return { messageId: '<signed@example.com>' }; } }
    });
    await assert.rejects(() => getCustomerEmailComposeContext(dependencies, actor(), {
      opportunityId: 20, salesQuotationVersionId: '81'
    }), /quotation seller does not match the user represented company/);
    const compose = await getCustomerEmailComposeContext(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81'
    });
    assert.match(compose.signatureHtmlPreview, /JIANGSU SUNKAIER INDUSTRIAL TECHNOLOGY CO\., LTD/);
    assert.match(compose.signatureHtmlPreview, /Approved address/);
    assert.match(compose.signatureHtmlPreview, /\+86 000/);
    assert.equal(compose.salesQuotationVersions.length, 1);
    const result = await createCustomerEmailDraft(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81', to: 'buyer@example.com',
      subject: 'Signed quotation', body: 'Please find our signed quotation.', action: 'send'
    });
    assert.equal(result.salesQuotationVersionId, 81);
    assert.equal(result.quotationPackageVersionId, null);
    const parsed = await simpleParser(sent[0].raw);
    assert.deepEqual(parsed.attachments.find((item) => item.filename === 'Q-800020-V1.pdf').content, content);
    assert.match(parsed.html, /JIANGSU SUNKAIER INDUSTRIAL TECHNOLOGY CO\., LTD/);
    assert.doesNotMatch(parsed.html, /SUNKAIER Asia Pacific Pte\. Ltd\./);
    assert.match(parsed.text, /JIANGSU SUNKAIER INDUSTRIAL TECHNOLOGY CO\., LTD/);
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), {
      opportunityId: 20, salesQuotationVersionId: '81',
      to: 'buyer@example.com', subject: 'Mismatched seller', body: 'Do not send.', action: 'draft'
    }), /quotation seller does not match the user represented company/);
    version.snapshot.seller.address = '';
    version.snapshot.seller.phone = '';
    version.snapshot.seller.website = '';
    version.snapshot.missingFields = ['seller.address', 'seller.phone', 'seller.website'];
    const strictCompose = await getCustomerEmailComposeContext(dependencies, chinaSender, { opportunityId: 20 });
    assert.deepEqual(strictCompose.salesQuotationVersions, []);
    await assert.rejects(() => createCustomerEmailDraft(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81', to: 'buyer@example.com',
      subject: 'Incomplete signed quotation', body: 'Please see the quotation.', action: 'send'
    }), /seller identity is incomplete/);
    dependencies.allowIncompleteFormal = true;
    const incompleteCompose = await getCustomerEmailComposeContext(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81'
    });
    assert.equal(incompleteCompose.salesQuotationVersions.length, 1);
    assert.equal(incompleteCompose.selectedSalesQuotationMissingFields.length, 3);
    assert.doesNotMatch(incompleteCompose.signatureHtmlPreview, /Approved address|Vision Exchange|Yixing|www\.sunkaier\.com|\+65 6000 0000/);
    await createCustomerEmailDraft(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81', to: 'buyer@example.com',
      subject: 'Incomplete signed quotation', body: 'Please see the quotation.', action: 'send'
    });
    const incompleteSent = await simpleParser(sent.at(-1).raw);
    assert.deepEqual(incompleteSent.attachments.find((item) => item.filename === 'Q-800020-V1.pdf').content, content);
    assert.match(incompleteSent.html, /JIANGSU SUNKAIER INDUSTRIAL TECHNOLOGY CO\., LTD/);
    assert.doesNotMatch(incompleteSent.html, /Approved address|Vision Exchange|Yixing|www\.sunkaier\.com|\+65 6000 0000/);
    version.snapshot.seller.website = 'http://invalid.example';
    await assert.rejects(() => createCustomerEmailDraft(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81', to: 'buyer@example.com',
      subject: 'Invalid seller website', body: 'Do not send.', action: 'send'
    }), /seller identity is incomplete/);
    version.snapshot.seller.website = '';
    newerSource = { ...source, technicalDraftId: 42, technicalDraftRevisionNo: 2 };
    const staleCompose = await getCustomerEmailComposeContext(dependencies, chinaSender, { opportunityId: 20 });
    assert.deepEqual(staleCompose.salesQuotationVersions, []);
    await assert.rejects(() => createCustomerEmailDraft(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81', to: 'buyer@example.com',
      subject: 'Stale quotation', body: 'Do not send.', action: 'draft'
    }), /newer technical source revision/);
    newerSource = null;
    version.status = 'approved';
    await assert.rejects(() => createCustomerEmailDraft(dependencies, chinaSender, {
      opportunityId: 20, salesQuotationVersionId: '81', to: 'buyer@example.com',
      subject: 'Unsigned quotation', body: 'Do not send.', action: 'draft'
    }), /Only a signed PDF/);
  } finally { await rm(uploadDir, { recursive: true, force: true }); }
});

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

test('pasted table email is archived and sent with sanitized HTML and plain-text alternatives', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  const sent = [];
  try {
    const dependencies = createDependencies(uploadDir, {
      transport: { async sendMail(message) { sent.push(message); return { messageId: '<table@example.com>' }; } }
    });
    const result = await createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1,
      to: 'buyer@example.com',
      subject: 'Table quote',
      body: 'fallback must not replace the table',
      bodyHtml: '<p>Please see below:</p><table><tr><td width="70%" style="color:red" onclick="alert(1)">Mixer</td><td width="30%">USD 100</td></tr></table><img src="https://tracker.example/open">',
      action: 'send'
    });
    assert.equal(result.deliveryStatus, 'sent');
    const archived = dependencies.state.messages.find((message) => message.direction === 'outbound');
    assert.match(archived.htmlBody, /<table style=/);
    assert.match(archived.htmlBody, /width="70%" style="[^"]*width:70%/);
    assert.match(archived.textBody, /Mixer\s+USD 100/);
    assert.doesNotMatch(archived.textBody, /fallback must not replace/);
    assert.doesNotMatch(archived.htmlBody, /onclick|color:red|tracker\.example|<img src="https/i);
    const parsed = await simpleParser(sent[0].raw);
    assert.match(parsed.html, /<table style=/);
    assert.match(parsed.html, /width="30%" style="[^"]*width:30%/);
    assert.match(parsed.text, /Mixer\s+USD 100/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('unsafe-only and oversized rich email bodies cannot create an outbound draft', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-email-'));
  try {
    const dependencies = createDependencies(uploadDir);
    const input = {
      threadId: 1,
      to: 'buyer@example.com',
      subject: 'Empty rich content',
      body: 'a forged plain fallback',
      bodyHtml: '<img src="https://tracker.example/open"><script>alert(1)</script>',
      action: 'draft'
    };
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), input), /Email body is required/);
    await assert.rejects(() => createCustomerEmailDraft(dependencies, actor(), {
      ...input, bodyHtml: `<p>${'A'.repeat(500001)}</p>`
    }), /Email body is too long/);
    assert.equal(dependencies.state.messages.some((message) => message.direction === 'outbound'), false);
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

test('a revoked technical-file release blocks an already archived email draft at send time', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-customer-release-'));
  const policy = { directReleaseRevoked: false };
  const content = Buffer.from('released technical file');
  try {
    policy.approvedFileSources = [{
      token: 'technical_document:61', sourceKind: 'technical_document', sourceId: 61,
      originalName: 'TS-V2.pdf', mimeType: 'application/pdf', byteSize: content.length,
      sha256: createHash('sha256').update(content).digest('hex'), content, storedPath: ''
    }];
    const dependencies = createDependencies(uploadDir, policy);
    const draft = await createCustomerEmailDraft(dependencies, actor(), {
      threadId: 1, approvedOpportunityFileTokens: 'technical_document:61',
      to: 'buyer@example.com', subject: 'Technical file', body: 'Please see attached.', action: 'draft'
    });
    policy.directReleaseRevoked = true;
    await assert.rejects(
      () => sendCustomerEmail(dependencies, actor(), draft.id),
      /customer-release approval has changed/
    );
    assert.equal(dependencies.state.attempts.length, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('a quotation package with revoked technical files cannot be prepared for customer email', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-package-release-'));
  try {
    const dependencies = createDependencies(uploadDir, { packageReleaseRevoked: true });
    await assert.rejects(
      () => createCustomerEmailDraft(dependencies, actor(), {
        threadId: 1, quotationPackageVersionId: 71,
        to: 'buyer@example.com', subject: 'Quotation', body: 'Please see attached.', action: 'draft'
      }),
      /without current customer-release approval/
    );
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
