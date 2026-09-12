import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailArchiveRepository } from '../../src/repositories/emailArchiveRepository.mjs';

function threadRow(overrides = {}) {
  return {
    id: 1, mailbox_key: 'sales@sunkaier.com', subject: 'RFQ', normalized_subject: 'rfq',
    inquiry_id: 8, inquiry_status: 'new', opportunity_id: null, opportunity_no: null,
    opportunity_title: null, customer_id: null, customer_code: null, customer_name: null, contact_id: null,
    contact_code: null, contact_name: null, archive_disposition: 'active', classification_category: 'inquiry',
    classification_reason: 'inquiry_intent', last_message_at: '2026-09-03T01:00:00Z', created_at: '2026-09-03T01:00:00Z',
    updated_at: '2026-09-03T01:00:00Z', message_count: 1, attachment_count: 2, last_direction: 'inbound',
    last_from_address: 'buyer@example.com', last_text_preview: 'Need quote', ...overrides
  };
}

function messageRow(overrides = {}) {
  return {
    id: 11, thread_id: 1, direction: 'inbound', message_id: 'rfq@example.com', in_reply_to: '',
    reference_ids: [], provider_mailbox: 'INBOX', provider_uid_validity: '44', provider_uid: 7,
    from_address: 'buyer@example.com', from_name: 'Buyer', to_recipients: [{ address: 'sales@sunkaier.com' }],
    cc_recipients: [], subject: 'RFQ', text_body: 'Need quote', html_body: '<b>Need quote</b>',
    safe_headers: {}, archive_disposition: 'active', classification_category: 'inquiry',
    classification_reason: 'inquiry_intent', delivery_status: 'received', provider_message_id: '', failure_code: '',
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
  assert.equal(threads[0].attachmentCount, 2);
  assert.equal(threads[0].inquiryId, 8);
  assert.equal(threads[0].lastFromAddress, 'buyer@example.com');
  assert.match(calls[0].sql, /LEFT JOIN LATERAL/);
  assert.match(calls[0].sql, /ORDER BY thread\.last_message_at DESC/);
  assert.match(calls[0].sql, /WHERE thread\.archive_disposition = \$1/);
  assert.deepEqual(calls[0].params, ['active']);
  assert.match(calls[0].sql, /customer\.customer_code/);
  assert.match(calls[0].sql, /contact\.contact_code/);
  assert.match(calls[0].sql, /AS attachment_count/);
  assert.match(calls[0].sql, /LEFT JOIN email_attachments attachment/);
});

test('email archive repository supports explicit archived, spam, and all-mail views', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [] }; }
  });

  await repository.listThreads({ archiveDisposition: 'spam' });
  await repository.listThreads({ archiveDisposition: 'all' });

  assert.match(calls[0].sql, /WHERE thread\.archive_disposition = \$1/);
  assert.deepEqual(calls[0].params, ['spam']);
  assert.doesNotMatch(calls[1].sql, /WHERE thread\.archive_disposition = \$1/);
  assert.deepEqual(calls[1].params, []);
});

test('email purge eligibility excludes every business relationship and outbound conversation', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{
        eligible_threads: '2', message_count: '3', attachment_count: '1', attachment_bytes: '50',
        raw_message_count: '3', raw_message_bytes: '70'
      }] };
    }
  });

  const summary = await repository.getSpamCleanupSummary({ mailboxKey: 'Sales@Sunkaier.com' });

  assert.deepEqual(summary, {
    eligibleThreads: 2,
    messages: 3,
    attachments: 1,
    attachmentBytes: 50,
    rawMessages: 3,
    rawMessageBytes: 70
  });
  assert.deepEqual(calls[0].params, ['sales@sunkaier.com']);
  assert.match(calls[0].sql, /thread\.triage_status = 'spam'/);
  assert.match(calls[0].sql, /thread\.inquiry_id IS NULL/);
  assert.match(calls[0].sql, /thread\.opportunity_id IS NULL/);
  assert.match(calls[0].sql, /thread\.customer_id IS NULL/);
  assert.match(calls[0].sql, /thread\.contact_id IS NULL/);
  assert.match(calls[0].sql, /outbound\.direction = 'outbound'/);
  assert.match(calls[0].sql, /business_event\.event_type IN \('linked_opportunity', 'linked_inquiry', 'converted_inquiry'\)/);
  assert.match(calls[0].sql, /opportunity_activity_links/);
  assert.match(calls[0].sql, /quotation_package_versions/);
});

