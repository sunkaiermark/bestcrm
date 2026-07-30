import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { signInquiryIntakeBody } from '../../src/services/inquiryIntakeService.mjs';

const secret = 'website-intake-secret';
const now = Date.parse('2026-07-31T04:00:00.000Z');

function createPublicIntakeApp(options = {}) {
  const calls = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    inquiryIntakeSecret: options.inquiryIntakeSecret ?? secret,
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
        return { id: 88, ...input };
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
    .post('/api/inquiries/website')
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
