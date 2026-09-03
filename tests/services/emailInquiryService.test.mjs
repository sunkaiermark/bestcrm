import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailInquiry,
  normalizeEmailInquiryPayload,
  parseEmailArchiveSourceWithAttachments,
  parseEmailInquirySource
} from '../../src/services/emailInquiryService.mjs';

test('normalizeEmailInquiryPayload maps sender body fields and attachments into an inquiry', () => {
  const parsed = {
    messageId: '<rfq-100@example.com>',
    date: new Date('2026-08-01T03:00:00.000Z'),
    subject: 'RFQ for evaporator',
    from: { value: [{ name: 'Alice Buyer', address: 'ALICE@EXAMPLE.COM' }] },
    to: { value: [{ name: 'Sales', address: 'sales@sunkaier.com' }] },
    text: [
      'Company: Acme Co',
      'Phone: +1 555 0000',
      'Country: United States',
      'Product: Evaporator',
      'Project Type: Expansion',
      '',
      'We need a wastewater evaporation package.'
    ].join('\n'),
    attachments: [{ filename: 'process.pdf', contentType: 'application/pdf', size: 1234, cid: 'cid-1' }]
  };

  const normalized = normalizeEmailInquiryPayload(parsed, { uid: 42, mailbox: 'INBOX' });

  assert.deepEqual(normalized, {
    source: 'email',
    sourceReference: 'rfq-100@example.com',
    sourceReceivedAt: '2026-08-01T03:00:00.000Z',
    subject: 'RFQ for evaporator',
    companyName: 'Acme Co',
    contactName: 'Alice Buyer',
    contactEmail: 'alice@example.com',
    contactPhone: '+1 555 0000',
    country: 'United States',
    productInterest: 'Evaporator',
    opportunityType: 'Expansion',
    requirementText: parsed.text,
    rawPayload: {
      mailbox: 'INBOX',
      uid: 42,
      messageId: 'rfq-100@example.com',
      subject: 'RFQ for evaporator',
      date: '2026-08-01T03:00:00.000Z',
      from: { name: 'Alice Buyer', address: 'alice@example.com' },
      to: [{ name: 'Sales', address: 'sales@sunkaier.com' }],
      cc: [],
      text: parsed.text,
      attachments: [{ filename: 'process.pdf', contentType: 'application/pdf', size: 1234, cid: 'cid-1' }],
      emailFilter: {
        status: 'new',
        category: 'inquiry',
        reason: 'inquiry_intent',
        matchedRules: ['\\brfq\\b', '\\bevaporators?\\b']
      }
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

test('parseEmailInquirySource parses raw RFC822 email', async () => {
  const raw = [
    'Message-ID: <rfq-101@example.com>',
    'Date: Sat, 01 Aug 2026 04:00:00 +0000',
    'From: Bob Buyer <BOB@EXAMPLE.COM>',
    'To: sales@sunkaier.com',
    'Subject: Dryer quote',
    '',
    'Company: Beta Co',
    'Need dryer quote.'
  ].join('\r\n');

  const inquiry = await parseEmailInquirySource(Buffer.from(raw), { uid: 101, mailbox: 'INBOX' });

  assert.equal(inquiry.source, 'email');
  assert.equal(inquiry.sourceReference, 'rfq-101@example.com');
  assert.equal(inquiry.contactName, 'Bob Buyer');
  assert.equal(inquiry.contactEmail, 'bob@example.com');
  assert.equal(inquiry.companyName, 'Beta Co');
  assert.match(inquiry.requirementText, /Need dryer quote/);
});

test('parseEmailInquirySource converts an HTML-only email into inquiry fields', async () => {
  const raw = [
    'Message-ID: <rfq-html-102@example.com>',
    'Date: Sat, 01 Aug 2026 05:00:00 +0000',
    'From: Carol Buyer <CAROL@EXAMPLE.COM>',
    'To: sales@sunkaier.com',
    'Subject: Mixing system inquiry',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body>',
    '<p>Company: Gamma Process</p>',
    '<p>Product: Mixing System</p>',
    '<p>Project Type: New Project</p>',
    '<p>Please quote a complete mixing system.</p>',
    '</body></html>'
  ].join('\r\n');

  const inquiry = await parseEmailInquirySource(Buffer.from(raw), { uid: 102, mailbox: 'INBOX' });

  assert.equal(inquiry.sourceReference, 'rfq-html-102@example.com');
  assert.equal(inquiry.contactName, 'Carol Buyer');
  assert.equal(inquiry.contactEmail, 'carol@example.com');
  assert.equal(inquiry.companyName, 'Gamma Process');
  assert.equal(inquiry.productInterest, 'Mixing System');
  assert.equal(inquiry.opportunityType, 'New Project');
  assert.match(inquiry.requirementText, /complete mixing system/i);
});

test('createEmailInquiry requires an email source reference', async () => {
  await assert.rejects(
    () => createEmailInquiry({ async createInquiry() {} }, { subject: 'No id', text: 'Need quote' }),
    /Email source reference is required/
  );
});

test('email archive parser normalizes reply headers and keeps HTML separate from safe plain text', async () => {
  const raw = [
    'Message-ID: <REPLY-2@EXAMPLE.COM>',
    'In-Reply-To: <SENT-1@EXAMPLE.COM>',
    'References: <ROOT@EXAMPLE.COM> <SENT-1@EXAMPLE.COM>',
    'Date: Thu, 03 Sep 2026 01:00:00 +0000',
    'From: Buyer <buyer@example.com>',
    'To: Sales <sales@sunkaier.com>',
    'Subject: Re: RFQ Mixer',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Need revised quotation.</p><script>alert(1)</script>'
  ].join('\r\n');

  const result = await parseEmailArchiveSourceWithAttachments(Buffer.from(raw), {
    uid: 9, uidValidity: '44', mailbox: 'INBOX', mailboxKey: 'sales@sunkaier.com'
  });
  assert.equal(result.message.messageId, 'reply-2@example.com');
  assert.equal(result.message.inReplyTo, 'sent-1@example.com');
  assert.deepEqual(result.message.referenceIds, ['root@example.com', 'sent-1@example.com']);
  assert.deepEqual(result.message.replyReferenceIds, ['sent-1@example.com', 'root@example.com']);
  assert.equal(result.message.normalizedSubject, 'rfq mixer');
  assert.match(result.message.textBody, /Need revised quotation/);
  assert.doesNotMatch(result.message.textBody, /alert\(1\)/);
  assert.match(result.message.htmlBody, /<script>/);
  assert.equal(result.message.providerUidValidity, '44');
});
