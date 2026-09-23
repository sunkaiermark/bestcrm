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
    updated_at: '2026-09-03T01:00:00Z', message_count: 1, attachment_count: 2, purge_eligible: true,
    purge_blocked_reason: '', last_direction: 'inbound',
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
  assert.equal(threads[0].purgeEligible, true);
  assert.equal(threads[0].purgeBlockedReason, '');
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
  assert.match(calls[0].sql, /attachment\.content_disposition/);
  assert.match(calls[0].sql, /THEN 'inline' ELSE 'attachment'/);
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

test('email archive repository blocks only opportunity-linked threads from administrator deletion', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return {
        rows: [threadRow({
          inquiry_id: 8,
          opportunity_id: 20,
          purge_eligible: false,
          purge_blocked_reason: 'linked_opportunity'
        })]
      };
    }
  });

  const [thread] = await repository.listThreads({ archiveDisposition: 'archived' });

  assert.equal(thread.purgeEligible, false);
  assert.equal(thread.purgeBlockedReason, 'linked_opportunity');
  assert.match(calls[0].sql, /thread\.opportunity_id IS NULL\) AS purge_eligible/);
  assert.match(calls[0].sql, /WHEN thread\.opportunity_id IS NOT NULL THEN 'linked_opportunity'/);
  assert.doesNotMatch(calls[0].sql, /linked_inquiry|linked_customer|linked_contact|has_outbound_message|reply_chain_dependency/);
});

test('spam cleanup includes confirmed spam except opportunity-linked threads', async () => {
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
  assert.match(calls[0].sql, /thread\.archive_disposition = 'spam'/);
  assert.match(calls[0].sql, /thread\.triage_status = 'spam'/);
  assert.match(calls[0].sql, /thread\.opportunity_id IS NULL/);
  assert.doesNotMatch(calls[0].sql, /spam_inquiry/);
  assert.doesNotMatch(calls[0].sql, /opportunity_activity_links/);
  assert.doesNotMatch(calls[0].sql, /quotation_package_versions/);
});

test('non-business cleanup excludes only opportunity-linked mail', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{
        eligible_threads: '1', message_count: '1', attachment_count: '0', attachment_bytes: '0',
        raw_message_count: '1', raw_message_bytes: '120'
      }] };
    }
  });

  const summary = await repository.getCleanupSummary({
    mailboxKey: 'sales@sunkaier.com',
    folder: 'non_business'
  });

  assert.equal(summary.eligibleThreads, 1);
  assert.match(calls[0].sql, /thread\.archive_disposition = 'archived'/);
  assert.match(calls[0].sql, /thread\.triage_status = 'archived'/);
  assert.match(calls[0].sql, /thread\.opportunity_id IS NULL/);
  assert.doesNotMatch(calls[0].sql, /thread\.inquiry_id IS NULL/);
  assert.doesNotMatch(calls[0].sql, /thread\.customer_id IS NULL/);
  assert.doesNotMatch(calls[0].sql, /thread\.contact_id IS NULL/);
  assert.doesNotMatch(calls[0].sql, /outbound\.direction = 'outbound'/);
  assert.doesNotMatch(calls[0].sql, /business_event\.event_type IN/);
});

test('individual email deletion accepts every existing thread except opportunity-linked mail', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ eligible: true }] };
    }
  });

  assert.equal(await repository.isThreadPurgeEligible(88), true);
  assert.deepEqual(calls[0].params, [88]);
  assert.match(calls[0].sql, /WHERE thread\.id = \$1[\s\S]*AND thread\.opportunity_id IS NULL/);
  assert.doesNotMatch(calls[0].sql, /thread\.archive_disposition = 'spam'/);
  assert.doesNotMatch(calls[0].sql, /thread\.inquiry_id IS NULL|thread\.customer_id IS NULL|thread\.contact_id IS NULL/);
});

