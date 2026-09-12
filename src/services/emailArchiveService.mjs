import { createHash } from 'node:crypto';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';
import { canAccessInquiryInbox } from './inquiryService.mjs';
import { canViewOpportunity } from './opportunityService.mjs';
import { removeStoredAttachmentFile, storeAttachmentBuffer } from './attachmentFileService.mjs';
import {
  EmailRawIdentityConflictError,
  EmailRawMalwareError,
  EmailRawScanError
} from './emailRawArchiveService.mjs';

function text(value) {
  return String(value || '').trim();
}

function maxAttachmentBytes(maxUploadMb) {
  const value = Number(maxUploadMb);
  return Number.isFinite(value) && value > 0 ? value * 1024 * 1024 : 0;
}

function fallbackAttachmentName(index) {
  return `email-attachment-${index + 1}`;
}

export class EmailArchiveError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'EmailArchiveError';
    this.statusCode = statusCode;
  }
}

export class EmailArchiveDuplicateRaceError extends Error {
  constructor() {
    super('Email archive duplicate race');
    this.name = 'EmailArchiveDuplicateRaceError';
  }
}

function assertInboundIdentity(message) {
  if (!text(message.messageId) && (!text(message.providerMailbox) || !message.providerUid)) {
    throw new EmailArchiveError('Email message identity is required');
  }
  if (!text(message.fromAddress)) {
    throw new EmailArchiveError('Email sender address is required');
  }
}

function inboundClassification(inquiry = {}) {
  const filter = inquiry.rawPayload?.emailFilter || {};
  const archiveDisposition = inquiry.status === 'spam'
    ? 'spam'
    : inquiry.status === 'archived' ? 'archived' : 'active';
  return {
    archiveDisposition,
    classificationCategory: text(filter.category) || 'inquiry',
    classificationReason: text(filter.reason) || 'manual_review',
    entryDecision: text(filter.entryDecision)
      || (inquiry.status === 'spam' ? 'reject_spam' : inquiry.status === 'new' ? 'manual_review' : 'accept'),
    ruleVersion: text(filter.ruleVersion),
    spamScore: Number(filter.spamScore || 0),
    spamSignals: Array.isArray(filter.spamSignals) ? filter.spamSignals : [],
    protectedReasons: Array.isArray(filter.protectedReasons) ? filter.protectedReasons : []
  };
}

function knownContactInquiry(inquiry, contact) {
  if (!contact) return inquiry;
  const previousFilter = inquiry.rawPayload?.emailFilter || {};
  return {
    ...inquiry,
    status: 'new',
    matchedCustomerId: contact.customerId,
    matchedContactId: contact.id,
    rawPayload: {
      ...(inquiry.rawPayload || {}),
      emailFilter: {
        status: 'new',
        category: 'known_contact',
        reason: 'known_contact_email',
        matchedRules: [String(contact.contactCode || contact.id)],
        entryDecision: 'accept',
        ruleVersion: text(previousFilter.ruleVersion),
        spamScore: Number(previousFilter.spamScore || 0),
        spamSignals: Array.isArray(previousFilter.spamSignals) ? previousFilter.spamSignals : [],
        protectedReasons: [
          ...new Set([
            ...(Array.isArray(previousFilter.protectedReasons) ? previousFilter.protectedReasons : []),
            'known_contact_email'
          ])
        ]
      }
    },
    reviewNote: inquiry.reviewNote || ''
  };
}

export async function resolveInboundEmailClassification(repositories, parsed) {
  const { message, inquiry } = parsed;
  const thread = typeof repositories.emailArchiveRepository?.findThreadByReferences === 'function'
    ? await repositories.emailArchiveRepository.findThreadByReferences(message.replyReferenceIds)
    : null;
  let effectiveInquiry = inquiry;
  if (!thread && typeof repositories.contactRepository?.findUniqueByEmail === 'function') {
    const contact = await repositories.contactRepository.findUniqueByEmail(message.fromAddress);
    effectiveInquiry = knownContactInquiry(inquiry, contact);
  }
  const classification = thread
    ? {
        archiveDisposition: thread.archiveDisposition || 'active',
        classificationCategory: thread.classificationCategory || 'conversation',
        classificationReason: thread.classificationReason || 'known_thread_reply',
        entryDecision: 'accept',
        ruleVersion: text(inquiry.rawPayload?.emailFilter?.ruleVersion),
        spamScore: Number(inquiry.rawPayload?.emailFilter?.spamScore || 0),
        spamSignals: Array.isArray(inquiry.rawPayload?.emailFilter?.spamSignals)
          ? inquiry.rawPayload.emailFilter.spamSignals
          : [],
        protectedReasons: ['known_thread_reply']
      }
    : inboundClassification(effectiveInquiry);
  return { thread, inquiry: effectiveInquiry, classification };
}

