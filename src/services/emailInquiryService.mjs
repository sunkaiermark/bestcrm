import { simpleParser } from 'mailparser';
import { isInquiryPriority } from '../domain/inquiries.mjs';
import { applyEmailInquiryFilter } from './emailInquiryFilterService.mjs';

const MAX_BODY_CHARS = 20000;

function text(value) {
  return String(value || '').trim();
}

export function normalizeMessageId(value) {
  return text(value).replace(/^<|>$/g, '').toLowerCase();
}

function normalizeReferenceIds(value) {
  const values = Array.isArray(value) ? value : text(value).split(/\s+/);
  return [...new Set(values.map(normalizeMessageId).filter(Boolean))];
}

function normalizedThreadSubject(value) {
  let subject = text(value);
  let previous = '';
  while (subject && subject !== previous) {
    previous = subject;
    subject = subject.replace(/^\s*(?:(?:re|fw|fwd)\s*:\s*)/i, '');
  }
  return subject.trim().toLowerCase();
}

function dateToIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstAddress(addresses) {
  const value = Array.isArray(addresses?.value) ? addresses.value[0] : null;
  return {
    name: text(value?.name),
    address: text(value?.address).toLowerCase()
  };
}

function addressList(addresses) {
  return Array.isArray(addresses?.value)
    ? addresses.value.map((entry) => ({
      name: text(entry.name),
      address: text(entry.address).toLowerCase()
    }))
    : [];
}

function stripHtml(html) {
  return text(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyText(parsed) {
  const body = text(parsed.text) || stripHtml(parsed.html);
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[truncated]` : body;
}

function fieldFromBody(body, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = body.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*(.+)`, 'i'));
    if (match?.[1]) {
      return text(match[1]);
    }
  }
  return '';
}

function attachmentMetadata(attachments) {
  return Array.isArray(attachments)
    ? attachments.map((attachment) => ({
      filename: text(attachment.filename),
      contentType: text(attachment.contentType),
      size: Number(attachment.size || 0),
      cid: text(attachment.cid)
    }))
    : [];
}

function safeHeaders(parsed) {
  const safe = {};
  for (const name of [
    'auto-submitted',
    'content-language',
    'importance',
    'list-id',
    'list-unsubscribe',
    'precedence',
    'x-mailer'
  ]) {
    const value = parsed.headers?.get?.(name);
    if (value !== undefined && value !== null && text(value)) {
      safe[name] = text(value).slice(0, 500);
    }
  }
  return safe;
}

function htmlBody(parsed) {
  const value = typeof parsed.html === 'string' ? parsed.html : '';
  return value.length > MAX_BODY_CHARS ? `${value.slice(0, MAX_BODY_CHARS)}\n<!-- truncated -->` : value;
}

function sourceReferenceFor(parsed, meta) {
  return normalizeMessageId(parsed.messageId || meta.messageId)
    || (meta.uid ? `${text(meta.mailbox || 'INBOX')}:${meta.uid}` : '');
}

export function normalizeEmailInquiryPayload(parsed = {}, meta = {}) {
  const from = firstAddress(parsed.from);
  const body = bodyText(parsed);
  const priority = isInquiryPriority(meta.priority) ? meta.priority : 'normal';
  const sourceReference = sourceReferenceFor(parsed, meta);
  const subject = text(parsed.subject);

  return applyEmailInquiryFilter({
    source: 'email',
    sourceReference,
    sourceReceivedAt: dateToIso(parsed.date || meta.internalDate),
    subject,
    companyName: fieldFromBody(body, ['Company', 'Company Name', '公司', '公司名称']),
    contactName: fieldFromBody(body, ['Contact', 'Contact Name', 'Name', '联系人', '姓名']) || from.name,
    contactEmail: fieldFromBody(body, ['Email', 'E-mail', '邮箱'])?.toLowerCase() || from.address,
    contactPhone: fieldFromBody(body, ['Phone', 'Tel', 'Telephone', 'Mobile', 'WhatsApp', '电话', '手机']),
    country: fieldFromBody(body, ['Country', '国家']),
    productInterest: fieldFromBody(body, ['Product', 'Product Interest', 'Equipment', '产品', '设备']),
    opportunityType: fieldFromBody(body, ['Opportunity Type', 'Project Type', '商机类型', '项目类型']),
    requirementText: body || subject,
    rawPayload: {
      mailbox: text(meta.mailbox || 'INBOX'),
      uid: meta.uid || null,
      messageId: sourceReference,
      subject,
      date: dateToIso(parsed.date || meta.internalDate),
      from,
      to: addressList(parsed.to),
      cc: addressList(parsed.cc),
      headers: safeHeaders(parsed),
      text: body,
      attachments: attachmentMetadata(parsed.attachments)
    },
    priority,
    status: 'new',
    assignedUserId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: null,
    reviewNote: ''
  });
}

export async function parseEmailInquirySource(source, meta = {}) {
  const parsed = await simpleParser(source);
  return normalizeEmailInquiryPayload(parsed, meta);
}

export async function parseEmailInquirySourceWithAttachments(source, meta = {}) {
  const parsed = await simpleParser(source);
  return {
    inquiry: normalizeEmailInquiryPayload(parsed, meta),
    attachments: Array.isArray(parsed.attachments) ? parsed.attachments : []
  };
}

export function normalizeEmailArchivePayload(parsed = {}, meta = {}) {
  const from = firstAddress(parsed.from);
  const subject = text(parsed.subject);
  const inReplyTo = normalizeMessageId(parsed.inReplyTo);
  const references = normalizeReferenceIds(parsed.references);
  const receivedAt = dateToIso(parsed.date || meta.internalDate) || new Date().toISOString();
  return {
    mailboxKey: text(meta.mailboxKey || meta.mailbox || 'INBOX'),
    normalizedSubject: normalizedThreadSubject(subject),
    messageId: normalizeMessageId(parsed.messageId || meta.messageId),
    inReplyTo,
    referenceIds: references,
    replyReferenceIds: [...new Set([inReplyTo, ...references.slice().reverse()].filter(Boolean))],
    providerMailbox: text(meta.mailbox || 'INBOX'),
    providerUidValidity: text(meta.uidValidity),
    providerUid: meta.uid ? Number(meta.uid) : null,
    fromAddress: from.address,
    fromName: from.name,
    toRecipients: addressList(parsed.to),
    ccRecipients: addressList(parsed.cc),
    subject,
    textBody: bodyText(parsed),
    htmlBody: htmlBody(parsed),
    safeHeaders: safeHeaders(parsed),
    receivedAt
  };
}

export async function parseEmailArchiveSourceWithAttachments(source, meta = {}) {
  const parsed = await simpleParser(source);
  return {
    message: normalizeEmailArchivePayload(parsed, meta),
    inquiry: normalizeEmailInquiryPayload(parsed, meta),
    attachments: Array.isArray(parsed.attachments) ? parsed.attachments : []
  };
}

export async function createEmailInquiry(inquiryRepository, parsed, meta = {}) {
  const normalized = normalizeEmailInquiryPayload(parsed, meta);
  if (!normalized.sourceReference) {
    throw new Error('Email source reference is required');
  }
  if (!normalized.requirementText) {
    throw new Error('Email body is required');
  }
  return inquiryRepository.createInquiry(normalized);
}