test('orphaned converted mail reclassification excludes outbound and historical business dependencies', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ eligible: false }] };
    }
  });
  assert.equal(await repository.isOrphanedConvertedInquirySpamEligible(8199), false);
  assert.deepEqual(calls[0].params, [8199]);
  assert.match(calls[0].sql, /thread\.triage_status = 'converted_inquiry'/);
  assert.match(calls[0].sql, /outbound\.direction = 'outbound'/);
  assert.match(calls[0].sql, /opportunity_activity_links/);
  assert.match(calls[0].sql, /quotation_package_versions/);
  assert.match(calls[0].sql, /external_reply\.thread_id <> thread\.id/);
  assert.match(calls[0].sql, /business_event\.event_type IN/);
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
          triage_status: 'archived', archive_disposition: 'archived', last_message_at: '2026-08-01T00:00:00Z',
          message_count: '1', attachment_count: '1',
          attachment_bytes: '50',
          raw_message_ids: [81], raw_message_count: '1',
          raw_message_bytes: '70', triage_event_count: '1', assignment_event_count: '0'
        }] };
      }
      if (statement.includes('INSERT INTO email_purge_audits')) {
        return { rows: [{ id: '91' }], rowCount: 1 };
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
  assert.equal(purged.purgeAuditId, 91);
  assert.equal(purged.fileJobCount, 3);
  const statements = calls.map((call) => call.sql);
  const auditIndex = statements.findIndex((sql) => sql.includes('INSERT INTO email_purge_audits'));
  const attachmentJobIndex = statements.findIndex((sql) => sql.includes("'attachment'"));
  const rawJobIndex = statements.findIndex((sql) => sql.includes("'raw_email'"));
  const outboundJobIndex = statements.findIndex((sql) => sql.includes("'outbound_email'"));
  const replyDetachIndex = statements.findIndex((sql) => sql.includes('SET reply_to_message_id = NULL'));
  const quotationDetachIndex = statements.findIndex((sql) => sql.includes('SET sent_email_message_id = NULL'));
  const activityLinkDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM opportunity_activity_links'));
  const mergeAuditDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_message_merge_audits'));
  const outboundArtifactDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_outbound_mime_artifacts'));
  const messageDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_messages WHERE'));
  const threadDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_threads WHERE'));
  const rawDeleteIndex = statements.findIndex((sql) => sql.includes('DELETE FROM email_raw_messages WHERE'));
  assert.ok(auditIndex > 0);
  assert.ok(attachmentJobIndex > auditIndex);
  assert.ok(rawJobIndex > attachmentJobIndex);
  assert.ok(outboundJobIndex > rawJobIndex);
  assert.ok(replyDetachIndex > outboundJobIndex);
  assert.ok(quotationDetachIndex > replyDetachIndex);
  assert.ok(activityLinkDeleteIndex > quotationDetachIndex);
  assert.ok(mergeAuditDeleteIndex > activityLinkDeleteIndex);
  assert.ok(outboundArtifactDeleteIndex > mergeAuditDeleteIndex);
  assert.ok(messageDeleteIndex > outboundArtifactDeleteIndex);
  assert.ok(threadDeleteIndex > messageDeleteIndex);
  assert.ok(rawDeleteIndex > threadDeleteIndex);
  assert.match(statements[1], /set_config\('bestcrm\.email_purge', 'enabled', true\)/);
});

test('email purge file jobs use leased skip-locked claims and guarded completion', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (statement.includes('RETURNING job.*')) {
        return { rows: [{
          id: '3', purge_audit_id: '91', file_kind: 'raw_email', stored_path: 'email-raw/spam.eml',
          expected_size: '70', expected_sha256: 'a'.repeat(64), status: 'processing', attempt_count: '2'
        }] };
      }
      if (statement.includes('SELECT count(*) AS count')) return { rows: [{ count: '1' }] };
      return { rows: [{ id: '3' }], rowCount: 1 };
    }
  });

  const jobs = await repository.claimEmailPurgeFileJobs({
    workerId: 'worker-1',
    purgeAuditIds: [91],
    limit: 10,
    leaseSeconds: 120
  });
  assert.equal(jobs[0].storedPath, 'email-raw/spam.eml');
  assert.equal(jobs[0].expectedSize, 70);
  assert.equal(jobs[0].attemptCount, 2);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /lease_expires_at <= now\(\)/);
  assert.deepEqual(calls[0].params, ['worker-1', 10, 120, [91]]);

  assert.equal(await repository.completeEmailPurgeFileJob({ jobId: 3, workerId: 'worker-1' }), true);
  assert.match(calls[1].sql, /WITH cleanup_setting AS MATERIALIZED/);
  assert.match(calls[1].sql, /set_config\('bestcrm\.email_purge_file_cleanup', 'enabled', true\)/);

  assert.equal(await repository.failEmailPurgeFileJob({
    jobId: 3,
    workerId: 'worker-1',
    errorCode: 'file_hash_mismatch',
    errorDetail: 'safe detail',
    retryDelaySeconds: 90
  }), true);
  assert.match(calls[2].sql, /status = 'pending'/);
  assert.match(calls[2].sql, /available_at = now\(\) \+ \(\$3::integer \* interval '1 second'\)/);
  assert.equal(await repository.countEmailPurgeFileJobs({ purgeAuditIds: [91] }), 1);
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