function assertRawCaptureMatches(rawMessage, rawCapture) {
  if (!rawMessage
    || rawMessage.sha256 !== rawCapture.sha256
    || Number(rawMessage.fileSize) !== Number(rawCapture.fileSize)
    || rawMessage.storedPath !== rawCapture.storedPath) {
    throw new EmailRawIdentityConflictError();
  }
}

function scanAttemptInput(rawMessageId, scan = {}) {
  const now = new Date().toISOString();
  return {
    rawMessageId,
    engine: text(scan.engine) || 'unknown',
    engineVersion: text(scan.engineVersion),
    signatureVersion: text(scan.signatureVersion),
    verdict: text(scan.verdict) || 'error',
    findingCode: text(scan.findingCode),
    safeDetail: text(scan.safeDetail).slice(0, 1000),
    startedAt: scan.startedAt || now,
    completedAt: scan.completedAt || now
  };
}

export async function persistRawEmailCapture(emailArchiveRepository, rawCapture) {
  if (!rawCapture) return null;
  const result = await emailArchiveRepository.createRawMessage({
    mailboxKey: rawCapture.mailboxKey,
    providerName: rawCapture.providerName,
    providerMailbox: rawCapture.providerMailbox,
    providerUidValidity: rawCapture.providerUidValidity,
    providerUid: rawCapture.providerUid,
    rfcMessageIdHint: rawCapture.rfcMessageIdHint || '',
    sourceReceivedAt: rawCapture.sourceReceivedAt || null,
    storedPath: rawCapture.storedPath,
    fileSize: rawCapture.fileSize,
    sha256: rawCapture.sha256
  });
  assertRawCaptureMatches(result.rawMessage, rawCapture);
  await emailArchiveRepository.createRawScanAttempt(
    scanAttemptInput(result.rawMessage.id, rawCapture.scan)
  );
  return result.rawMessage;
}

export async function persistRawEmailCaptureOnly(repositories, rawCapture, processing = {}) {
  const rawMessage = await persistRawEmailCapture(repositories.emailArchiveRepository, rawCapture);
  const now = new Date().toISOString();
  await repositories.emailArchiveRepository.createRawProcessingAttempt({
    rawMessageId: rawMessage.id,
    stage: processing.stage || 'parse',
    outcome: processing.outcome || 'retryable_error',
    processorVersion: processing.processorVersion || 'email-parser-v1',
    safeErrorCode: processing.safeErrorCode || 'parse_failed',
    safeDetail: text(processing.safeDetail).slice(0, 1000),
    startedAt: processing.startedAt || now,
    completedAt: processing.completedAt || now
  });
  return rawMessage;
}

async function recordSuccessfulRawProcessing(emailArchiveRepository, rawMessageId) {
  if (!rawMessageId || typeof emailArchiveRepository.createRawProcessingAttempt !== 'function') return;
  const now = new Date().toISOString();
  await emailArchiveRepository.createRawProcessingAttempt({
    rawMessageId,
    stage: 'parse',
    outcome: 'succeeded',
    processorVersion: 'email-parser-v1',
    startedAt: now,
    completedAt: now
  });
}

async function recordMailboxDelivery(emailArchiveRepository, message, archivedMessage, rawMessage, direction) {
  if (typeof emailArchiveRepository.createMailboxDelivery !== 'function') return null;
  if (!text(message.mailboxKey)
    || !text(message.providerMailbox)
    || !text(message.providerUidValidity)
    || !message.providerUid) {
    return null;
  }
  const delivery = await emailArchiveRepository.createMailboxDelivery({
    messageId: archivedMessage.id,
    rawMessageId: rawMessage?.id || null,
    mailboxKey: message.mailboxKey,
    providerName: 'imap',
    providerMailbox: message.providerMailbox,
    providerUidValidity: message.providerUidValidity,
    providerUid: message.providerUid,
    direction,
    firstObservedAt: message.receivedAt || message.sentAt || new Date().toISOString()
  });
  const linkedMessageId = Number(delivery?.message_id ?? delivery?.messageId);
  const linkedRawMessageId = Number(delivery?.raw_message_id ?? delivery?.rawMessageId ?? 0);
  if (!delivery || linkedMessageId !== Number(archivedMessage.id)
    || (rawMessage?.id && linkedRawMessageId !== Number(rawMessage.id))) {
    throw new EmailRawIdentityConflictError('Mailbox delivery identity conflicts with archived evidence');
  }
  return delivery;
}

