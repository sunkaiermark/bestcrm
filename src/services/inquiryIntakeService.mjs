import { createHmac, timingSafeEqual } from 'node:crypto';
import { isInquiryPriority } from '../domain/inquiries.mjs';

const SIGNATURE_PREFIX = 'sha256=';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function text(value) {
  return String(value || '').trim();
}

function isoTimestampOrNull(value) {
  const normalized = text(value);
  return normalized || null;
}

function fieldFromText(body, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = body.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*(.+)`, 'i'));
    if (match?.[1]) {
      return text(match[1]);
    }
  }
  return '';
}

function websiteFields(payload) {
  const nested = [payload.formData, payload.data, payload.fields]
    .find((value) => value && typeof value === 'object' && !Array.isArray(value)) || {};
  return { ...nested, ...payload };
}

function parseTimestamp(value) {
  const normalized = text(value);
  if (!normalized) {
    return null;
  }
  if (/^\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    return normalized.length <= 10 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeSignature(value) {
  const normalized = text(value).toLowerCase();
  return normalized.startsWith(SIGNATURE_PREFIX)
    ? normalized.slice(SIGNATURE_PREFIX.length)
    : normalized;
}

function signatureFor(secret, timestamp, rawBody) {
  return createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest('hex');
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function signInquiryIntakeBody(secret, timestamp, rawBody) {
  return `${SIGNATURE_PREFIX}${signatureFor(secret, timestamp, rawBody)}`;
}

export function verifyInquiryIntakeSignature({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret) {
    return { ok: false, reason: 'disabled' };
  }
  const parsedTimestamp = parseTimestamp(timestamp);
  if (!parsedTimestamp || Math.abs(now - parsedTimestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'stale' };
  }
  const submitted = normalizeSignature(signature);
  const expected = signatureFor(secret, text(timestamp), rawBody);
  if (!safeEqualHex(submitted, expected)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true };
}

export function normalizeWebsiteInquiryPayload(payload = {}) {
  const fields = websiteFields(payload);
  const requirementText = text(fields.requirementText || fields.requirement || fields.message || fields.description);
  const priority = isInquiryPriority(fields.priority) ? fields.priority : 'normal';
  return {
    source: 'website',
    sourceReference: text(fields.sourceReference || fields.submissionId || fields.id),
    sourceReceivedAt: isoTimestampOrNull(fields.sourceReceivedAt || fields.receivedAt),
    subject: text(fields.subject || fields.title),
    companyName: text(fields.companyName || fields.customerName || fields.company)
      || fieldFromText(requirementText, ['Company Name', 'Company', 'Customer Name', '公司名称', '客户名称', '公司']),
    contactName: text(fields.contactName || fields.name)
      || fieldFromText(requirementText, ['Contact Name', 'Contact', '联系人', '姓名']),
    contactEmail: (text(fields.contactEmail || fields.email)
      || fieldFromText(requirementText, ['Email', 'E-mail', '邮箱'])).toLowerCase(),
    contactPhone: text(fields.contactPhone || fields.phone || fields.whatsapp)
      || fieldFromText(requirementText, ['Phone', 'Tel', 'Telephone', 'Mobile', 'WhatsApp', '电话', '手机']),
    country: text(fields.country) || fieldFromText(requirementText, ['Country', '国家']),
    productInterest: text(fields.productInterest || fields.product || fields.productName || fields.interest)
      || fieldFromText(requirementText, ['Product Interest', 'Product', 'Equipment', '关注产品', '产品', '设备']),
    opportunityType: text(
      fields.opportunityType
      || fields.opportunity_type
      || fields.projectType
      || fields.project_type
      || fields.inquiryType
    ) || fieldFromText(requirementText, ['Opportunity Type', 'Project Type', '商机类型', '项目类型']),
    requirementText,
    rawPayload: payload && typeof payload === 'object' ? payload : {},
    priority,
    status: 'new',
    assignedUserId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: null,
    reviewNote: ''
  };
}

export function normalizeChatwootInquiryPayload(payload = {}) {
  const priority = isInquiryPriority(payload.priority) ? payload.priority : 'normal';
  const conversationId = text(payload.conversationId || payload.conversation_id || payload.id);
  return {
    source: 'chatwoot',
    sourceReference: text(payload.sourceReference || conversationId),
    sourceReceivedAt: isoTimestampOrNull(payload.sourceReceivedAt || payload.receivedAt || payload.createdAt),
    subject: text(payload.subject || payload.title || (conversationId ? `Chatwoot conversation #${conversationId}` : '')),
    companyName: text(payload.companyName || payload.company),
    contactName: text(payload.contactName || payload.name || payload.senderName),
    contactEmail: text(payload.contactEmail || payload.email || payload.senderEmail).toLowerCase(),
    contactPhone: text(payload.contactPhone || payload.phone || payload.whatsapp || payload.senderPhone),
    country: text(payload.country),
    productInterest: text(payload.productInterest || payload.product || payload.productName || payload.interest),
    opportunityType: text(
      payload.opportunityType
      || payload.opportunity_type
      || payload.projectType
      || payload.project_type
      || payload.inquiryType
    ),
    requirementText: text(
      payload.requirementText
      || payload.handoffSummary
      || payload.summary
      || payload.requirement
      || payload.message
      || payload.description
    ),
    rawPayload: payload && typeof payload === 'object' ? payload : {},
    priority,
    status: 'new',
    assignedUserId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: null,
    reviewNote: ''
  };
}

export async function createWebsiteInquiry(inquiryRepository, payload) {
  const normalized = normalizeWebsiteInquiryPayload(payload);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  return inquiryRepository.createInquiry(normalized);
}

export async function createChatwootInquiry(inquiryRepository, payload) {
  const normalized = normalizeChatwootInquiryPayload(payload);
  if (!normalized.sourceReference) {
    throw new Error('Conversation reference is required');
  }
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  return inquiryRepository.createInquiry(normalized);
}