test('email archive repository filters one advisory rule category without changing folder scope', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [] }; }
  });

  await repository.listThreads({
    archiveDisposition: 'active',
    mailboxKey: 'sales@sunkaier.com',
    classificationCategory: 'newsletter'
  });

  assert.deepEqual(calls[0].params, ['active', 'sales@sunkaier.com', 'newsletter']);
  assert.match(calls[0].sql, /thread\.classification_category = \$3/);
});

test('email archive repository searches sender email subject opportunity and linked record identities', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: [] }; }
  });

  await repository.listThreads({
    archiveDisposition: 'active',
    mailboxKey: 'sales@sunkaier.com',
    direction: 'inbound',
    searchTerm: ' Jane_100% '
  });

  assert.deepEqual(calls[0].params, [
    'active',
    'sales@sunkaier.com',
    'inbound',
    '%Jane\\_100\\%%'
  ]);
  assert.match(calls[0].sql, /thread\.subject ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /search_message\.from_name ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /search_message\.from_address ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /search_message\.subject ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /opportunity\.opportunity_no ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /opportunity\.title ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /customer\.name ILIKE \$4 ESCAPE/);
  assert.match(calls[0].sql, /contact\.name ILIKE \$4 ESCAPE/);
  assert.doesNotMatch(calls[0].sql, /search_message\.text_body ILIKE/);
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
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (text.includes('FROM email_threads thread')) return { rows: [threadRow()] };
      if (text.includes('FROM email_attachments attachment')) return { rows: [{
        id: 21, message_id: 11, source_index: 0, original_name: 'spec.pdf', stored_path: 'email-archive/spec.pdf',
        mime_type: 'application/pdf', file_size: 4, sha256: 'a'.repeat(64), content_id: '',
        content_disposition: 'attachment', created_at: '2026-09-03'
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
  assert.equal(detail.messages[0].attachments[0].contentDisposition, 'attachment');
  assert.equal(detail.messages[0].attachments[0].isInline, false);
  assert.match(calls.find((sql) => sql.includes('FROM email_messages message')), /message\.canonical_message_id IS NULL/);
  assert.match(calls.find((sql) => sql.includes('FROM email_attachments attachment')), /COALESCE\(message\.canonical_message_id, message\.id\) AS message_id/);
});

test('email archive repository persists inline MIME disposition and maps legacy CID rows safely', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{
        id: 22,
        message_id: 11,
        source_index: 1,
        original_name: 'logo.png',
        stored_path: 'email-archive/logo.png',
        mime_type: 'image/png',
        file_size: 4,
        sha256: 'b'.repeat(64),
        content_id: 'logo@example.com',
        content_disposition: 'inline',
        created_at: '2026-09-03'
      }] };
    }
  });

  const attachment = await repository.createAttachment({
    messageId: 11,
    sourceIndex: 1,
    originalName: 'logo.png',
    storedPath: 'email-archive/logo.png',
    mimeType: 'image/png',
    fileSize: 4,
    sha256: 'b'.repeat(64),
    contentId: 'logo@example.com',
    contentDisposition: 'inline'
  });

  assert.match(calls[0].sql, /content_disposition/);
  assert.equal(calls[0].params[8], 'inline');
  assert.equal(attachment.contentDisposition, 'inline');
  assert.equal(attachment.isInline, true);
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
  assert.match(calls[0].sql, /bestcrm_canonical_email_message_id\(identity_message\.message_id\)/);
  assert.match(calls[0].sql, /COALESCE\(identity_message\.canonical_message_id, identity_message\.id\)/);
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
    htmlBody: '<p>Frozen body</p>',
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
  assert.equal(calls[0].params[12], '<p>Frozen body</p>');
  assert.match(calls[1].sql, /delivery_status IN \('draft', 'failed'\)/);
  assert.match(calls[2].sql, /delivery_status = 'pending'/);
  assert.match(calls[3].sql, /MAX\(attempt_number\)/);
  assert.equal(calls[3].params.length, 5);
});

