import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailArchiveRepository } from '../../src/repositories/emailArchiveRepository.mjs';

function threadRow(overrides = {}) {
  return {
    id: 1, mailbox_key: 'sales@sunkaier.com', subject: 'RFQ', normalized_subject: 'rfq',
    inquiry_id: 8, inquiry_status: 'new', opportunity_id: null, opportunity_no: null,
    opportunity_title: null, customer_id: null, customer_name: null, contact_id: null,
    contact_name: null, last_message_at: '2026-09-03T01:00:00Z', created_at: '2026-09-03T01:00:00Z',
    updated_at: '2026-09-03T01:00:00Z', message_count: 1, last_direction: 'inbound',
    last_from_address: 'buyer@example.com', last_text_preview: 'Need quote', ...overrides
  };
}

function messageRow(overrides = {}) {
  return {
    id: 11, thread_id: 1, direction: 'inbound', message_id: 'rfq@example.com', in_reply_to: '',
    reference_ids: [], provider_mailbox: 'INBOX', provider_uid_validity: '44', provider_uid: 7,
    from_address: 'buyer@example.com', from_name: 'Buyer', to_recipients: [{ address: 'sales@sunkaier.com' }],
    cc_recipients: [], subject: 'RFQ', text_body: 'Need quote', html_body: '<b>Need quote</b>',
    safe_headers: {}, delivery_status: 'received', provider_message_id: '', failure_code: '',
    failure_detail: '', authored_by: null, author_display_name: null, sent_at: null,
    received_at: '2026-09-03T01:00:00Z', created_at: '2026-09-03T01:00:00Z', ...overrides
  };
}

test('email archive repository lists threaded summaries without exposing bodies in the list query', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [threadRow()] };
    }
  });

  const threads = await repository.listThreads();
  assert.equal(threads[0].messageCount, 1);
  assert.equal(threads[0].inquiryId, 8);
  assert.equal(threads[0].lastFromAddress, 'buyer@example.com');
  assert.match(calls[0].sql, /LEFT JOIN LATERAL/);
  assert.match(calls[0].sql, /ORDER BY thread\.last_message_at DESC/);
});

test('email archive repository builds message detail with immutable attachment checksums', async () => {
  const repository = createEmailArchiveRepository({
    async query(sql) {
      const text = String(sql);
      if (text.includes('FROM email_threads thread')) return { rows: [threadRow()] };
      if (text.includes('FROM email_attachments attachment')) return { rows: [{
        id: 21, message_id: 11, source_index: 0, original_name: 'spec.pdf', stored_path: 'email-archive/spec.pdf',
        mime_type: 'application/pdf', file_size: 4, sha256: 'a'.repeat(64), content_id: '', created_at: '2026-09-03'
      }] };
      if (text.includes('FROM email_delivery_attempts attempt')) return { rows: [] };
      if (text.includes('FROM email_messages message')) return { rows: [messageRow()] };
      return { rows: [] };
    }
  });

  const detail = await repository.getThreadDetail(1);
  assert.equal(detail.messages[0].textBody, 'Need quote');
  assert.equal(detail.messages[0].attachments[0].originalName, 'spec.pdf');
  assert.equal(detail.messages[0].attachments[0].sha256, 'a'.repeat(64));
});

test('email archive repository writes RFC and provider identities with conflict protection', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [messageRow()] };
    }
  });

  const created = await repository.createInboundMessage({
    threadId: 1, messageId: 'rfq@example.com', inReplyTo: '', referenceIds: [], providerMailbox: 'INBOX',
    providerUidValidity: '44', providerUid: 7, fromAddress: 'buyer@example.com', fromName: 'Buyer',
    toRecipients: [{ address: 'sales@sunkaier.com' }], ccRecipients: [], subject: 'RFQ', textBody: 'Need quote',
    htmlBody: '', safeHeaders: {}, receivedAt: '2026-09-03T01:00:00Z'
  });

  assert.equal(created.messageId, 'rfq@example.com');
  assert.match(calls[0].sql, /ON CONFLICT DO NOTHING/);
  assert.equal(calls[0].params[4], 'INBOX');
  assert.equal(calls[0].params[5], '44');
  assert.equal(calls[0].params[6], 7);
});

test('outbound archive state keeps immutable content while delivery attempts increment on one message', async () => {
  const calls = [];
  const rows = [
    messageRow({
      id: 22, direction: 'outbound', delivery_status: 'draft', received_at: null,
      message_id: '<bestcrm-22@sunkaier.com>', authored_by: 7,
      reply_to_message_id: 11, quotation_package_version_id: 51
    }),
    messageRow({ id: 22, direction: 'outbound', delivery_status: 'pending', received_at: null }),
    messageRow({ id: 22, direction: 'outbound', delivery_status: 'sent', received_at: null }),
    { id: 1, message_id: 22, attempt_number: 2, attempted_by: 7, status: 'sent', provider_message_id: 'provider-22', safe_error: '', attempted_at: '2026-09-03' }
  ];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [rows.shift()] };
    }
  });

  const created = await repository.createOutboundMessage({
    threadId: 1,
    messageId: '<bestcrm-22@sunkaier.com>',
    inReplyTo: 'rfq@example.com',
    referenceIds: ['rfq@example.com'],
    replyToMessageId: 11,
    quotationPackageVersionId: 51,
    fromAddress: 'sales@sunkaier.com',
    fromName: 'Steven Yang | SUNKAIER',
    toRecipients: [{ address: 'buyer@example.com' }],
    ccRecipients: [],
    subject: 'Quotation',
    textBody: 'Frozen body',
    safeHeaders: {},
    deliveryStatus: 'draft',
    authoredBy: 7
  });
  await repository.claimOutboundForSend(created.id);
  await repository.completeOutboundDelivery({
    messageId: created.id,
    status: 'sent',
    providerMessageId: 'provider-22',
    sentAt: '2026-09-03T10:00:00Z'
  });
  await repository.createDeliveryAttempt({
    messageId: created.id,
    attemptedBy: 7,
    status: 'sent',
    providerMessageId: 'provider-22'
  });

  assert.match(calls[0].sql, /INSERT INTO email_messages/);
  assert.match(calls[0].sql, /quotation_package_version_id/);
  assert.equal(calls[0].params[5], 51);
  assert.match(calls[1].sql, /delivery_status IN \('draft', 'failed'\)/);
  assert.match(calls[2].sql, /delivery_status = 'pending'/);
  assert.match(calls[3].sql, /MAX\(attempt_number\)/);
  assert.equal(calls[3].params.length, 5);
});