test('individual email deletion uses the same permanent business-history guard', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ eligible: true }] };
    }
  });

  assert.equal(await repository.isThreadPurgeEligible(88), true);
  assert.deepEqual(calls[0].params, [88]);
  assert.match(calls[0].sql, /thread\.inquiry_id IS NULL/);
  assert.match(calls[0].sql, /thread\.opportunity_id IS NULL/);
  assert.match(calls[0].sql, /business_event\.event_type IN \('linked_opportunity', 'linked_inquiry', 'converted_inquiry'\)/);
  assert.match(calls[0].sql, /outbound\.direction = 'outbound'/);
});

test('email purge repository writes the audit before deleting the isolated email graph', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (statement.includes('FOR UPDATE OF thread')) {
        return { rows: [{
          thread_id: '8', mailbox_key: 'sales@sunkaier.com', subject: 'SEO spam',
          triage_status: 'pending', archive_disposition: 'active', last_message_at: '2026-08-01T00:00:00Z',
          message_count: '1', attachment_count: '1',
          attachment_bytes: '50', attachment_paths: ['email-archive/spam.pdf'],
          raw_message_ids: [81], raw_message_paths: ['email-raw/spam.eml'], raw_message_count: '1',
          raw_message_bytes: '70', triage_event_count: '1', assignment_event_count: '0'
        }] };
      }
      return { rows: [], rowCount: 1 };
    }
  });

  const purged = await repository.purgeEmailThread({
    threadId: 8,
    actorUserId: 1,
    subjectSha256: 'a'.repeat(64),
    reason: 'administrator-confirmed unlinked email'
  });

  assert.equal(purged.threadId, 8);
  assert.deepEqual(purged.attachmentPaths, ['email-archive/spam.pdf']);
  assert.deepEqual(purged.rawMessagePaths, ['email-raw/spam.eml']);
  const statements = calls.map((call) => call.sql);
  const auditIndex = statements.findIndex((sql) => sql.includes('INSERT INTO email_purge_audits'));
  const messageDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_messages WHERE'));
  const threadDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_threads WHERE'));
  const rawDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_raw_messages WHERE'));
  assert.ok(auditIndex > 0);
  assert.ok(messageDeleteIndex > auditIndex);
  assert.ok(threadDeleteIndex > messageDeleteIndex);
  assert.ok(rawDeleteIndex > threadDeleteIndex);
  assert.match(statements[1], /set_config\('bestcrm\.email_purge', 'enabled', true\)/);
});

test('email archive repository separates mailbox folders and includes CRM-native sent mail', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [] }; }
  });

  await repository.listThreads({
    archiveDisposition: 'active',
    triageStatus: 'pending',
    mailboxKey: 'MarkYang@Sunkaier.com',
    direction: 'outbound'
  });

  assert.deepEqual(calls[0].params, [
    'active',
    'pending',
    'markyang@sunkaier.com',
    'outbound'
  ]);
  assert.match(calls[0].sql, /lower\(btrim\(mailbox_delivery\.mailbox_key\)\) = \$3/);
  assert.match(calls[0].sql, /NOT EXISTS \([\s\S]*FROM email_message_mailbox_deliveries native_delivery/);
  assert.match(calls[0].sql, /direction_message\.direction = \$4/);
  assert.match(calls[0].sql, /direction_delivery\.id IS NULL[\s\S]*lower\(btrim\(thread\.mailbox_key\)\) = \$3/);
});

test('email archive repository lists one opportunity using its indexed relationship', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [threadRow({ opportunity_id: 20 })] }; }
  });

  const threads = await repository.listThreadsByOpportunity(20);

  assert.equal(threads[0].opportunityId, 20);
  assert.match(calls[0].sql, /WHERE thread\.opportunity_id = \$1/);
  assert.match(calls[0].sql, /ORDER BY thread\.last_message_at DESC/);
  assert.deepEqual(calls[0].params, [20]);
});

