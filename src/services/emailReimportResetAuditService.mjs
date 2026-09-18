import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

export const EMAIL_REIMPORT_RESET_PLAN_SCHEMA_VERSION = 1;
export const EMAIL_REIMPORT_RESET_RETENTION_RULE_VERSION = 'opportunity-history-v2';

function count(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countMap(rows, keyName) {
  return Object.fromEntries(rows.map((row) => [String(row[keyName] || ''), count(row.count)]));
}

function stringIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).sort((left, right) => {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function computeEmailReimportResetPlanSha256(plan) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(plan)), 'utf8')
    .digest('hex');
}

export const resetScopeCte = `
  WITH RECURSIVE seed_retained_threads AS MATERIALIZED (
    SELECT DISTINCT thread.id
    FROM email_threads thread
    WHERE thread.opportunity_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM opportunities opportunity
        WHERE opportunity.origin_inquiry_id = thread.inquiry_id
      )
      OR EXISTS (
        SELECT 1
        FROM inquiries inquiry
        WHERE inquiry.id = thread.inquiry_id
          AND inquiry.converted_opportunity_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM inquiry_customer_approvals approval
        WHERE approval.inquiry_id = thread.inquiry_id
          AND approval.converted_opportunity_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM email_thread_triage_events triage_event
        WHERE triage_event.thread_id = thread.id
          AND triage_event.opportunity_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM email_messages message
        JOIN opportunity_activity_links activity_link
          ON activity_link.email_message_id = message.id
        WHERE message.thread_id = thread.id
      )
      OR EXISTS (
        SELECT 1
        FROM email_messages message
        WHERE message.thread_id = thread.id
          AND message.quotation_package_version_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1
        FROM email_messages message
        JOIN quotation_package_versions package_version
          ON package_version.sent_email_message_id = message.id
        WHERE message.thread_id = thread.id
      )
  ),
  retained_threads(id) AS (
    SELECT id FROM seed_retained_threads
    UNION
    SELECT linked_message.thread_id
    FROM retained_threads retained_thread
    JOIN email_messages retained_message
      ON retained_message.thread_id = retained_thread.id
    JOIN email_messages linked_message
      ON linked_message.reply_to_message_id = retained_message.id
      OR retained_message.reply_to_message_id = linked_message.id
  ),
  retained_inquiries AS MATERIALIZED (
    SELECT DISTINCT inquiry.id
    FROM inquiries inquiry
    WHERE inquiry.source = 'email'
      AND (
        inquiry.converted_opportunity_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM opportunities opportunity
          WHERE opportunity.origin_inquiry_id = inquiry.id
        )
        OR EXISTS (
          SELECT 1
          FROM inquiry_customer_approvals approval
          WHERE approval.inquiry_id = inquiry.id
            AND approval.converted_opportunity_id IS NOT NULL
        )
        OR EXISTS (
          SELECT 1
          FROM email_threads thread
          JOIN retained_threads retained_thread ON retained_thread.id = thread.id
          WHERE thread.inquiry_id = inquiry.id
        )
      )
  ),
  deleted_inquiries AS MATERIALIZED (
    SELECT inquiry.id
    FROM inquiries inquiry
    WHERE inquiry.source = 'email'
      AND NOT EXISTS (
        SELECT 1 FROM retained_inquiries retained_inquiry WHERE retained_inquiry.id = inquiry.id
      )
  ),
  deleted_inquiry_attachments AS MATERIALIZED (
    SELECT attachment.*
    FROM inquiry_attachments attachment
    JOIN deleted_inquiries inquiry ON inquiry.id = attachment.inquiry_id
  ),
  deleted_inquiry_approvals AS MATERIALIZED (
    SELECT approval.*
    FROM inquiry_customer_approvals approval
    JOIN deleted_inquiries inquiry ON inquiry.id = approval.inquiry_id
  ),
  deleted_threads AS MATERIALIZED (
    SELECT thread.id
    FROM email_threads thread
    WHERE NOT EXISTS (
      SELECT 1 FROM retained_threads retained_thread WHERE retained_thread.id = thread.id
    )
  ),
  deleted_messages AS MATERIALIZED (
    SELECT message.*
    FROM email_messages message
    JOIN deleted_threads deleted_thread ON deleted_thread.id = message.thread_id
  ),
  deleted_email_attachments AS MATERIALIZED (
    SELECT attachment.*
    FROM email_attachments attachment
    JOIN deleted_messages message ON message.id = attachment.message_id
  ),
  deleted_attachment_scan_attempts AS MATERIALIZED (
    SELECT attempt.*
    FROM email_attachment_scan_attempts attempt
    JOIN deleted_email_attachments attachment ON attachment.id = attempt.attachment_id
  ),
  deleted_delivery_attempts AS MATERIALIZED (
    SELECT attempt.*
    FROM email_delivery_attempts attempt
    JOIN deleted_messages message ON message.id = attempt.message_id
  ),
  deleted_classification_events AS MATERIALIZED (
    SELECT event.*
    FROM email_classification_events event
    WHERE EXISTS (SELECT 1 FROM deleted_messages message WHERE message.id = event.message_id)
       OR EXISTS (SELECT 1 FROM deleted_threads thread WHERE thread.id = event.thread_id)
  ),
  deleted_raw_messages AS MATERIALIZED (
    SELECT raw.*
    FROM email_raw_messages raw
    WHERE NOT EXISTS (
      SELECT 1
      FROM email_messages retained_message
      JOIN retained_threads retained_thread ON retained_thread.id = retained_message.thread_id
      WHERE retained_message.raw_message_id = raw.id
    )
      AND NOT EXISTS (
        SELECT 1
        FROM email_message_mailbox_deliveries delivery
        JOIN email_messages retained_message ON retained_message.id = delivery.message_id
        JOIN retained_threads retained_thread ON retained_thread.id = retained_message.thread_id
        WHERE delivery.raw_message_id = raw.id
      )
  ),
  retained_raw_messages AS MATERIALIZED (
    SELECT raw.id
    FROM email_raw_messages raw
    WHERE NOT EXISTS (
      SELECT 1 FROM deleted_raw_messages deleted_raw WHERE deleted_raw.id = raw.id
    )
  ),
  deleted_raw_scan_attempts AS MATERIALIZED (
    SELECT attempt.*
    FROM email_raw_scan_attempts attempt
    JOIN deleted_raw_messages raw ON raw.id = attempt.raw_message_id
  ),
  deleted_raw_processing_attempts AS MATERIALIZED (
    SELECT attempt.*
    FROM email_raw_processing_attempts attempt
    JOIN deleted_raw_messages raw ON raw.id = attempt.raw_message_id
  ),
  deleted_mailbox_deliveries AS MATERIALIZED (
    SELECT delivery.*
    FROM email_message_mailbox_deliveries delivery
    WHERE EXISTS (SELECT 1 FROM deleted_messages message WHERE message.id = delivery.message_id)
       OR EXISTS (SELECT 1 FROM deleted_raw_messages raw WHERE raw.id = delivery.raw_message_id)
  ),
  deleted_assignment_events AS MATERIALIZED (
    SELECT event.*
    FROM email_thread_assignment_events event
    JOIN deleted_threads thread ON thread.id = event.thread_id
  ),
  deleted_triage_events AS MATERIALIZED (
    SELECT event.*
    FROM email_thread_triage_events event
    JOIN deleted_threads thread ON thread.id = event.thread_id
  )
`;

