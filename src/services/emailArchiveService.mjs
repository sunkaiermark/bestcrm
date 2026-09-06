import { createHash } from 'node:crypto';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';
import { canAccessInquiryInbox } from './inquiryService.mjs';
import { canViewOpportunity } from './opportunityService.mjs';
import { removeStoredAttachmentFile, storeAttachmentBuffer } from './attachmentFileService.mjs';

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
    classificationReason: text(filter.reason) || 'manual_review'
  };
}

function knownContactInquiry(inquiry, contact) {
  if (!contact) return inquiry;
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
        matchedRules: [String(contact.contactCode || contact.id)]
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
        classificationReason: thread.classificationReason || 'known_thread_reply'
      }
    : inboundClassification(effectiveInquiry);
  return { thread, inquiry: effectiveInquiry, classification };
}

export async function archiveInboundEmailRecord(repositories, parsed) {
  const { emailArchiveRepository, inquiryRepository } = repositories;
  const { message, inquiry } = parsed;
  assertInboundIdentity(message);

  const existing = await emailArchiveRepository.findMessageIdentity(message);
  if (existing) {
    const thread = await emailArchiveRepository.findThreadById(existing.threadId);
    return { duplicate: true, message: existing, thread, inquiry: null };
  }

  const resolved = await resolveInboundEmailClassification(repositories, parsed);
  let thread = resolved.thread;
  const effectiveInquiry = resolved.inquiry;
  const classification = resolved.classification;
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
    threadId: thread.id
  });
  if (!archivedMessage) {
    throw new EmailArchiveDuplicateRaceError();
  }
  if (thread.lastMessageAt !== message.receivedAt) {
    await emailArchiveRepository.touchThread(thread.id, message.receivedAt);
  }
  return {
    duplicate: false,
    message: archivedMessage,
    thread,
    inquiry: inquiryRecord
  };
}

export async function storeEmailArchiveAttachments({
  emailArchiveRepository,
  messageId,
  attachments = [],
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
