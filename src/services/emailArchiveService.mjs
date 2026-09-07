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

export async function archiveInboundEmailRecord(repositories, parsed, options = {}) {
  const { emailArchiveRepository, inquiryRepository } = repositories;
  const { message, inquiry } = parsed;
  assertInboundIdentity(message);

  const existing = await emailArchiveRepository.findMessageIdentity(message);
  if (existing) {
    let rawMessage = null;
    if (options.rawCapture) {
      rawMessage = await persistRawEmailCapture(emailArchiveRepository, options.rawCapture);
      if (existing.rawMessageId && existing.rawMessageId !== rawMessage.id) {
        throw new EmailRawIdentityConflictError();
      }
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
    const thread = await emailArchiveRepository.findThreadById(existing.threadId);
    return { duplicate: true, message: existing, thread, inquiry: null, rawMessage };
  }

  const resolved = options.resolvedClassification
    || await resolveInboundEmailClassification(repositories, parsed);
  let thread = resolved.thread;
  const effectiveInquiry = resolved.inquiry;
  const classification = resolved.classification;
  if (!thread && classification.entryDecision === 'reject_spam') {
    return {
      duplicate: false,
      rejectedSpam: true,
      message: null,
      thread: null,
      inquiry: null,
      classification
    };
  }
  const rawMessage = options.rawCapture
    ? await persistRawEmailCapture(emailArchiveRepository, options.rawCapture)
    : null;
  let inquiryRecord = null;
  if (!thread) {
    inquiryRecord = await inquiryRepository.createInquiry(effectiveInquiry);
    thread = await emailArchiveRepository.createThread({
      mailboxKey: message.mailboxKey,
      subject: message.subject,
      normalizedSubject: message.normalizedSubject,
      inquiryId: inquiryRecord.id,
      customerId: inquiryRecord.matchedCustomerId,
      contactId: inquiryRecord.matchedContactId,
      ...classification,
      lastMessageAt: message.receivedAt
    });
  }

  const archivedMessage = await emailArchiveRepository.createInboundMessage({
    ...message,
    ...classification,
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
    inquiry: inquiryRecord,
    classification,
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
  const existingIndexes = new Set(existing.map((attachment) => Number(attachment.sourceIndex)));
  const maxBytes = maxAttachmentBytes(maxUploadMb);
  const stored = [];
  const skipped = [];

  for (const [index, attachment] of attachments.entries()) {
    if (existingIndexes.has(index)) {
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
    try {
      const record = await emailArchiveRepository.createAttachment({
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
      await removeStoredAttachmentFile(file.absolutePath);
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
  if (!thread?.opportunityId) return canAccessInquiryInbox(actor);
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

export async function getVisibleEmailThread(dependencies, actor, threadId) {
  const thread = await dependencies.emailArchiveRepository.findThreadById(threadId);
  if (!thread) throw new EmailArchiveError('Email thread not found', 404);
  if (!(await canViewEmailThread(dependencies, actor, thread))) {
    throw new EmailArchiveError('Forbidden', 403);
  }
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