export async function archiveInboundEmailRecord(repositories, parsed, options = {}) {
  const { emailArchiveRepository, inquiryRepository } = repositories;
  const { message, inquiry } = parsed;
  assertInboundIdentity(message);

  const existing = await emailArchiveRepository.findMessageIdentity(message);
  if (existing) {
    let rawMessage = null;
    if (options.rawCapture) {
      rawMessage = await persistRawEmailCapture(emailArchiveRepository, options.rawCapture);
      if (!existing.rawMessageId) {
        const linked = await emailArchiveRepository.linkInboundMessageRawArchive({
          messageId: existing.id,
          rawMessageId: rawMessage.id,
          rawEmlStoredPath: rawMessage.storedPath,
          rawEmlFileSize: rawMessage.fileSize,
          rawEmlSha256: rawMessage.sha256,
          importedAt: new Date().toISOString()
        });
        if (!linked) throw new EmailRawIdentityConflictError('Existing email could not bind raw evidence');
        Object.assign(existing, linked);
      }
      await recordSuccessfulRawProcessing(emailArchiveRepository, rawMessage.id);
    }
    await recordMailboxDelivery(emailArchiveRepository, message, existing, rawMessage, 'inbound');
    const thread = await emailArchiveRepository.findThreadById(existing.threadId);
    return { duplicate: true, message: existing, thread, inquiry: null, rawMessage };
  }

  const resolved = options.resolvedClassification
    || await resolveInboundEmailClassification(repositories, parsed);
  let thread = resolved.thread;
  const effectiveInquiry = resolved.inquiry;
  const classification = resolved.classification;
  const archiveClassification = thread
    ? classification
    : { ...classification, archiveDisposition: 'active' };
  const rawMessage = options.rawCapture
    ? await persistRawEmailCapture(emailArchiveRepository, options.rawCapture)
    : null;
  if (!thread) {
    thread = await emailArchiveRepository.createThread({
      mailboxKey: message.mailboxKey,
      subject: message.subject,
      normalizedSubject: message.normalizedSubject,
      inquiryId: null,
      customerId: effectiveInquiry.matchedCustomerId,
      contactId: effectiveInquiry.matchedContactId,
      triageStatus: 'pending',
      ...archiveClassification,
      lastMessageAt: message.receivedAt
    });
  }

  const archivedMessage = await emailArchiveRepository.createInboundMessage({
    ...message,
    ...archiveClassification,
    rawMessageId: rawMessage?.id || null,
    rawEmlStoredPath: rawMessage?.storedPath || null,
    rawEmlFileSize: rawMessage?.fileSize || null,
    rawEmlSha256: rawMessage?.sha256 || null,
    importedAt: rawMessage ? new Date().toISOString() : null,
    threadId: thread.id
  });
  if (!archivedMessage) {
    throw new EmailArchiveDuplicateRaceError();
  }
  await recordMailboxDelivery(emailArchiveRepository, message, archivedMessage, rawMessage, 'inbound');
  if (thread.lastMessageAt !== message.receivedAt) {
    await emailArchiveRepository.touchThread(thread.id, message.receivedAt);
  }
  if (typeof emailArchiveRepository.createClassificationEvent === 'function') {
    await emailArchiveRepository.createClassificationEvent({
      messageId: archivedMessage.id,
      threadId: thread.id,
      actorType: 'rule',
      actorVersion: classification.ruleVersion || 'email-intake-rule-v1',
      category: classification.classificationCategory,
      confidence: classification.entryDecision === 'accept' ? 1 : 0.5,
      reasonCodes: [
        classification.classificationReason,
        ...classification.spamSignals,
        ...classification.protectedReasons
      ].filter(Boolean),
      isFinal: false
    });
  }
  await recordSuccessfulRawProcessing(emailArchiveRepository, rawMessage?.id);
  return {
    duplicate: false,
    rejectedSpam: false,
    message: archivedMessage,
    thread,
    inquiry: null,
    classification: archiveClassification,
    rawMessage
  };
}

async function outboundContact(contactRepository, recipients = []) {
  if (typeof contactRepository?.findUniqueByEmail !== 'function') return null;
  for (const recipient of recipients) {
    const address = text(recipient?.address).toLowerCase();
    if (!address || address.endsWith('@sunkaier.com')) continue;
    const contact = await contactRepository.findUniqueByEmail(address);
    if (contact) return contact;
  }
  return null;
}