test('email archive repository releases only the expected unconverted inquiry link', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [threadRow({ inquiry_id: null })] };
    }
  });

  const released = await repository.releaseThreadFromInquiry(1, 8);

  assert.equal(released.id, 1);
  assert.equal(released.inquiryId, null);
  assert.match(calls[0].sql, /SET inquiry_id = NULL/);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.match(calls[0].sql, /inquiry_id = \$2/);
  assert.match(calls[0].sql, /opportunity_id IS NULL/);
  assert.deepEqual(calls[0].params, [1, 8]);
});

test('email archive repository links an opportunity only while the expected lead link is unchanged', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [threadRow({ opportunity_id: 20 })] };
    }
  });

  const linked = await repository.linkThreadToOpportunity(1, 20, 8);

  assert.equal(linked.opportunityId, 20);
  assert.match(calls[0].sql, /opportunity_id IS NULL/);
  assert.match(calls[0].sql, /\$3::bigint IS NULL OR inquiry_id = \$3/);
  assert.deepEqual(calls[0].params, [1, 20, 8]);
});

test('Sent-folder observation reconciles a pending outbound message without changing its content identity', async () => {
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [messageRow({
        id: '13',
        direction: 'outbound',
        delivery_status: 'sent',
        provider_message_id: '<provider-13@example.com>',
        sent_at: '2026-09-19T00:00:00Z'
      })] };
    }
  });

  const reconciled = await repository.reconcileOutboundSentObservation({
    messageId: 13,
    providerMessageId: '<provider-13@example.com>',
    sentAt: '2026-09-19T00:00:00Z'
  });

  assert.equal(reconciled.deliveryStatus, 'sent');
  assert.match(calls[0].sql, /direction = 'outbound'/);
  assert.match(calls[0].sql, /delivery_status = 'pending'/);
  assert.doesNotMatch(calls[0].sql, /raw_message_id/);
  assert.deepEqual(calls[0].params, [13, '<provider-13@example.com>', '2026-09-19T00:00:00Z']);
});

test('outbound MIME artifact creation is idempotent only for the same immutable identity', async () => {
  const artifactRow = {
    id: '31',
    message_id: '22',
    stored_path: 'email-outbound/22/abc.eml',
    file_size: '120',
    sha256: 'a'.repeat(64),
    rfc_message_id: '<bestcrm-22@sunkaier.com>',
    created_at: '2026-09-20T01:00:00Z'
  };
  const calls = [];
  const repository = createEmailArchiveRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('INSERT INTO email_outbound_mime_artifacts')) return { rows: [] };
      return { rows: [artifactRow] };
    }
  });

  const artifact = await repository.createOutboundMimeArtifact({
    messageId: 22,
    storedPath: artifactRow.stored_path,
    fileSize: 120,
    sha256: artifactRow.sha256,
    rfcMessageId: artifactRow.rfc_message_id
  });

  assert.equal(artifact.id, 31);
  assert.equal(artifact.messageId, 22);
  assert.equal(artifact.fileSize, 120);
  assert.equal(artifact.sha256, 'a'.repeat(64));
  assert.match(calls[0].sql, /ON CONFLICT \(message_id\) DO NOTHING/);
  assert.match(calls[1].sql, /FROM email_outbound_mime_artifacts/);

  await assert.rejects(() => repository.createOutboundMimeArtifact({
    messageId: 22,
    storedPath: artifactRow.stored_path,
    fileSize: 121,
    sha256: artifactRow.sha256,
    rfcMessageId: artifactRow.rfc_message_id
  }), /Outbound MIME artifact identity conflict/);
});

test('outbound MIME artifact lookup maps the database identity', async () => {
  const repository = createEmailArchiveRepository({
    async query() {
      return { rows: [{
        id: '31', message_id: '22', stored_path: 'email-outbound/22/abc.eml',
        file_size: '120', sha256: 'b'.repeat(64),
        rfc_message_id: '<bestcrm-22@sunkaier.com>', created_at: '2026-09-20T01:00:00Z'
      }] };
    }
  });

  const artifact = await repository.findOutboundMimeArtifact(22);
  assert.deepEqual(artifact, {
    id: 31,
    messageId: 22,
    storedPath: 'email-outbound/22/abc.eml',
    fileSize: 120,
    sha256: 'b'.repeat(64),
    rfcMessageId: '<bestcrm-22@sunkaier.com>',
    createdAt: '2026-09-20T01:00:00Z'
  });
});