const idCollections = {
  retainedInquiryIds: 'retained_inquiries',
  inquiryIds: 'deleted_inquiries',
  inquiryAttachmentIds: 'deleted_inquiry_attachments',
  inquiryApprovalIds: 'deleted_inquiry_approvals',
  retainedThreadIds: 'retained_threads',
  threadIds: 'deleted_threads',
  messageIds: 'deleted_messages',
  emailAttachmentIds: 'deleted_email_attachments',
  attachmentScanAttemptIds: 'deleted_attachment_scan_attempts',
  deliveryAttemptIds: 'deleted_delivery_attempts',
  classificationEventIds: 'deleted_classification_events',
  retainedRawMessageIds: 'retained_raw_messages',
  rawMessageIds: 'deleted_raw_messages',
  rawScanAttemptIds: 'deleted_raw_scan_attempts',
  rawProcessingAttemptIds: 'deleted_raw_processing_attempts',
  mailboxDeliveryIds: 'deleted_mailbox_deliveries',
  assignmentEventIds: 'deleted_assignment_events',
  triageEventIds: 'deleted_triage_events'
};

function idsSelectList() {
  return Object.entries(idCollections).map(([key, table]) => (
    `(SELECT COALESCE(jsonb_agg(id::text ORDER BY id), '[]'::jsonb) FROM ${table}) AS ${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`
  )).join(',\n      ');
}

