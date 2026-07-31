import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { signInquiryIntakeBody } from '../../src/services/inquiryIntakeService.mjs';

const secret = 'website-intake-secret';
const chatwootSecret = 'chatwoot-intake-secret';
const now = Date.parse('2026-07-31T04:00:00.000Z');

function createPublicIntakeApp(options = {}) {
  const calls = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    inquiryIntakeSecret: options.inquiryIntakeSecret ?? secret,
    chatwootInquiryIntakeSecret: options.chatwootInquiryIntakeSecret ?? chatwootSecret,
    inquiryIntakeNow: () => options.now ?? now,
    csrfProtection: true,
    userRepository: {
      async findByIdWithRoles() {
        return null;
      },
      async findByUsernameWithRoles() {
        return null;
      }
    },
    inquiryRepository: {
      async createInquiry(input) {
        calls.push(['createInquiry', input]);
        return { id: input.source === 'chatwoot' ? 89 : 88, ...input, ...(options.inquiryResult || {}) };
      }
    }
  });
  return { app, calls };
}

function signedPost(agent, payload, options = {}) {
  const timestamp = options.timestamp || '2026-07-31T04:00:00.000Z';
  const rawBody = JSON.stringify(payload);
  const signature = options.signature || signInquiryIntakeBody(options.secret || secret, timestamp, rawBody);
  return agent
    .post(options.path || '/api/inquiries/website')
    .set('content-type', 'application/json')
    .set('x-bestcrm-timestamp', timestamp)
    .set('x-bestcrm-signature', signature)
    .send(rawBody);
}

test('signed website inquiry API creates an inbox record without login or csrf token', async () => {
  const { app, calls } = createPublicIntakeApp();
  const payload = {
    submissionId: 'sunkaier-form-1001',
    receivedAt: '2026-07-31T03:58:00.000Z',
    title: 'Evaporator inquiry',
    company: 'Acme Process',
    name: 'Alice Chen',
    email: 'ALICE@EXAMPLE.COM',
    phone: '+86 510 1234',
    country: 'China',
    product: 'MVR Evaporator',
    message: 'Need evaporation package for wastewater.',
    priority: 'high',
    pageUrl: 'https://sunkaier.com/en/contact'
  };

  const response = await signedPost(request(app), payload);

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    id: 88,
    status: 'new',
    source: 'website'
  });
  assert.deepEqual(calls, [
    ['createInquiry', {
      source: 'website',
      sourceReference: 'sunkaier-form-1001',
      sourceReceivedAt: '2026-07-31T03:58:00.000Z',
      subject: 'Evaporator inquiry',
      companyName: 'Acme Process',
      contactName: 'Alice Chen',
      contactEmail: 'alice@example.com',
      contactPhone: '+86 510 1234',
      country: 'China',
      productInterest: 'MVR Evaporator',
      requirementText: 'Need evaporation package for wastewater.',
      rawPayload: payload,
      priority: 'high',
      status: 'new',
      assignedUserId: null,
      matchedCustomerId: null,
      matchedContactId: null,
      createdBy: null,
      reviewNote: ''
    }]
  ]);
});

test('signed Chatwoot inquiry API creates a Chatwoot inbox record', async () => {
  const { app, calls } = createPublicIntakeApp();
  const payload = {
    conversationId: '117236-9001',
    receivedAt: '2026-07-31T03:59:00.000Z',
    senderName: 'Bob Tan',
    senderEmail: 'BOB@EXAMPLE.COM',
    company: 'Beta Process',
    product: 'Industrial Mixer',
    handoffSummary: 'Needs a mixer quotation for a 10 m3 reactor.',
    priority: 'high'
  };

  const response = await signedPost(request(app), payload, {
    path: '/api/inquiries/chatwoot',
    secret: chatwootSecret
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    id: 89,
    status: 'new',
    source: 'chatwoot'
  });
  assert.equal(calls[0][1].sourceReference, '117236-9001');
  assert.equal(calls[0][1].contactEmail, 'bob@example.com');
  assert.equal(calls[0][1].requirementText, 'Needs a mixer quotation for a 10 m3 reactor.');
});

test('duplicate signed inquiry returns the existing inbox record', async () => {
  const { app, calls } = createPublicIntakeApp({
    inquiryResult: { id: 77, wasDuplicate: true }
  });

  const response = await signedPost(request(app), {
    submissionId: 'sunkaier-form-duplicate',
    message: 'Need a quotation.'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    id: 77,
    status: 'new',
    source: 'website',
    duplicate: true
  });
  assert.equal(calls.length, 1);
});

test('Chatwoot inquiry API requires its own configured secret', async () => {
  const { app, calls } = createPublicIntakeApp({ chatwootInquiryIntakeSecret: '' });

  const response = await signedPost(request(app), {
    conversationId: '117236-9002',
    handoffSummary: 'Needs a quotation.'
  }, {
    path: '/api/inquiries/chatwoot',
    secret: chatwootSecret
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Inquiry intake is not configured' });
  assert.deepEqual(calls, []);
});

test('website inquiry API rejects invalid signatures', async () => {
  const { app, calls } = createPublicIntakeApp();

  const response = await signedPost(request(app), {
    message: 'Need a quotation.'
  }, {
    signature: 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Invalid inquiry signature' });
  assert.deepEqual(calls, []);
});

test('website inquiry API rejects stale timestamps', async () => {
  const { app, calls } = createPublicIntakeApp();

  const response = await signedPost(request(app), {
    message: 'Need a quotation.'
  }, {
    timestamp: '2026-07-31T03:00:00.000Z'
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'Invalid inquiry signature' });
  assert.deepEqual(calls, []);
});

test('website inquiry API is unavailable until intake secret is configured', async () => {
  const { app, calls } = createPublicIntakeApp({ inquiryIntakeSecret: '' });

  const response = await signedPost(request(app), {
    message: 'Need a quotation.'
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Inquiry intake is not configured' });
  assert.deepEqual(calls, []);
});

test('website inquiry API requires requirement text after signature passes', async () => {
  const { app, calls } = createPublicIntakeApp();

  const response = await signedPost(request(app), {
    email: 'alice@example.com',
    company: 'Acme'
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Requirement is required' });
  assert.deepEqual(calls, []);
});
