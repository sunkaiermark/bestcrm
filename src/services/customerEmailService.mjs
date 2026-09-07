import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { canAccessInquiryInbox } from './inquiryService.mjs';
import { canViewOpportunity } from './opportunityService.mjs';
import { resolveStoredPath } from './attachmentFileService.mjs';
import { storeEmailArchiveAttachments } from './emailArchiveService.mjs';

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const COMPANY_ADDRESS = '2 Venture Drive, #10-30, Vision Exchange, Singapore 608526';
const CONFIDENTIALITY_NOTICE = 'CONFIDENTIALITY NOTICE: This email and any attachments may contain confidential or privileged information intended only for the named recipient. If you received it in error, please notify the sender and delete it. Any unauthorized use, disclosure, copying, or distribution is prohibited.';
const SIGNATURE_LOGO_CID = 'sunkaier-signature-logo@sunkaier.com';
const SIGNATURE_LOGO_PATH = fileURLToPath(new URL('../public/assets/sunkaier-logo-email.png', import.meta.url));

function text(value) {
  return String(value || '').trim();
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function safeError(error) {
  return text(error?.message).replace(/[\r\n]+/g, ' ').slice(0, 500) || 'SMTP delivery failed';
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function signatureHtml({ name, title, contactEmail, phone, logoSrc }) {
  const phoneRow = phone
    ? `<tr><td style="padding:3px 9px 3px 0;color:#f15a24;font-weight:700;vertical-align:top;">T</td><td style="padding:3px 0;color:#334155;">${escapeHtml(phone)}</td></tr>`
    : '';
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#172033;line-height:1.4;">',
    '<div style="margin:0 0 11px;">Best regards,</div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;max-width:560px;width:100%;">',
    '<tr>',
    '<td style="width:5px;background:#f15a24;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>',
    '<td style="padding:3px 0 3px 16px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;width:100%;">',
    '<tr>',
    '<td width="53%" style="padding:0 18px 0 0;vertical-align:top;width:53%;">',
    `<img src="${escapeHtml(logoSrc)}" width="245" alt="SUNKAIER" style="border:0;display:block;height:auto;max-width:100%;width:245px;">`,
    '<div style="color:#334155;font-size:12px;font-weight:700;margin-top:9px;">SUNKAIER Asia Pacific Pte. Ltd.</div>',
    `<div style="color:#64748b;font-size:11px;line-height:1.45;margin-top:3px;">${escapeHtml(COMPANY_ADDRESS)}</div>`,
    '</td>',
    '<td width="47%" style="border-left:1px solid #dbe4ec;padding:0 0 0 18px;vertical-align:top;width:47%;">',
    `<div style="color:#173f73;font-size:20px;font-weight:700;line-height:1.2;">${escapeHtml(name)}</div>`,
    `<div style="color:#526174;font-size:13px;font-weight:600;margin-top:3px;">${escapeHtml(title)}</div>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:12px;margin-top:12px;width:auto;">',
    `<tr><td style="padding:3px 9px 3px 0;color:#f15a24;font-weight:700;vertical-align:top;">E</td><td style="padding:3px 0;"><a href="mailto:${escapeHtml(contactEmail)}" style="color:#173f73;text-decoration:none;">${escapeHtml(contactEmail)}</a></td></tr>`,
    phoneRow,
    '<tr><td style="padding:3px 9px 3px 0;color:#f15a24;font-weight:700;vertical-align:top;">W</td><td style="padding:3px 0;"><a href="https://www.sunkaier.com" style="color:#173f73;text-decoration:none;">www.sunkaier.com</a></td></tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    `<div style="border-top:1px solid #e2e8f0;color:#758291;font-size:10.5px;line-height:1.5;margin-top:11px;max-width:560px;padding-top:8px;">${escapeHtml(CONFIDENTIALITY_NOTICE)}</div>`,
    '</div>'
  ].join('');
}

function parseRecipients(value, label) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[;,]/);
  const recipients = [];
  const seen = new Set();
  for (const item of items) {
    const raw = typeof item === 'object' ? text(item.address) : text(item);
    if (!raw) continue;
    if (/[\r\n]/.test(raw) || !EMAIL_PATTERN.test(raw)) {
      throw new CustomerEmailError(`${label} contains an invalid email address`);
    }
    const address = raw.toLowerCase();
    if (!seen.has(address)) {
      seen.add(address);
      recipients.push({ address });
    }
  }
  return recipients;
}

export class CustomerEmailError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CustomerEmailError';
    this.statusCode = statusCode;
  }
}

function personalEmailIdentity(actor, sharedAddress = 'sales@sunkaier.com') {
  const name = text(actor.emailSignatureName);
  const title = text(actor.emailSignatureTitle);
  if (!name || !title) return null;
  const contactEmail = text(actor.email) || sharedAddress;
  const phone = text(actor.phone);
  const lines = ['Best regards,', '', name, title, 'SUNKAIER Asia Pacific Pte. Ltd.', COMPANY_ADDRESS, `E: ${contactEmail}`];
  if (phone) lines.push(`T: ${phone}`);
  lines.push('W: www.sunkaier.com');
  lines.push('', CONFIDENTIALITY_NOTICE);
  return {
    fromAddress: sharedAddress.toLowerCase(),
    fromName: `${name} | SUNKAIER`,
    signature: lines.join('\n'),
    signatureHtml: signatureHtml({ name, title, contactEmail, phone, logoSrc: `cid:${SIGNATURE_LOGO_CID}` }),
    signaturePreviewHtml: signatureHtml({ name, title, contactEmail, phone, logoSrc: '/assets/sunkaier-logo-email.png' })
  };
}

export function buildPersonalEmailIdentity(actor, sharedAddress = 'sales@sunkaier.com') {
  const identity = personalEmailIdentity(actor, sharedAddress);
  if (!identity) {
    throw new CustomerEmailError('Complete the employee English email name and title before sending', 409);
  }
  return identity;
}

export function personalEmailSignaturePreview(actor, sharedAddress = 'sales@sunkaier.com') {
  return personalEmailIdentity(actor, sharedAddress)?.signature || '';
}

export function personalEmailSignatureHtmlPreview(actor, sharedAddress = 'sales@sunkaier.com') {
  return personalEmailIdentity(actor, sharedAddress)?.signaturePreviewHtml || '';
}

function appendSignature(body, signature) {
  const normalized = text(body);
  if (!normalized) throw new CustomerEmailError('Email body is required');
  return `${normalized}\n\n${signature}`;
}

function appendHtmlSignature(body, signature) {
  const normalized = text(body);
  if (!normalized) throw new CustomerEmailError('Email body is required');
  const bodyHtml = escapeHtml(normalized).replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#172033;line-height:1.55;">${bodyHtml}</div><div style="height:18px;line-height:18px;">&nbsp;</div>${signature}`;
}

function generateMessageId(uuid = randomUUID()) {
  return `<bestcrm-${uuid}@sunkaier.com>`;
}

async function opportunityContext(dependencies, opportunityId) {
  const opportunity = await dependencies.opportunityRepository.getOpportunityDetail(opportunityId);
  if (!opportunity) throw new CustomerEmailError('Opportunity not found', 404);
  const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
    ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    : [];
  return { ...opportunity, teamMembers };
}

function canSendOpportunityEmail(actor, opportunity) {
  if (hasRole(actor, ROLES.ADMINISTRATOR)) return true;
  const actorId = Number(actor.id);
  if ([
    opportunity.salespersonId,
    opportunity.salesManagerId,
    opportunity.quotationEngineerId,
    opportunity.technicalManagerId,
    opportunity.commercialManagerId
  ].some((id) => Number(id) === actorId)) return true;
  return opportunity.teamMembers?.some((member) => Number(member.userId) === actorId
    && member.isActive !== false
    && member.canSendExternalEmail === true);
}

async function resolveComposeContext(dependencies, actor, input) {
  const threadId = positiveId(input.threadId);
  const inquiryId = positiveId(input.inquiryId);
  const opportunityId = positiveId(input.opportunityId);
  let thread = threadId ? await dependencies.emailArchiveRepository.findThreadById(threadId) : null;
  if (threadId && !thread) throw new CustomerEmailError('Email thread not found', 404);
  const resolvedInquiryId = thread?.inquiryId || inquiryId;
  const resolvedOpportunityId = thread?.opportunityId || opportunityId;
  let inquiry = null;
  let opportunity = null;

  if (resolvedOpportunityId) {
    opportunity = await opportunityContext(dependencies, resolvedOpportunityId);
    if (!canViewOpportunity(actor, opportunity)) throw new CustomerEmailError('Forbidden', 403);
  } else if (resolvedInquiryId) {
    inquiry = await dependencies.inquiryRepository.findById(resolvedInquiryId);
    if (!inquiry) throw new CustomerEmailError('Inquiry not found', 404);
    if (!canAccessInquiryInbox(actor)) throw new CustomerEmailError('Forbidden', 403);
  } else {
    throw new CustomerEmailError('An inquiry, opportunity, or email thread is required');
  }

  if (!thread && opportunity) {
    thread = await dependencies.emailArchiveRepository.findLatestThreadByOpportunity(opportunity.id);
  }
  if (!thread && inquiry) {
    thread = await dependencies.emailArchiveRepository.findLatestThreadByInquiry(inquiry.id);
  }
  return {
    thread,
    inquiry,
    opportunity,
    canSend: opportunity ? canSendOpportunityEmail(actor, opportunity) : canAccessInquiryInbox(actor)
  };
}

async function replyHeaders(repository, thread, replyToMessageId) {
  const id = positiveId(replyToMessageId);
  if (!id) return { replyToMessage: null, inReplyTo: '', referenceIds: [] };
  const parent = await repository.findMessageById(id);
  if (!parent || Number(parent.threadId) !== Number(thread?.id)) {
    throw new CustomerEmailError('Reply message does not belong to this thread');
  }
  const references = [...(parent.referenceIds || []), parent.messageId].map(text).filter(Boolean);
  return { replyToMessage: parent, inReplyTo: parent.messageId, referenceIds: [...new Set(references)] };
}

async function quotationAttachments(dependencies, packageVersion) {
  if (!packageVersion) return [];
  const sources = await dependencies.quotationPackageRepository.getEmailAttachmentSources(packageVersion.id);
  if (!sources.length) {
    throw new CustomerEmailError(`Quotation package ${packageVersion.label} has no frozen attachments`, 409);
  }
  const attachments = [];
  for (const source of sources) {
    let content = Buffer.isBuffer(source.content) ? source.content : null;
    if (!content && source.storedPath) {
      const sourcePath = resolveStoredPath(dependencies.uploadDir, source.storedPath);
      if (!sourcePath) throw new CustomerEmailError(`Quotation attachment is unavailable: ${source.originalName}`, 409);
      content = await readFile(sourcePath);
    }
    if (!content) throw new CustomerEmailError(`Quotation attachment is unavailable: ${source.originalName}`, 409);
    const checksum = createHash('sha256').update(content).digest('hex');
    if (checksum !== source.sha256) {
      throw new CustomerEmailError(`Quotation attachment checksum mismatch: ${source.originalName}`, 409);
    }
    attachments.push({ filename: source.originalName, contentType: source.mimeType, content });
  }
  return attachments;
}

async function approvedQuotationPackage(dependencies, opportunity, packageId) {
  const id = positiveId(packageId);
  if (!id) return null;
  if (!opportunity) throw new CustomerEmailError('Quotation package email requires an opportunity');
  const packageVersion = await dependencies.quotationPackageRepository.getPackageDetail(id);
  if (!packageVersion
      || Number(packageVersion.opportunityId) !== Number(opportunity.id)
      || packageVersion.status !== 'approved'
      || !packageVersion.versionNo) {
    throw new CustomerEmailError('Only an approved QP-Vn from this opportunity can be sent', 409);
  }
  return packageVersion;
}

export async function getCustomerEmailComposeContext(dependencies, actor, input) {
  const context = await resolveComposeContext(dependencies, actor, input);
  const packages = context.opportunity
    ? (await dependencies.quotationPackageRepository.listByOpportunity(context.opportunity.id))
      .filter((item) => item.status === 'approved' && item.versionNo)
    : [];
  const conversation = context.thread
    ? await dependencies.emailArchiveRepository.getThreadDetail(context.thread.id)
    : null;
  const latestMessage = conversation?.messages
    ?.filter((message) => ['received', 'sent'].includes(message.deliveryStatus)).at(-1) || null;
  const opportunityThreads = context.opportunity
    ? (typeof dependencies.emailArchiveRepository.listThreadsByOpportunity === 'function'
        ? await dependencies.emailArchiveRepository.listThreadsByOpportunity(context.opportunity.id)
        : (context.thread ? [context.thread] : []))
    : [];
  const replyAddress = latestMessage?.direction === 'inbound'
    ? latestMessage.fromAddress
    : latestMessage?.toRecipients?.[0]?.address;
  return {
    ...context,
    conversation,
    opportunityThreads,
    packages,
    signaturePreview: personalEmailSignaturePreview(actor, dependencies.sharedAddress),
    signatureHtmlPreview: personalEmailSignatureHtmlPreview(actor, dependencies.sharedAddress),
    defaults: {
      to: context.inquiry?.contactEmail || replyAddress || '',
      subject: context.thread?.subject || context.inquiry?.subject || context.opportunity?.title || '',
      replyToMessageId: positiveId(input.replyToMessageId) || latestMessage?.id || null,
      quotationPackageVersionId: positiveId(input.quotationPackageVersionId)
    }
  };
}

export async function createCustomerEmailDraft(dependencies, actor, input, uploadedFiles = []) {
  const context = await resolveComposeContext(dependencies, actor, input);
  const action = text(input.action) || 'draft';
  if (!['draft', 'send'].includes(action)) throw new CustomerEmailError('Email action is invalid');
  if (action === 'send' && !context.canSend) throw new CustomerEmailError('You may save a draft but cannot send customer email for this opportunity', 403);

  const identity = buildPersonalEmailIdentity(actor, dependencies.sharedAddress);
  const toRecipients = parseRecipients(input.to, 'To');
  const ccRecipients = parseRecipients(input.cc, 'CC');
  if (!toRecipients.length) throw new CustomerEmailError('At least one To recipient is required');
  if (toRecipients.length + ccRecipients.length > 30) throw new CustomerEmailError('Too many email recipients');
  const subject = text(input.subject);
  if (!subject || /[\r\n]/.test(subject)) throw new CustomerEmailError('Email subject is required');
  if (subject.length > 300) throw new CustomerEmailError('Email subject is too long');
  const textBody = appendSignature(input.body, identity.signature);
  const htmlBody = appendHtmlSignature(input.body, identity.signatureHtml);
  if (textBody.length > 200000) throw new CustomerEmailError('Email body is too long');
  if (htmlBody.length > 300000) throw new CustomerEmailError('Email body is too long');

  const packageVersion = await approvedQuotationPackage(
    dependencies,
    context.opportunity,
    input.quotationPackageVersionId
  );
  const packageFiles = await quotationAttachments(dependencies, packageVersion);
  const uploadFiles = uploadedFiles.map((file) => ({
    filename: file.originalname,
    contentType: file.mimetype,
    content: file.buffer
  }));
  const attachments = [...packageFiles, ...uploadFiles];

  let thread = context.thread;
  if (!thread) {
    thread = await dependencies.emailArchiveRepository.createThread({
      mailboxKey: dependencies.sharedAddress,
      subject,
      normalizedSubject: subject.toLowerCase().replace(/^\s*(re|fw|fwd)\s*:\s*/i, ''),
      inquiryId: context.inquiry?.id || null,
      opportunityId: context.opportunity?.id || null,
      customerId: context.opportunity?.customerId || context.inquiry?.matchedCustomerId || null,
      contactId: context.opportunity?.primaryContactId || context.inquiry?.matchedContactId || null,
      lastMessageAt: (dependencies.now || (() => new Date().toISOString()))()
    });
  }
  const headers = await replyHeaders(dependencies.emailArchiveRepository, thread, input.replyToMessageId);
  const message = await dependencies.emailArchiveRepository.createOutboundMessage({
    threadId: thread.id,
    messageId: generateMessageId((dependencies.randomUUID || randomUUID)()),
    inReplyTo: headers.inReplyTo,
    referenceIds: headers.referenceIds,
    replyToMessageId: headers.replyToMessage?.id || null,
    quotationPackageVersionId: packageVersion?.id || null,
    fromAddress: identity.fromAddress,
    fromName: identity.fromName,
    toRecipients,
    ccRecipients,
    subject,
    textBody,
    htmlBody,
    safeHeaders: { 'x-bestcrm-author-user-id': String(actor.id) },
    deliveryStatus: 'draft',
    authoredBy: actor.id
  });
  await storeEmailArchiveAttachments({
    emailArchiveRepository: dependencies.emailArchiveRepository,
    messageId: message.id,
    attachments,
    uploadDir: dependencies.uploadDir,
    maxUploadMb: dependencies.maxUploadMb
  });
  await dependencies.emailArchiveRepository.touchThread(thread.id, (dependencies.now || (() => new Date().toISOString()))());
  if (action === 'send') return sendCustomerEmail(dependencies, actor, message.id);
  return dependencies.emailArchiveRepository.findMessageById(message.id);
}

async function finalizeDelivery(dependencies, input) {
  const work = async (repositories) => {
    const message = await repositories.emailArchiveRepository.completeOutboundDelivery(input);
    if (!message) throw new CustomerEmailError('Email delivery state changed; refresh before retrying', 409);
    await repositories.emailArchiveRepository.createDeliveryAttempt({
      messageId: message.id,
      attemptedBy: input.actorUserId,
      status: input.status,
      providerMessageId: input.providerMessageId,
      safeError: input.failureDetail
    });
    if (input.status === 'sent' && message.quotationPackageVersionId) {
      const sentPackage = await repositories.quotationPackageRepository.markSent({
        packageId: message.quotationPackageVersionId,
        actorUserId: input.actorUserId,
        sentEmailMessageId: message.id,
        comment: `Sent by archived CRM email ${message.messageId}`
      });
      if (!sentPackage) throw new CustomerEmailError('Approved quotation package could not be marked as sent', 409);
    }
    return message;
  };
  if (typeof dependencies.emailArchiveTransaction === 'function') {
    return dependencies.emailArchiveTransaction(work);
  }
  return work(dependencies);
}

export async function sendCustomerEmail(dependencies, actor, messageId) {
  const original = await dependencies.emailArchiveRepository.findMessageById(positiveId(messageId));
  if (!original || original.direction !== 'outbound') throw new CustomerEmailError('Outbound email not found', 404);
  const thread = await dependencies.emailArchiveRepository.findThreadById(original.threadId);
  const context = await resolveComposeContext(dependencies, actor, { threadId: thread?.id });
  if (!context.canSend) throw new CustomerEmailError('You may save a draft but cannot send customer email for this opportunity', 403);
  if (original.quotationPackageVersionId) {
    await approvedQuotationPackage(dependencies, context.opportunity, original.quotationPackageVersionId);
  }
  if (!dependencies.transport?.sendMail) throw new CustomerEmailError('Customer SMTP transport is not configured', 503);

  const claimed = await dependencies.emailArchiveRepository.claimOutboundForSend(original.id);
  if (!claimed) throw new CustomerEmailError('Only draft or failed email can be sent', 409);
  let result;
  try {
    const attachments = await dependencies.emailArchiveRepository.listAttachmentsByMessage(claimed.id);
    const mailAttachments = attachments.map((attachment) => {
      const attachmentPath = resolveStoredPath(dependencies.uploadDir, attachment.storedPath);
      if (!attachmentPath) throw new CustomerEmailError(`Archived attachment is unavailable: ${attachment.originalName}`, 409);
      return { filename: attachment.originalName, contentType: attachment.mimeType, path: attachmentPath };
    });
    if (claimed.htmlBody) {
      mailAttachments.push({
        filename: 'sunkaier-logo.png',
        contentType: 'image/png',
        path: SIGNATURE_LOGO_PATH,
        cid: SIGNATURE_LOGO_CID,
        contentDisposition: 'inline'
      });
    }
    result = await dependencies.transport.sendMail({
      from: { name: claimed.fromName, address: claimed.fromAddress },
      to: claimed.toRecipients,
      cc: claimed.ccRecipients,
      subject: claimed.subject,
      text: claimed.textBody,
      html: claimed.htmlBody || undefined,
      messageId: claimed.messageId,
      inReplyTo: claimed.inReplyTo || undefined,
      references: claimed.referenceIds.length ? claimed.referenceIds : undefined,
      attachments: mailAttachments
    });
  } catch (error) {
    const detail = safeError(error);
    await finalizeDelivery(dependencies, {
      messageId: claimed.id,
      actorUserId: actor.id,
      status: 'failed',
      failureCode: text(error?.code).slice(0, 80),
      failureDetail: detail
    });
    throw new CustomerEmailError(`Email delivery failed: ${detail}`, 502);
  }
  return finalizeDelivery(dependencies, {
    messageId: claimed.id,
    actorUserId: actor.id,
    status: 'sent',
    providerMessageId: result?.messageId || claimed.messageId,
    sentAt: (dependencies.now || (() => new Date().toISOString()))()
  });
}

export function createCustomerEmailTransport(config) {
  let transport = null;
  return {
    async sendMail(message) {
      if (!config?.host || !config?.user || !config?.password) {
        throw new CustomerEmailError('Customer SMTP transport is not configured', 503);
      }
      if (!transport) {
        const imported = await import('nodemailer');
        const nodemailer = imported.default || imported;
        transport = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: { user: config.user, pass: config.password }
        });
      }
      return transport.sendMail(message);
    }
  };
}