test('email archive repository maps the linked customer code', async () => {
  const repository = createEmailArchiveRepository({
    async query() {
      return { rows: [threadRow({ customer_id: '10', customer_code: 'C000010', customer_name: 'Acme Co' })] };
    }
  });

  const [thread] = await repository.listThreads();
  assert.equal(thread.customerCode, 'C000010');
});

test('email archive repository maps the linked contact code', async () => {
  const repository = createEmailArchiveRepository({
    async query() {
      return { rows: [threadRow({ contact_id: '20', contact_code: 'CT000020', contact_name: 'Alice' })] };
    }
  });

  const [thread] = await repository.listThreads();
  assert.equal(thread.contactCode, 'CT000020');
});

test('email archive repository resolves the active personal mailbox owner', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [threadRow({ mailbox_key: 'markyang@sunkaier.com', mailbox_owner_user_id: '7' })] };
    }
  });

  const [thread] = await repository.listThreads();
  assert.equal(thread.mailboxOwnerUserId, 7);
  assert.match(calls[0].sql, /LEFT JOIN user_personal_mailbox_assignments mailbox_assignment/);
  assert.match(calls[0].sql, /mailbox_assignment\.unassigned_at IS NULL/);
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
    htmlBody: '', safeHeaders: {}, archiveDisposition: 'spam', classificationCategory: 'marketing_spam',
    classificationReason: 'seo_outreach', receivedAt: '2026-09-03T01:00:00Z'
  });

  assert.equal(created.messageId, 'rfq@example.com');
  assert.match(calls[0].sql, /ON CONFLICT DO NOTHING/);
  assert.equal(calls[0].params[4], 'INBOX');
  assert.equal(calls[0].params[5], '44');
  assert.equal(calls[0].params[6], 7);
  assert.equal(calls[0].params[20], 'spam');
  assert.equal(calls[0].params[21], 'marketing_spam');
  assert.equal(calls[0].params[22], 'seo_outreach');
});

test('email archive repository scopes provider delivery identity by company mailbox', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [messageRow()] };
    }
  });

  await repository.findMessageIdentity({
    messageId: 'rfq@example.com',
    mailboxKey: 'markyang@sunkaier.com',
    providerMailbox: 'INBOX',
    providerUidValidity: '44',
    providerUid: 7
  });

  assert.match(calls[0].sql, /FROM email_message_mailbox_deliveries delivery/);
  assert.match(calls[0].sql, /delivery\.mailbox_key = \$2/);
  assert.deepEqual(calls[0].params, [
    'rfq@example.com', 'markyang@sunkaier.com', 'INBOX', '44', 7
  ]);
});

test('email archive repository records an immutable mailbox delivery and active owner', async () => {
  const calls = [];
  const delivery = {
    id: '1', message_id: '11', raw_message_id: '81', mailbox_key: 'markyang@sunkaier.com',
    provider_mailbox: 'INBOX', provider_uid_validity: '44', provider_uid: '7', direction: 'inbound'
  };
  const rows = [[delivery], [{ user_id: '7' }]];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: rows.shift() || [] };
    }
  });

  const created = await repository.createMailboxDelivery({
    messageId: 11,
    rawMessageId: 81,
    mailboxKey: 'markyang@sunkaier.com',
    providerName: 'imap',
    providerMailbox: 'INBOX',
    providerUidValidity: '44',
    providerUid: 7,
    direction: 'inbound',
    firstObservedAt: '2026-09-11T00:00:00Z'
  });
  const ownerId = await repository.findActivePersonalMailboxOwner('markyang@sunkaier.com');

  assert.equal(created.mailbox_key, 'markyang@sunkaier.com');
  assert.equal(ownerId, 7);
  assert.match(calls[0].sql, /INSERT INTO email_message_mailbox_deliveries/);
  assert.match(calls[0].sql, /ON CONFLICT \(mailbox_key, provider_mailbox, provider_uid_validity, provider_uid\)/);
  assert.match(calls[1].sql, /JOIN users mailbox_owner/);
  assert.match(calls[1].sql, /mailbox_owner\.is_active = true/);
});