function syncState(state) {
  return {
    id: String(state.id),
    mailboxKey: state.mailbox_key,
    mailboxName: state.mailbox_name,
    uidValidity: state.uid_validity,
    incrementalLastUid: count(state.incremental_last_uid),
    backfillBeforeUid: state.backfill_before_uid === null ? null : count(state.backfill_before_uid),
    backfillComplete: Boolean(state.backfill_complete),
    rawBackfillBeforeUid: state.raw_backfill_before_uid === null ? null : count(state.raw_backfill_before_uid),
    rawBackfillComplete: Boolean(state.raw_backfill_complete),
    lastIncrementalSyncAt: state.last_incremental_sync_at,
    lastBackfillSyncAt: state.last_backfill_sync_at,
    lastRawBackfillSyncAt: state.last_raw_backfill_sync_at
  };
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeStoredPath(storedPath) {
  const value = String(storedPath || '');
  if (!value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return false;
  const segments = value.split('/');
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

export async function validateEmailReimportResetFiles(uploadDir, files) {
  const uploadRoot = path.resolve(String(uploadDir || ''));
  const errors = [];
  const resolvedFiles = [];
  let realUploadRoot;
  try {
    realUploadRoot = await realpath(uploadRoot);
  } catch (error) {
    return {
      ok: false,
      files: [],
      fileCount: files.length,
      expectedBytes: files.reduce((total, file) => total + count(file.expectedBytes), 0),
      actualBytes: 0,
      errors: [{ storedPath: '', reason: 'upload_root_unavailable', detail: error.code || error.message }]
    };
  }

  for (const file of files) {
    const storedPath = String(file.storedPath || '');
    if (!safeStoredPath(storedPath)) {
      errors.push({ storedPath, reason: 'unsafe_stored_path' });
      continue;
    }
    if (file.expectedSizeConflict) {
      errors.push({ storedPath, reason: 'conflicting_database_file_sizes' });
      continue;
    }
    const absolutePath = path.resolve(uploadRoot, ...storedPath.split('/'));
    if (!isPathWithin(uploadRoot, absolutePath)) {
      errors.push({ storedPath, reason: 'path_escapes_upload_root' });
      continue;
    }
    try {
      const fileStat = await lstat(absolutePath);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        errors.push({ storedPath, reason: 'not_regular_file' });
        continue;
      }
      const realFilePath = await realpath(absolutePath);
      if (!isPathWithin(realUploadRoot, realFilePath)) {
        errors.push({ storedPath, reason: 'real_path_escapes_upload_root' });
        continue;
      }
      if (fileStat.size !== count(file.expectedBytes)) {
        errors.push({
          storedPath,
          reason: 'file_size_mismatch',
          expectedBytes: count(file.expectedBytes),
          actualBytes: fileStat.size
        });
        continue;
      }
      resolvedFiles.push({
        storedPath,
        expectedBytes: count(file.expectedBytes),
        absolutePath,
        realPath: realFilePath
      });
    } catch (error) {
      errors.push({ storedPath, reason: 'file_unavailable', detail: error.code || error.message });
    }
  }

  return {
    ok: errors.length === 0,
    files: resolvedFiles,
    fileCount: files.length,
    expectedBytes: files.reduce((total, file) => total + count(file.expectedBytes), 0),
    actualBytes: resolvedFiles.reduce((total, file) => total + file.expectedBytes, 0),
    errors
  };
}

export async function buildEmailReimportResetPlan(queryTarget, { uploadDir } = {}) {
  const summaryResult = await queryTarget.query(`${resetScopeCte}
    SELECT
      (SELECT count(*) FROM inquiries WHERE source = 'email') AS total_email_inquiries,
      (SELECT count(*) FROM retained_inquiries) AS retained_email_inquiries,
      (SELECT count(*) FROM deleted_inquiries) AS deleted_email_inquiries,
      (SELECT count(*) FROM deleted_inquiry_attachments) AS deleted_inquiry_attachments,
      (SELECT COALESCE(sum(file_size), 0) FROM deleted_inquiry_attachments) AS deleted_inquiry_attachment_bytes,
      (SELECT count(*) FROM deleted_inquiry_approvals) AS deleted_inquiry_approvals,
      (SELECT count(*) FROM email_threads) AS total_threads,
      (SELECT count(*) FROM retained_threads) AS retained_threads,
      (SELECT count(*) FROM deleted_threads) AS deleted_threads,
      (SELECT count(*) FROM email_messages) AS total_messages,
      (SELECT count(*) FROM deleted_messages) AS deleted_messages,
      (SELECT count(*) FROM deleted_email_attachments) AS deleted_email_attachments,
      (SELECT COALESCE(sum(file_size), 0) FROM deleted_email_attachments) AS deleted_email_attachment_bytes,
      (SELECT count(*) FROM email_raw_messages) AS total_raw_messages,
      (SELECT count(*) FROM retained_raw_messages) AS retained_raw_messages,
      (SELECT count(*) FROM deleted_raw_messages) AS deleted_raw_messages,
      (SELECT COALESCE(sum(file_size), 0) FROM deleted_raw_messages) AS deleted_raw_message_bytes,
      (SELECT count(*) FROM deleted_triage_events) AS deleted_triage_events,
      (SELECT count(*) FROM deleted_assignment_events) AS deleted_assignment_events,
      (SELECT count(*) FROM deleted_classification_events) AS deleted_classification_events,
      (SELECT count(*) FROM deleted_mailbox_deliveries) AS deleted_mailbox_deliveries,
      (SELECT count(*) FROM email_raw_malware_events) AS retained_malware_metadata_events
  `);
  const inquiryStatusResult = await queryTarget.query(`
    SELECT status, count(*)
    FROM inquiries
    WHERE source = 'email'
    GROUP BY status
    ORDER BY status
  `);
  const threadCategoryResult = await queryTarget.query(`
    SELECT classification_category, count(*)
    FROM email_threads
    GROUP BY classification_category
    ORDER BY classification_category
  `);
  const threadTriageResult = await queryTarget.query(`
    SELECT triage_status, count(*)
    FROM email_threads
    GROUP BY triage_status
    ORDER BY triage_status
  `);
  const syncStateResult = await queryTarget.query(`
    SELECT
      id,
      mailbox_key,
      mailbox_name,
      uid_validity,
      incremental_last_uid,
      backfill_before_uid,
      backfill_complete,
      raw_backfill_before_uid,
      raw_backfill_complete,
      last_incremental_sync_at,
      last_backfill_sync_at,
      last_raw_backfill_sync_at
    FROM email_imap_sync_states
    ORDER BY mailbox_key, mailbox_name, id
  `);
  const idsResult = await queryTarget.query(`${resetScopeCte}
    SELECT
      ${idsSelectList()},
      (SELECT COALESCE(jsonb_agg(id::text ORDER BY id), '[]'::jsonb) FROM email_imap_sync_states) AS sync_state_ids
  `);
  const fileResult = await queryTarget.query(`${resetScopeCte},
    candidate_file_references AS MATERIALIZED (
      SELECT 'inquiry_attachment'::text AS source_kind, attachment.id AS source_id,
        attachment.stored_path, attachment.file_size
      FROM deleted_inquiry_attachments attachment
      UNION ALL
      SELECT 'email_attachment', attachment.id, attachment.stored_path, attachment.file_size
      FROM deleted_email_attachments attachment
      UNION ALL
      SELECT 'raw_message', raw.id, raw.stored_path, raw.file_size
      FROM deleted_raw_messages raw
      UNION ALL
      SELECT 'message_raw_compatibility', message.id, message.raw_eml_stored_path, message.raw_eml_file_size
      FROM deleted_messages message
      WHERE message.raw_eml_stored_path IS NOT NULL
    ),
    retained_file_references AS MATERIALIZED (
      SELECT attachment.stored_path
      FROM inquiry_attachments attachment
      WHERE NOT EXISTS (
        SELECT 1 FROM deleted_inquiry_attachments deleted WHERE deleted.id = attachment.id
      )
      UNION
      SELECT attachment.stored_path
      FROM email_attachments attachment
      WHERE NOT EXISTS (
        SELECT 1 FROM deleted_email_attachments deleted WHERE deleted.id = attachment.id
      )
      UNION
      SELECT raw.stored_path
      FROM email_raw_messages raw
      WHERE NOT EXISTS (
        SELECT 1 FROM deleted_raw_messages deleted WHERE deleted.id = raw.id
      )
      UNION
      SELECT message.raw_eml_stored_path
      FROM email_messages message
      WHERE message.raw_eml_stored_path IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM deleted_messages deleted WHERE deleted.id = message.id
        )
    )
    SELECT
      candidate.stored_path,
      min(candidate.file_size)::bigint AS expected_bytes,
      (min(candidate.file_size) IS DISTINCT FROM max(candidate.file_size)) AS expected_size_conflict,
      count(*)::integer AS reference_count
    FROM candidate_file_references candidate
    WHERE NOT EXISTS (
      SELECT 1
      FROM retained_file_references retained
      WHERE retained.stored_path = candidate.stored_path
    )
    GROUP BY candidate.stored_path
    ORDER BY candidate.stored_path
  `);

  const row = summaryResult.rows[0] || {};
  const idsRow = idsResult.rows[0] || {};
  const deleteIds = {};
  const retainIds = {};
  for (const key of Object.keys(idCollections)) {
    const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const ids = stringIds(idsRow[column]);
    if (key.startsWith('retained')) retainIds[key] = ids;
    else deleteIds[key] = ids;
  }
  deleteIds.syncStateIds = stringIds(idsRow.sync_state_ids);

  const files = fileResult.rows.map((file) => ({
    storedPath: String(file.stored_path),
    expectedBytes: count(file.expected_bytes),
    expectedSizeConflict: Boolean(file.expected_size_conflict),
    referenceCount: count(file.reference_count)
  }));
  const syncStates = syncStateResult.rows.map(syncState);
  const plan = {
    schemaVersion: EMAIL_REIMPORT_RESET_PLAN_SCHEMA_VERSION,
    retentionRuleVersion: EMAIL_REIMPORT_RESET_RETENTION_RULE_VERSION,
    retain: retainIds,
    delete: deleteIds,
    files,
    syncStates
  };
  const planSha256 = computeEmailReimportResetPlanSha256(plan);
  const fileValidation = uploadDir
    ? await validateEmailReimportResetFiles(uploadDir, files)
    : {
        ok: null,
        files: [],
        fileCount: files.length,
        expectedBytes: files.reduce((total, file) => total + file.expectedBytes, 0),
        actualBytes: null,
        errors: []
      };

  const audit = {
    mode: 'read_only',
    planSchemaVersion: EMAIL_REIMPORT_RESET_PLAN_SCHEMA_VERSION,
    planSha256,
    retentionRuleVersion: EMAIL_REIMPORT_RESET_RETENTION_RULE_VERSION,
    retentionRule: 'Keep direct and derived opportunity email history, formal quotation email, and the complete database reply chain.',
    inquiries: {
      totalEmailOrigin: count(row.total_email_inquiries),
      retainedForOpportunityHistory: count(row.retained_email_inquiries),
      deleteCandidates: count(row.deleted_email_inquiries),
      deleteCandidateAttachments: count(row.deleted_inquiry_attachments),
      deleteCandidateAttachmentBytes: count(row.deleted_inquiry_attachment_bytes),
      deleteCandidateApprovals: count(row.deleted_inquiry_approvals),
      byStatus: countMap(inquiryStatusResult.rows, 'status')
    },
    emailCenter: {
      totalThreads: count(row.total_threads),
      retainedOpportunityThreads: count(row.retained_threads),
      deleteCandidateThreads: count(row.deleted_threads),
      totalMessages: count(row.total_messages),
      deleteCandidateMessages: count(row.deleted_messages),
      deleteCandidateAttachments: count(row.deleted_email_attachments),
      deleteCandidateAttachmentBytes: count(row.deleted_email_attachment_bytes),
      totalRawMessages: count(row.total_raw_messages),
      retainedRawMessages: count(row.retained_raw_messages),
      deleteCandidateRawMessages: count(row.deleted_raw_messages),
      deleteCandidateRawMessageBytes: count(row.deleted_raw_message_bytes),
      deleteCandidateTriageEvents: count(row.deleted_triage_events),
      deleteCandidateAssignmentEvents: count(row.deleted_assignment_events),
      deleteCandidateClassificationEvents: count(row.deleted_classification_events),
      deleteCandidateMailboxDeliveries: count(row.deleted_mailbox_deliveries),
      retainedMalwareMetadataEvents: count(row.retained_malware_metadata_events),
      byClassificationCategory: countMap(threadCategoryResult.rows, 'classification_category'),
      byTriageStatus: countMap(threadTriageResult.rows, 'triage_status')
    },
    files: {
      deleteCandidateFiles: fileValidation.fileCount,
      deleteCandidateBytes: fileValidation.expectedBytes,
      validationPerformed: fileValidation.ok !== null,
      validationPassed: fileValidation.ok,
      validatedBytes: fileValidation.actualBytes,
      errors: fileValidation.errors
    },
    syncStates,
    safeguards: {
      immutableMalwareMetadataRetained: true,
      providerIdentityDedupeRetained: true,
      executionRequiresMatchingPlanSha256: true,
      executionRequiresVerifiedBackupId: true,
      executionRequiresDedicatedConfirmationToken: true
    }
  };

  return { plan, audit, fileValidation };
}

export async function auditEmailReimportReset(queryTarget, options = {}) {
  return (await buildEmailReimportResetPlan(queryTarget, options)).audit;
}
