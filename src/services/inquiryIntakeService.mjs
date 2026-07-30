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
  const priority = isInquiryPriority(payload.priority) ? payload.priority : 'normal';
  return {
    source: 'website',
    sourceReference: text(payload.sourceReference || payload.submissionId || payload.id),
    sourceReceivedAt: isoTimestampOrNull(payload.sourceReceivedAt || payload.receivedAt),
    subject: text(payload.subject || payload.title),
    companyName: text(payload.companyName || payload.company),
    contactName: text(payload.contactName || payload.name),
    contactEmail: text(payload.contactEmail || payload.email).toLowerCase(),
    contactPhone: text(payload.contactPhone || payload.phone || payload.whatsapp),
    country: text(payload.country),
    productInterest: text(payload.productInterest || payload.product || payload.productName || payload.interest),
    requirementText: text(payload.requirementText || payload.requirement || payload.message || payload.description),
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