export async function archiveImportedOutboundEmailRecord(repositories, parsed, options = {}) {
  const { emailArchiveRepository, contactRepository } = repositories;
  const { message } = parsed;
  assertInboundIdentity(message);

  const existing = await emailArchiveRepository.findMessageIdentity(message);
  if (existing) {
    const rawMessage = options.rawCapture
      ? await persistRawEmailCapture(emailArchiveRepository, options.rawCapture)
      : null;
    await recordSuccessfulRawProcessing(emailArchiveRepository, rawMessage?.id);
    await recordMailboxDelivery(emailArchiveRepository, message, existing, rawMessage, 'outbound');
    return {
      duplicate: true,
      message: existing,
      thread: await emailArchiveRepository.findThreadById(existing.threadId),
      inquiry: null,
      rawMessage
    };
  }

  const rawMessage = options.rawCapture
    ? await persistRawEmailCapture(emailArchiveRepository, options.rawCapture)
    : null;
  let thread = typeof emailArchiveRepository.findThreadByReferences === 'function'
    ? await emailArchiveRepository.findThreadByReferences(message.replyReferenceIds)
    : null;
  if (!thread) {
    const contact = await outboundContact(contactRepository, [
      ...(message.toRecipients || []),
      ...(message.ccRecipients || [])
    ]);
    thread = await emailArchiveRepository.createThread({
      mailboxKey: message.mailboxKey,
      subject: message.subject,
      normalizedSubject: message.normalizedSubject,
      customerId: contact?.customerId || null,
      contactId: contact?.id || null,
      archiveDisposition: 'active',
      classificationCategory: 'conversation',
      classificationReason: 'imported_sent_mail',
      triageStatus: 'outbound_only',
      lastMessageAt: message.sentAt
    });
  }
  const authoredBy = typeof emailArchiveRepository.findActivePersonalMailboxOwner === 'function'
    ? await emailArchiveRepository.findActivePersonalMailboxOwner(message.mailboxKey)
    : null;
  const archivedMessage = await emailArchiveRepository.createImportedOutboundMessage({
    ...message,
    rawMessageId: rawMessage?.id || null,
    rawEmlStoredPath: rawMessage?.storedPath || null,
    rawEmlFileSize: rawMessage?.fileSize || null,
    rawEmlSha256: rawMessage?.sha256 || null,
    importedAt: rawMessage ? new Date().toISOString() : null,
    threadId: thread.id,
    authoredBy
  });
  if (!archivedMessage) throw new EmailArchiveDuplicateRaceError();
  await recordMailboxDelivery(emailArchiveRepository, message, archivedMessage, rawMessage, 'outbound');
  if (thread.lastMessageAt !== message.sentAt) {
    await emailArchiveRepository.touchThread(thread.id, message.sentAt);
  }
  await recordSuccessfulRawProcessing(emailArchiveRepository, rawMessage?.id);
  return {
    duplicate: false,
    message: archivedMessage,
    thread,
    inquiry: null,
    rawMessage
  };
}

export async function storeEmailArchiveAttachments({
  emailArchiveRepository,
  messageId,
  attachments = [],
  attachmentScans = [],
  uploadDir,
  maxUploadMb
}) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return { stored: [], skipped: [] };
  }
  const existing = typeof emailArchiveRepository.listAttachmentsByMessage === 'function'
    ? await emailArchiveRepository.listAttachmentsByMessage(messageId)
    : [];
  const existingByIndex = new Map(
    existing.map((attachment) => [Number(attachment.sourceIndex), attachment])
  );
  const maxBytes = maxAttachmentBytes(maxUploadMb);
  const stored = [];
  const skipped = [];

  for (const [index, attachment] of attachments.entries()) {
    if (existingByIndex.has(index)) {
      const existingAttachment = existingByIndex.get(index);
      const retryScan = attachmentScans[index] || null;
      if (retryScan?.verdict === 'malware') throw new EmailRawMalwareError(retryScan);
      if (retryScan && retryScan.verdict !== 'clean') throw new EmailRawScanError(retryScan);
      if (retryScan && typeof emailArchiveRepository.createAttachmentScanAttempt === 'function') {
        await emailArchiveRepository.createAttachmentScanAttempt({
          attachmentId: existingAttachment.id,
          ...scanAttemptInput(null, retryScan)
        });
      }
      skipped.push({ sourceIndex: index, reason: 'duplicate' });
      continue;
    }
    const content = Buffer.isBuffer(attachment?.content) ? attachment.content : null;
    if (!content) {
      skipped.push({ sourceIndex: index, reason: 'missing_content' });
      continue;
    }
    if (maxBytes > 0 && content.length > maxBytes) {
      throw new EmailArchiveError('Email attachment exceeds configured limit', 413);
    }
    const scan = attachmentScans[index] || null;
    if (scan?.verdict === 'malware') throw new EmailRawMalwareError(scan);
    if (scan && scan.verdict !== 'clean') throw new EmailRawScanError(scan);
    const originalName = normalizeUploadedFilename(attachment.filename || fallbackAttachmentName(index));
    const file = await storeAttachmentBuffer({
      uploadDir,
      originalName,
      content,
      prefix: 'email-archive'
    });
    let record = null;
    try {
      record = await emailArchiveRepository.createAttachment({
        messageId,
        sourceIndex: index,
        originalName,
        storedPath: file.storedPath,
        mimeType: attachment.contentType || 'application/octet-stream',
        fileSize: file.fileSize,
        sha256: createHash('sha256').update(content).digest('hex'),
        contentId: attachment.cid || attachment.contentId || ''
      });
      if (record) {
        if (scan && typeof emailArchiveRepository.createAttachmentScanAttempt === 'function') {
          await emailArchiveRepository.createAttachmentScanAttempt({
            attachmentId: record.id,
            ...scanAttemptInput(null, scan)
          });
        }
        stored.push(record);
      } else {
        await removeStoredAttachmentFile(file.absolutePath);
        skipped.push({ sourceIndex: index, reason: 'duplicate' });
      }
    } catch (error) {
      // Once the immutable attachment row exists, retain the matching file. A
      // retry will detect the duplicate and append the newly completed scan
      // attempt instead of leaving a database row that points at a missing file.
      if (!record) await removeStoredAttachmentFile(file.absolutePath);
      throw error;
    }
  }
  return { stored, skipped };
}

