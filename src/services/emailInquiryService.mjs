import { simpleParser } from 'mailparser';
import { isInquiryPriority } from '../domain/inquiries.mjs';
import { applyEmailInquiryFilter } from './emailInquiryFilterService.mjs';

const MAX_BODY_CHARS = 20000;

function text(value) {
  return String(value || '').trim();
}

function normalizeMessageId(value) {
  return text(value).replace(/^<|>$/g, '');
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
