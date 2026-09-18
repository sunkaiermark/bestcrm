import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  auditEmailReimportReset,
  computeEmailReimportResetPlanSha256,
  validateEmailReimportResetFiles
} from '../../src/services/emailReimportResetAuditService.mjs';

test('email reimport reset audit is read-only and separates opportunity history from delete candidates', async () => {
  const statements = [];
  const results = [
    { rows: [{
      total_email_inquiries: '8119',
      retained_email_inquiries: '30',
      deleted_email_inquiries: '8089',
      deleted_inquiry_attachments: '12',
      deleted_inquiry_attachment_bytes: '1024',
      deleted_inquiry_approvals: '2',
      total_threads: '8229',
      retained_threads: '31',
      deleted_threads: '8198',
      total_messages: '8305',
      deleted_messages: '8300',
      deleted_email_attachments: '20',
      deleted_email_attachment_bytes: '2048',
      total_raw_messages: '8305',
      retained_raw_messages: '5',
      deleted_raw_messages: '8300',
      deleted_raw_message_bytes: '4096',
      deleted_triage_events: '8198',
      deleted_assignment_events: '7',
      deleted_classification_events: '8300',
      deleted_mailbox_deliveries: '8300',
      retained_malware_metadata_events: '2'
    }] },
    { rows: [{ status: 'new', count: '6564' }, { status: 'converted', count: '29' }] },
    { rows: [{ classification_category: 'inquiry', count: '100' }, { classification_category: 'marketing_spam', count: '8000' }] },
    { rows: [{ triage_status: 'pending', count: '110' }, { triage_status: 'spam', count: '158' }] },
    { rows: [{
      id: '4',
      mailbox_key: 'sales@sunkaier.com',
      mailbox_name: 'INBOX',
      uid_validity: '44',
      incremental_last_uid: '9000',
      backfill_before_uid: '2',
      backfill_complete: true,
      raw_backfill_before_uid: null,
      raw_backfill_complete: false,
      last_incremental_sync_at: '2026-09-18T00:00:00Z',
      last_backfill_sync_at: '2026-09-17T00:00:00Z',
      last_raw_backfill_sync_at: null
    }] },
    { rows: [{
      retained_inquiry_ids: ['30'],
      inquiry_ids: ['1', '2'],
      inquiry_attachment_ids: ['3'],
      inquiry_approval_ids: ['4'],
      retained_thread_ids: ['31'],
      thread_ids: ['5', '6'],
      message_ids: ['7'],
      email_attachment_ids: ['8'],
      attachment_scan_attempt_ids: ['9'],
      delivery_attempt_ids: ['10'],
      classification_event_ids: ['11'],
      retained_raw_message_ids: ['12'],
      raw_message_ids: ['13'],
      raw_scan_attempt_ids: ['14'],
      raw_processing_attempt_ids: ['15'],
      mailbox_delivery_ids: ['16'],
      assignment_event_ids: ['17'],
      triage_event_ids: ['18'],
      sync_state_ids: ['4']
    }] },
    { rows: [{
      stored_path: 'email-raw/mail.eml',
      expected_bytes: '4096',
      expected_size_conflict: false,
      reference_count: '2'
    }] }
  ];
  const queryTarget = {
    async query(sql) {
      statements.push(String(sql));
      return results.shift();
    }
  };

  const audit = await auditEmailReimportReset(queryTarget);

  assert.equal(audit.mode, 'read_only');
  assert.equal(audit.inquiries.retainedForOpportunityHistory, 30);
  assert.equal(audit.inquiries.deleteCandidates, 8089);
  assert.equal(audit.emailCenter.retainedOpportunityThreads, 31);
  assert.equal(audit.emailCenter.deleteCandidateThreads, 8198);
  assert.equal(audit.emailCenter.deleteCandidateRawMessageBytes, 4096);
  assert.equal(audit.files.deleteCandidateFiles, 1);
  assert.match(audit.planSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(audit.inquiries.byStatus, { converted: 29, new: 6564 });
  assert.equal(audit.syncStates[0].incrementalLastUid, 9000);
  assert.equal(audit.syncStates[0].rawBackfillBeforeUid, null);
  assert.ok(statements.every((sql) => /^\s*(WITH|SELECT)/i.test(sql)));
  assert.ok(statements.every((sql) => !/\b(DELETE|UPDATE|INSERT|TRUNCATE|ALTER|DROP)\b/i.test(sql)));
  assert.ok(statements.some((sql) => /WITH RECURSIVE seed_retained_threads/i.test(sql)));
  assert.ok(statements.some((sql) => /linked_message\.reply_to_message_id = retained_message\.id/i.test(sql)));
  assert.ok(statements.some((sql) => /inquiry\.converted_opportunity_id IS NOT NULL/i.test(sql)));
});

test('email reimport reset plan hashes are canonical and sensitive to scope changes', () => {
  const left = { schemaVersion: 1, delete: { threadIds: ['2', '3'] }, files: [] };
  const reordered = { files: [], delete: { threadIds: ['2', '3'] }, schemaVersion: 1 };
  const changed = { schemaVersion: 1, delete: { threadIds: ['2', '4'] }, files: [] };

  assert.equal(
    computeEmailReimportResetPlanSha256(left),
    computeEmailReimportResetPlanSha256(reordered)
  );
  assert.notEqual(
    computeEmailReimportResetPlanSha256(left),
    computeEmailReimportResetPlanSha256(changed)
  );
});

test('email reset file validation rejects traversal and verifies exact file sizes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-reset-audit-'));
  try {
    await mkdir(path.join(uploadDir, 'email-archive'));
    await writeFile(path.join(uploadDir, 'email-archive', 'safe.txt'), 'safe', 'utf8');
    const validation = await validateEmailReimportResetFiles(uploadDir, [
      { storedPath: 'email-archive/safe.txt', expectedBytes: 4, expectedSizeConflict: false },
      { storedPath: '../outside.txt', expectedBytes: 1, expectedSizeConflict: false }
    ]);

    assert.equal(validation.ok, false);
    assert.equal(validation.files.length, 1);
    assert.equal(validation.files[0].storedPath, 'email-archive/safe.txt');
    assert.deepEqual(validation.errors.map((error) => error.reason), ['unsafe_stored_path']);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