async function opportunityForThread(dependencies, thread) {
  if (!thread.opportunityId) return null;
  const opportunity = await dependencies.opportunityRepository.getOpportunityDetail(thread.opportunityId);
  if (!opportunity) return null;
  const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
    ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    : [];
  return { ...opportunity, teamMembers };
}

export async function canViewEmailThread(dependencies, actor, thread) {
  if (hasRole(actor, ROLES.ADMINISTRATOR)) return true;
  const mailboxOwnerUserIds = Array.isArray(thread?.mailboxOwnerUserIds)
    ? thread.mailboxOwnerUserIds.map(Number).filter((value) => value > 0)
    : [Number(thread?.mailboxOwnerUserId || 0)].filter((value) => value > 0);
  const isPersonalMailbox = mailboxOwnerUserIds.length > 0;
  const hasSharedMailboxDelivery = thread?.hasSharedMailboxDelivery === true
    || text(thread?.mailboxKey).toLowerCase() === 'sales@sunkaier.com';
  if (mailboxOwnerUserIds.includes(Number(actor?.id))) return true;
  if (!thread?.opportunityId) {
    return hasSharedMailboxDelivery || !isPersonalMailbox ? canAccessInquiryInbox(actor) : false;
  }
  const opportunity = await opportunityForThread(dependencies, thread);
  return Boolean(opportunity && canViewOpportunity(actor, opportunity));
}

export async function listVisibleEmailThreads(dependencies, actor, filter = {}) {
  const threads = await dependencies.emailArchiveRepository.listThreads(filter);
  const visible = [];
  for (const thread of threads) {
    if (await canViewEmailThread(dependencies, actor, thread)) {
      visible.push(thread);
    }
  }
  return visible;
}

export async function listVisibleEmailMailboxes(dependencies, actor) {
  const sharedAddress = text(dependencies.sharedAddress || 'sales@sunkaier.com').toLowerCase();
  const assignments = typeof dependencies.emailArchiveRepository.listActivePersonalMailboxAssignments === 'function'
    ? await dependencies.emailArchiveRepository.listActivePersonalMailboxAssignments()
    : [];
  const mailboxes = [];
  if (canAccessInquiryInbox(actor)) {
    mailboxes.push({
      key: sharedAddress,
      label: sharedAddress,
      type: 'shared',
      ownerUserId: null,
      ownerDisplayName: ''
    });
  }
  for (const assignment of assignments) {
    const isAdministrator = hasRole(actor, ROLES.ADMINISTRATOR);
    const isOwner = Number(assignment.userId) === Number(actor?.id);
    if (!isAdministrator && !isOwner) continue;
    if (assignment.mailboxAddress === sharedAddress) continue;
    mailboxes.push({
      key: assignment.mailboxAddress,
      label: assignment.mailboxAddress,
      type: 'personal',
      ownerUserId: assignment.userId,
      ownerDisplayName: assignment.displayName
    });
  }
  return mailboxes;
}