test('email archive repository creates immutable raw evidence and reuses provider identity', async () => {
  const calls = [];
  const rawRow = {
    id: '81', mailbox_key: 'sales@sunkaier.com', provider_name: 'imap', provider_mailbox: 'INBOX',
    provider_uid_validity: '44', provider_uid: '7', rfc_message_id_hint: 'rfq@example.com',
    source_received_at: '2026-09-08T00:00:00Z', first_observed_at: '2026-09-08T00:00:01Z',
    stored_path: `email-raw/${'a'.repeat(64)}/44/7-${'b'.repeat(16)}.eml`, file_size: '123',
    sha256: 'b'.repeat(64), created_at: '2026-09-08T00:00:01Z'
  };
  const rows = [[rawRow], [], [rawRow]];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: rows.shift() };
    }
  });
  const input = {
    mailboxKey: 'sales@sunkaier.com', providerName: 'imap', providerMailbox: 'INBOX',
    providerUidValidity: '44', providerUid: 7, rfcMessageIdHint: 'rfq@example.com',
    sourceReceivedAt: '2026-09-08T00:00:00Z', storedPath: rawRow.stored_path,
    fileSize: 123, sha256: 'b'.repeat(64)
  };

  const created = await repository.createRawMessage(input);
  const reused = await repository.createRawMessage(input);

  assert.equal(created.created, true);
  assert.equal(created.rawMessage.id, 81);
  assert.equal(reused.created, false);
  assert.equal(reused.rawMessage.sha256, 'b'.repeat(64));
  assert.match(calls[0].sql, /INSERT INTO email_raw_messages/);
  assert.match(calls[0].sql, /ON CONFLICT \(mailbox_key, provider_mailbox, provider_uid_validity, provider_uid\)/);
  assert.match(calls[2].sql, /FROM email_raw_messages/);
});

test('email archive repository records only UID, SHA-256, and ClamAV result for blocked raw mail', async () => {
  const calls = [];
  const row = {
    id: '91', mailbox_key: 'sales@sunkaier.com', provider_mailbox: 'INBOX',
    provider_uid_validity: '44', provider_uid: '901', sha256: 'c'.repeat(64),
    engine: 'clamav', engine_version: '1.5.3', signature_version: '20260908',
    verdict: 'malware', finding_code: 'Win.Trojan.Test', safe_detail: 'ClamAV detected malicious content',
    scan_started_at: '2026-09-08T01:00:00Z', scan_completed_at: '2026-09-08T01:00:01Z',
    created_at: '2026-09-08T01:00:02Z'
  };
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [row] }; }
  });

  const result = await repository.createMalwareSecurityEvent({
    mailboxKey: 'sales@sunkaier.com', providerMailbox: 'INBOX', providerUidValidity: '44',
    providerUid: 901, sha256: 'c'.repeat(64), engine: 'clamav', engineVersion: '1.5.3',
    signatureVersion: '20260908', verdict: 'malware', findingCode: 'Win.Trojan.Test',
    safeDetail: 'ClamAV detected malicious content', startedAt: '2026-09-08T01:00:00Z',
    completedAt: '2026-09-08T01:00:01Z'
  });

  assert.equal(result.created, true);
  assert.equal(result.malwareEvent.providerUid, 901);
  assert.equal(result.malwareEvent.sha256, 'c'.repeat(64));
  assert.match(calls[0].sql, /INSERT INTO email_raw_malware_events/);
  assert.doesNotMatch(calls[0].sql, /subject|from_address|text_body|stored_path/i);
  assert.equal(calls[0].params.length, 13);
});

