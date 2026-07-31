import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeChatwootInquiryPayload,
  normalizeWebsiteInquiryPayload,
  signInquiryIntakeBody,
  verifyInquiryIntakeSignature
} from '../../src/services/inquiryIntakeService.mjs';

test('intake signatures use timestamp and raw body', () => {
  const timestamp = '2026-07-31T04:00:00.000Z';
  const rawBody = '{"message":"Need quote"}';
  const signature = signInquiryIntakeBody('secret', timestamp, rawBody);

  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.deepEqual(verifyInquiryIntakeSignature({
    secret: 'secret',
    timestamp,
    signature,
    rawBody,
    now: Date.parse(timestamp)
  }), { ok: true });
  assert.deepEqual(verifyInquiryIntakeSignature({
    secret: 'secret',
    timestamp,
    signature,
    rawBody: '{"message":"Need different quote"}',
    now: Date.parse(timestamp)
  }), { ok: false, reason: 'invalid' });
});

test('intake signatures reject missing secret and stale timestamp', () => {
  const timestamp = '2026-07-31T04:00:00.000Z';
  const rawBody = '{}';
  const signature = signInquiryIntakeBody('secret', timestamp, rawBody);

  assert.deepEqual(verifyInquiryIntakeSignature({
    secret: '',
    timestamp,
    signature,
    rawBody,
    now: Date.parse(timestamp)
  }), { ok: false, reason: 'disabled' });
  assert.deepEqual(verifyInquiryIntakeSignature({
    secret: 'secret',
    timestamp,
    signature,
    rawBody,
    now: Date.parse('2026-07-31T04:10:01.000Z')
  }), { ok: false, reason: 'stale' });
});

test('normalizeWebsiteInquiryPayload maps common sunkaier.com form fields', () => {
  assert.deepEqual(normalizeWebsiteInquiryPayload({
    submissionId: 'form-1',
    receivedAt: '2026-07-31T04:00:00.000Z',
    title: 'Contact request',
    company: 'Acme',
    name: 'Alice',
    email: 'ALICE@EXAMPLE.COM',
    phone: '123',
    productName: 'Dryer',
    description: 'Need dryer quote',
    priority: 'bad'
  }), {
    source: 'website',
    sourceReference: 'form-1',
    sourceReceivedAt: '2026-07-31T04:00:00.000Z',
    subject: 'Contact request',
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '123',
    country: '',
    productInterest: 'Dryer',
    requirementText: 'Need dryer quote',
    rawPayload: {
      submissionId: 'form-1',
      receivedAt: '2026-07-31T04:00:00.000Z',
      title: 'Contact request',
      company: 'Acme',
      name: 'Alice',
      email: 'ALICE@EXAMPLE.COM',
      phone: '123',
      productName: 'Dryer',
      description: 'Need dryer quote',
      priority: 'bad'
    },
    priority: 'normal',
    status: 'new',
    assignedUserId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: null,
    reviewNote: ''
  });
});

test('normalizeChatwootInquiryPayload maps handoff summary and sender fields', () => {
  assert.deepEqual(normalizeChatwootInquiryPayload({
    conversationId: '117236-9001',
    receivedAt: '2026-07-31T04:00:00.000Z',
    company: 'Beta',
    senderName: 'Bob',
    senderEmail: 'BOB@EXAMPLE.COM',
    senderPhone: '+65 6000 0000',
    product: 'Industrial Mixer',
    handoffSummary: 'Needs a mixer quotation.',
    priority: 'urgent'
  }), {
    source: 'chatwoot',
    sourceReference: '117236-9001',
    sourceReceivedAt: '2026-07-31T04:00:00.000Z',
    subject: 'Chatwoot conversation #117236-9001',
    companyName: 'Beta',
    contactName: 'Bob',
    contactEmail: 'bob@example.com',
    contactPhone: '+65 6000 0000',
    country: '',
    productInterest: 'Industrial Mixer',
    requirementText: 'Needs a mixer quotation.',
    rawPayload: {
      conversationId: '117236-9001',
      receivedAt: '2026-07-31T04:00:00.000Z',
      company: 'Beta',
      senderName: 'Bob',
      senderEmail: 'BOB@EXAMPLE.COM',
      senderPhone: '+65 6000 0000',
      product: 'Industrial Mixer',
      handoffSummary: 'Needs a mixer quotation.',
      priority: 'urgent'
    },
    priority: 'urgent',
    status: 'new',
    assignedUserId: null,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: null,
    reviewNote: ''
  });
});