export async function resolveVisibleEmailMailbox(dependencies, actor, mailboxKey = '') {
  const mailboxes = await listVisibleEmailMailboxes(dependencies, actor);
  const requested = text(mailboxKey).toLowerCase();
  if (!requested) return { mailbox: mailboxes[0] || null, mailboxes };
  const mailbox = mailboxes.find((item) => item.key === requested);
  if (!mailbox) throw new EmailArchiveError('Forbidden', 403);
  return { mailbox, mailboxes };
}

export async function getVisibleEmailThread(dependencies, actor, threadId) {
  const thread = await dependencies.emailArchiveRepository.findThreadById(threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) {
    throw new EmailArchiveError('Forbidden', 403);
  }
  return dependencies.emailArchiveRepository.getThreadDetail(thread.id);
}

export async function listEmailLinkableOpportunities(dependencies, actor) {
  if (typeof dependencies.opportunityRepository?.listOpportunities !== 'function') return [];
  const filter = hasRole(actor, ROLES.ADMINISTRATOR)
    ? { archiveScope: 'active' }
    : { archiveScope: 'active', visibleToUserId: actor.id };
  return dependencies.opportunityRepository.listOpportunities(filter);
}

export async function listEmailLinkableInquiries(dependencies, actor) {
  if (!canAccessInquiryInbox(actor)) return [];
  if (typeof dependencies.inquiryRepository?.listInquiries !== 'function') return [];
  const inquiries = await dependencies.inquiryRepository.listInquiries({ limit: 250 });
  return inquiries.filter((inquiry) => [
    'new',
    'reviewing',
    'customer_approval_pending'
  ].includes(inquiry.status));
}

async function withEmailArchiveTransaction(dependencies, callback) {
  if (typeof dependencies.emailArchiveTransaction === 'function') {
    return dependencies.emailArchiveTransaction((repositories) => callback({
      ...dependencies,
      ...repositories
    }));
  }
  return callback(dependencies);
}

function triageTransitionAllowed(thread) {
  return ['pending', 'outbound_only'].includes(thread?.triageStatus || 'pending');
}

async function recordTriageEvent(repository, input) {
  if (typeof repository.createTriageEvent !== 'function') return null;
  return repository.createTriageEvent(input);
}

async function transitionTriage(repository, thread, actor, input) {
  if (!triageTransitionAllowed(thread)) {
    if (thread.triageStatus === input.triageStatus) return thread;
    throw new EmailArchiveError('Email thread has already been triaged', 409);
  }
  const transitioned = await repository.transitionThreadTriage({
    threadId: thread.id,
    expectedStatus: thread.triageStatus || 'pending',
    triageStatus: input.triageStatus,
    archiveDisposition: input.archiveDisposition || 'active',
    actorUserId: actor.id,
    triagedAt: input.triagedAt,
    note: input.note || ''
  });
  if (!transitioned) throw new EmailArchiveError('Email triage changed; refresh and try again', 409);
  await recordTriageEvent(repository, {
    threadId: thread.id,
    eventType: input.eventType,
    fromStatus: thread.triageStatus || 'pending',
    toStatus: input.triageStatus,
    actorUserId: actor.id,
    assignedUserId: input.assignedUserId || null,
    inquiryId: input.inquiryId || null,
    opportunityId: input.opportunityId || null,
    note: input.note || ''
  });
  return transitioned;
}

export async function linkEmailThreadToOpportunity(dependencies, actor, threadId, opportunityId) {
  const targetOpportunityId = Number(opportunityId);
  if (!Number.isInteger(targetOpportunityId) || targetOpportunityId <= 0) {
    throw new EmailArchiveError('Opportunity is required', 400);
  }
  const thread = await dependencies.emailArchiveRepository.findThreadById(threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) {
    throw new EmailArchiveError('Forbidden', 403);
  }
  if (thread.opportunityId) {
    if (Number(thread.opportunityId) === targetOpportunityId
      && thread.triageStatus === 'linked_opportunity') return thread;
    throw new EmailArchiveError('Email thread is already linked to an opportunity', 409);
  }
  const opportunity = await dependencies.opportunityRepository.getOpportunityDetail(targetOpportunityId);
  if (!opportunity) throw new EmailArchiveError('Opportunity not found', 404);
  const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
    ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    : [];
  if (!canViewOpportunity(actor, { ...opportunity, teamMembers })) {
    throw new EmailArchiveError('Forbidden', 403);
  }
  await withEmailArchiveTransaction(dependencies, async (transactionDependencies) => {
    const current = await transactionDependencies.emailArchiveRepository.findThreadById(thread.id);
    if (!current) throw new EmailArchiveError('Email thread not found', 404);
    if (current.opportunityId) {
      if (Number(current.opportunityId) === targetOpportunityId
        && current.triageStatus === 'linked_opportunity') return current;
      throw new EmailArchiveError('Email thread is already linked to an opportunity', 409);
    }
    const linked = await transactionDependencies.emailArchiveRepository.linkThreadToOpportunity(
      current.id,
      targetOpportunityId
    );
    if (!linked) throw new EmailArchiveError('Email thread link changed; refresh and try again', 409);
    return transitionTriage(transactionDependencies.emailArchiveRepository, current, actor, {
      eventType: 'linked_opportunity',
      triageStatus: 'linked_opportunity',
      opportunityId: targetOpportunityId,
      triagedAt: dependencies.now?.() || new Date().toISOString()
    });
  });
  return dependencies.emailArchiveRepository.getThreadDetail(thread.id);
}