test('email archive repository records append-only raw, attachment, processing, and classification evidence', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ id: '1', raw_message_id: '81', attachment_id: '91', attempt_no: '1' }] };
    }
  });
  const scan = {
    engine: 'clamav', engineVersion: '1', signatureVersion: '2', verdict: 'clean',
    findingCode: '', safeDetail: '', startedAt: '2026-09-08T00:00:00Z', completedAt: '2026-09-08T00:00:01Z'
  };

  await repository.createRawScanAttempt({ rawMessageId: 81, ...scan });
  await repository.createAttachmentScanAttempt({ attachmentId: 91, ...scan });
  await repository.createRawProcessingAttempt({
    rawMessageId: 81, stage: 'parse', outcome: 'succeeded', processorVersion: 'v1',
    startedAt: scan.startedAt, completedAt: scan.completedAt
  });
  await repository.createClassificationEvent({
    messageId: 11, threadId: 1, actorType: 'rule', actorVersion: 'v1',
    category: 'inquiry', confidence: 0.9, reasonCodes: ['rfq'], isFinal: false
  });

  assert.match(calls[0].sql, /email_raw_scan_attempts/);
  assert.match(calls[1].sql, /email_attachment_scan_attempts/);
  assert.match(calls[2].sql, /email_raw_processing_attempts/);
  assert.match(calls[3].sql, /email_classification_events/);
});

test('email archive repository persists independent incremental and backfill IMAP checkpoints', async () => {
  const calls = [];
  const rows = [
    {
      id: '1', mailbox_key: 'sales@sunkaier.com', mailbox_name: 'INBOX', uid_validity: '44',
      incremental_last_uid: '200', backfill_before_uid: '201', backfill_complete: false
    },
    {
      id: '1', mailbox_key: 'sales@sunkaier.com', mailbox_name: 'INBOX', uid_validity: '44',
      incremental_last_uid: '205', backfill_before_uid: '201', backfill_complete: false
    },
    {
      id: '1', mailbox_key: 'sales@sunkaier.com', mailbox_name: 'INBOX', uid_validity: '44',
      incremental_last_uid: '205', backfill_before_uid: '150', backfill_complete: true
    }
  ];
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [rows.shift()] }; }
  });

  const initial = await repository.initializeImapSyncState({
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '44',
    incrementalLastUid: 200, backfillBeforeUid: 201
  });
  const incremental = await repository.updateImapIncrementalCheckpoint({
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '44', uid: 205
  });
  const backfill = await repository.updateImapBackfillCheckpoint({
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '44', beforeUid: 150, complete: true
  });

  assert.equal(initial.incrementalLastUid, 200);
  assert.equal(incremental.incrementalLastUid, 205);
  assert.equal(backfill.backfillBeforeUid, 150);
  assert.equal(backfill.backfillComplete, true);
  assert.match(calls[0].sql, /ON CONFLICT \(mailbox_key, mailbox_name\)/);
  assert.match(calls[1].sql, /GREATEST\(incremental_last_uid, \$4\)/);
  assert.match(calls[2].sql, /LEAST\(backfill_before_uid, \$4\)/);
});

test('email archive repository keeps raw EML backfill independent from parsed-email backfill', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{
        id: '1', mailbox_key: 'sales@sunkaier.com', mailbox_name: 'INBOX', uid_validity: '44',
        incremental_last_uid: '205', backfill_before_uid: '1', backfill_complete: true,
        raw_backfill_before_uid: '150', raw_backfill_complete: false
      }] };
    }
  });

  const state = await repository.updateImapRawBackfillCheckpoint({
    mailboxKey: 'sales@sunkaier.com', mailboxName: 'INBOX', uidValidity: '44',
    beforeUid: 150, complete: false
  });

  assert.equal(state.backfillComplete, true);
  assert.equal(state.rawBackfillBeforeUid, 150);
  assert.equal(state.rawBackfillComplete, false);
  assert.match(calls[0].sql, /LEAST\(raw_backfill_before_uid, \$4\)/);
  assert.match(calls[0].sql, /last_raw_backfill_sync_at = now\(\)/);
});

test('email archive repository never initializes the raw cursor from the parsed cursor implicitly', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{
        id: '1', mailbox_key: 'sales@sunkaier.com', mailbox_name: 'INBOX', uid_validity: '44',
        incremental_last_uid: '205', backfill_before_uid: '100', backfill_complete: false,
        raw_backfill_before_uid: null, raw_backfill_complete: false
      }] };
    }
  });

  await repository.initializeImapSyncState({
    mailboxKey: 'sales@sunkaier.com',
    mailboxName: 'INBOX',
    uidValidity: '44',
    incrementalLastUid: 205,
    backfillBeforeUid: 100
  });

  assert.equal(calls[0].params[4], 100);
  assert.equal(calls[0].params[5], null);
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