export async function linkEmailThreadToInquiry(dependencies, actor, threadId, inquiryId) {
  if (!canAccessInquiryInbox(actor)) throw new EmailArchiveError('Forbidden', 403);
  const targetInquiryId = Number(inquiryId);
  if (!Number.isInteger(targetInquiryId) || targetInquiryId <= 0) {
    throw new EmailArchiveError('Inquiry is required', 400);
  }
  const thread = await dependencies.emailArchiveRepository.findThreadById(threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) throw new EmailArchiveError('Forbidden', 403);
  if (thread.inquiryId) {
    if (Number(thread.inquiryId) === targetInquiryId && thread.triageStatus === 'linked_inquiry') return thread;
    throw new EmailArchiveError('Email thread is already linked to an inquiry', 409);
  }
  const inquiry = await dependencies.inquiryRepository.findById(targetInquiryId);
  if (!inquiry) throw new EmailArchiveError('Inquiry not found', 404);
  await withEmailArchiveTransaction(dependencies, async (transactionDependencies) => {
    const current = await transactionDependencies.emailArchiveRepository.findThreadById(thread.id);
    if (!current) throw new EmailArchiveError('Email thread not found', 404);
    const linked = await transactionDependencies.emailArchiveRepository.linkThreadToInquiry(
      current.id,
      targetInquiryId
    );
    if (!linked) throw new EmailArchiveError('Email thread link changed; refresh and try again', 409);
    return transitionTriage(transactionDependencies.emailArchiveRepository, current, actor, {
      eventType: 'linked_inquiry',
      triageStatus: 'linked_inquiry',
      inquiryId: targetInquiryId,
      triagedAt: dependencies.now?.() || new Date().toISOString()
    });
  });
  return dependencies.emailArchiveRepository.getThreadDetail(thread.id);
}

function inquiryInputFromThread(thread, actor) {
  const sourceMessage = thread.messages.find((message) => message.direction === 'inbound');
  if (!sourceMessage) throw new EmailArchiveError('Inbound source message is required', 409);
  return {
    source: 'email',
    submissionType: 'standard',
    sourceChannel: 'email',
    sourceReference: sourceMessage.messageId || `email-message-${sourceMessage.id}`,
    sourceReceivedAt: sourceMessage.receivedAt || sourceMessage.createdAt,
    subject: sourceMessage.subject || thread.subject || '',
    companyName: thread.customerName || '',
    contactName: sourceMessage.fromName || '',
    contactEmail: text(sourceMessage.fromAddress).toLowerCase(),
    contactPhone: '',
    country: '',
    productInterest: '',
    opportunityType: '',
    requirementText: sourceMessage.textBody || sourceMessage.subject || thread.subject || 'Email inquiry',
    rawPayload: {
      emailThreadId: thread.id,
      emailMessageId: sourceMessage.id,
      mailboxKeys: thread.mailboxKeys || [thread.mailboxKey]
    },
    priority: 'normal',
    status: 'new',
    assignedUserId: thread.triageAssignedUserId || actor.id,
    recommendedSalespersonId: thread.mailboxOwnerUserId || null,
    matchedCustomerId: thread.customerId || null,
    matchedContactId: thread.contactId || null,
    createdBy: actor.id,
    reviewNote: ''
  };
}

export async function convertEmailThreadToInquiry(dependencies, actor, threadId) {
  if (!canAccessInquiryInbox(actor)) throw new EmailArchiveError('Forbidden', 403);
  const visible = await getVisibleEmailThread(dependencies, actor, threadId);
  if (visible.inquiryId && visible.triageStatus === 'converted_inquiry') {
    return { thread: visible, inquiry: await dependencies.inquiryRepository.findById(visible.inquiryId) };
  }
  const result = await withEmailArchiveTransaction(dependencies, async (transactionDependencies) => {
    const current = await transactionDependencies.emailArchiveRepository.getThreadDetail(visible.id);
    if (!current) throw new EmailArchiveError('Email thread not found', 404);
    if (!triageTransitionAllowed(current)) throw new EmailArchiveError('Email thread has already been triaged', 409);
    const inquiry = await transactionDependencies.inquiryRepository.createInquiry(
      inquiryInputFromThread(current, actor)
    );
    const linked = await transactionDependencies.emailArchiveRepository.linkThreadToInquiry(current.id, inquiry.id);
    if (!linked) throw new EmailArchiveError('Email thread link changed; refresh and try again', 409);
    await transitionTriage(transactionDependencies.emailArchiveRepository, current, actor, {
      eventType: 'converted_inquiry',
      triageStatus: 'converted_inquiry',
      inquiryId: inquiry.id,
      triagedAt: dependencies.now?.() || new Date().toISOString()
    });
    return { inquiry };
  });
  return {
    inquiry: result.inquiry,
    thread: await dependencies.emailArchiveRepository.getThreadDetail(visible.id)
  };
}

export async function setEmailThreadDisposition(dependencies, actor, threadId, action, note = '') {
  const target = action === 'archive'
    ? { eventType: 'archived', triageStatus: 'archived', archiveDisposition: 'archived' }
    : action === 'spam'
      ? { eventType: 'spam', triageStatus: 'spam', archiveDisposition: 'spam' }
      : null;
  if (!target) throw new EmailArchiveError('Invalid email triage action', 400);
  const thread = await dependencies.emailArchiveRepository.findThreadById(threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) throw new EmailArchiveError('Forbidden', 403);
  if (thread.triageStatus === target.triageStatus) return thread;
  await withEmailArchiveTransaction(dependencies, async (transactionDependencies) => {
    const current = await transactionDependencies.emailArchiveRepository.findThreadById(thread.id);
    return transitionTriage(transactionDependencies.emailArchiveRepository, current, actor, {
      ...target,
      note: text(note).slice(0, 1000),
      triagedAt: dependencies.now?.() || new Date().toISOString()
    });
  });
  return dependencies.emailArchiveRepository.getThreadDetail(thread.id);
}

export async function listEmailTriageAssignees(dependencies, actor, thread) {
  if (typeof dependencies.userRepository?.listUsersWithRoles !== 'function') return [];
  const users = await dependencies.userRepository.listUsersWithRoles();
  const visible = [];
  for (const user of users) {
    if (!user.isActive) continue;
    if (await canViewEmailThread(dependencies, user, thread)) visible.push(user);
  }
  return visible;
}

export async function assignEmailThreadTriage(dependencies, actor, threadId, assignedUserId) {
  const targetUserId = Number(assignedUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new EmailArchiveError('Assignee is required', 400);
  }
  const thread = await dependencies.emailArchiveRepository.findThreadById(threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) throw new EmailArchiveError('Forbidden', 403);
  if ((thread.triageStatus || 'pending') !== 'pending') {
    throw new EmailArchiveError('Only pending email can be assigned', 409);
  }
  const assignee = await dependencies.userRepository.findByIdWithRoles(targetUserId);
  if (!assignee?.isActive || !(await canViewEmailThread(dependencies, assignee, thread))) {
    throw new EmailArchiveError('Assignee cannot access this mailbox', 403);
  }
  if (Number(thread.triageAssignedUserId) === targetUserId) return thread;
  await withEmailArchiveTransaction(dependencies, async (transactionDependencies) => {
    const current = await transactionDependencies.emailArchiveRepository.findThreadById(thread.id);
    const assigned = await transactionDependencies.emailArchiveRepository.assignThreadTriage({
      threadId: current.id,
      assignedUserId: targetUserId
    });
    if (!assigned) throw new EmailArchiveError('Email triage changed; refresh and try again', 409);
    await recordTriageEvent(transactionDependencies.emailArchiveRepository, {
      threadId: current.id,
      eventType: 'assigned',
      fromStatus: 'pending',
      toStatus: 'pending',
      actorUserId: actor.id,
      assignedUserId: targetUserId,
      note: ''
    });
  });
  return dependencies.emailArchiveRepository.getThreadDetail(thread.id);
}

export async function getVisibleEmailAttachment(dependencies, actor, attachmentId) {
  const attachment = await dependencies.emailArchiveRepository.findAttachmentById(attachmentId);
  if (!attachment) throw new EmailArchiveError('Email attachment not found', 404);
  const message = await dependencies.emailArchiveRepository.findMessageById(attachment.messageId);
  if (!message) throw new EmailArchiveError('Email message not found', 404);
  const thread = await dependencies.emailArchiveRepository.findThreadById(message.threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) {
    throw new EmailArchiveError('Forbidden', 403);
  }
  return { attachment, message, thread };
}
