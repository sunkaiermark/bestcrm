import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function text(value) {
  return String(value || '');
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapThreadRow(row) {
  if (!row) return null;
  const mailboxOwnerUserIds = jsonArray(row.mailbox_owner_user_ids)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const primaryMailboxOwnerUserId = numberOrNull(row.mailbox_owner_user_id);
  if (primaryMailboxOwnerUserId && !mailboxOwnerUserIds.includes(primaryMailboxOwnerUserId)) {
    mailboxOwnerUserIds.push(primaryMailboxOwnerUserId);
  }
  return {
    id: Number(row.id),
    mailboxKey: row.mailbox_key,
    mailboxKeys: jsonArray(row.mailbox_keys).map((value) => text(value).trim().toLowerCase()).filter(Boolean),
    mailboxOwnerUserId: primaryMailboxOwnerUserId,
    mailboxOwnerUserIds,
    hasSharedMailboxDelivery: row.has_shared_mailbox_delivery === undefined
      ? text(row.mailbox_key).trim().toLowerCase() === 'sales@sunkaier.com'
      : Boolean(row.has_shared_mailbox_delivery),
    subject: text(row.subject),
    normalizedSubject: text(row.normalized_subject),
    inquiryId: numberOrNull(row.inquiry_id),
    inquiryStatus: text(row.inquiry_status),
    opportunityId: numberOrNull(row.opportunity_id),
    opportunityNo: text(row.opportunity_no),
    opportunityTitle: text(row.opportunity_title),
    customerId: numberOrNull(row.customer_id),
    customerCode: text(row.customer_code),
    customerName: text(row.customer_name),
    contactId: numberOrNull(row.contact_id),
    contactCode: text(row.contact_code),
    contactName: text(row.contact_name),
    archiveDisposition: text(row.archive_disposition) || 'active',
    classificationCategory: text(row.classification_category) || 'inquiry',
    classificationReason: text(row.classification_reason) || 'manual_review',
    triageStatus: text(row.triage_status) || 'pending',
    triageAssignedUserId: numberOrNull(row.triage_assigned_user_id),
    triageAssignedDisplayName: text(row.triage_assigned_display_name),
    triagedBy: numberOrNull(row.triaged_by),
    triagedByDisplayName: text(row.triaged_by_display_name),
    triagedAt: row.triaged_at,
    triageNote: text(row.triage_note),
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count || 0),
    attachmentCount: Number(row.attachment_count || 0),
    lastDirection: text(row.last_direction),
    lastFromAddress: text(row.last_from_address),
    lastTextPreview: text(row.last_text_preview)
  };
}

function mapTriageEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    eventType: text(row.event_type),
    fromStatus: text(row.from_status),
    toStatus: text(row.to_status),
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: text(row.actor_display_name),
    assignedUserId: numberOrNull(row.assigned_user_id),
    assignedDisplayName: text(row.assigned_display_name),
    inquiryId: numberOrNull(row.inquiry_id),
    opportunityId: numberOrNull(row.opportunity_id),
    note: text(row.note),
    createdAt: row.created_at
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    direction: row.direction,
    messageId: text(row.message_id),
    inReplyTo: text(row.in_reply_to),
    referenceIds: jsonArray(row.reference_ids),
    replyToMessageId: numberOrNull(row.reply_to_message_id),
    quotationPackageVersionId: numberOrNull(row.quotation_package_version_id),
    quotationPackageLabel: text(row.quotation_package_label),
    providerMailbox: text(row.provider_mailbox),
    providerUidValidity: text(row.provider_uid_validity),
    providerUid: numberOrNull(row.provider_uid),
    rawMessageId: numberOrNull(row.raw_message_id),
    rawEmlStoredPath: text(row.raw_eml_stored_path),
    rawEmlFileSize: numberOrNull(row.raw_eml_file_size),
    rawEmlSha256: text(row.raw_eml_sha256),
    fromAddress: text(row.from_address),
    fromName: text(row.from_name),
    toRecipients: jsonArray(row.to_recipients),
    ccRecipients: jsonArray(row.cc_recipients),
    subject: text(row.subject),
    textBody: text(row.text_body),
    htmlBody: text(row.html_body),
    safeHeaders: row.safe_headers || {},
    archiveDisposition: text(row.archive_disposition) || 'active',
    classificationCategory: text(row.classification_category) || 'inquiry',
    classificationReason: text(row.classification_reason) || 'manual_review',
    deliveryStatus: row.delivery_status,
    providerMessageId: text(row.provider_message_id),
    failureCode: text(row.failure_code),
    failureDetail: text(row.failure_detail),
    authoredBy: numberOrNull(row.authored_by),
    authorDisplayName: text(row.author_display_name),
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    createdAt: row.created_at,
    attachments: [],
    deliveryAttempts: []
  };
}

function mapImapSyncStateRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    mailboxKey: text(row.mailbox_key),
    mailboxName: text(row.mailbox_name),
    uidValidity: text(row.uid_validity),
    incrementalLastUid: Number(row.incremental_last_uid || 0),
    backfillBeforeUid: numberOrNull(row.backfill_before_uid),
    backfillComplete: Boolean(row.backfill_complete),
    rawBackfillBeforeUid: numberOrNull(row.raw_backfill_before_uid),
    rawBackfillComplete: Boolean(row.raw_backfill_complete),
    lastIncrementalSyncAt: row.last_incremental_sync_at,
    lastBackfillSyncAt: row.last_backfill_sync_at,
    lastRawBackfillSyncAt: row.last_raw_backfill_sync_at,
    lastErrorCode: text(row.last_error_code),
    lastErrorAt: row.last_error_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRawMessageRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    mailboxKey: text(row.mailbox_key),
    providerName: text(row.provider_name),
    providerMailbox: text(row.provider_mailbox),
    providerUidValidity: text(row.provider_uid_validity),
    providerUid: Number(row.provider_uid),
    rfcMessageIdHint: text(row.rfc_message_id_hint),
    sourceReceivedAt: row.source_received_at,
    firstObservedAt: row.first_observed_at,
    storedPath: text(row.stored_path),
    fileSize: Number(row.file_size),
    sha256: text(row.sha256),
    createdAt: row.created_at
  };
}

function mapEvidenceAttemptRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    rawMessageId: numberOrNull(row.raw_message_id),
    attachmentId: numberOrNull(row.attachment_id),
    attemptNo: Number(row.attempt_no),
    engine: text(row.engine),
    engineVersion: text(row.engine_version),
    signatureVersion: text(row.signature_version),
    verdict: text(row.verdict),
    findingCode: text(row.finding_code),
    safeDetail: text(row.safe_detail),
    stage: text(row.stage),
    outcome: text(row.outcome),
    processorVersion: text(row.processor_version),
    safeErrorCode: text(row.safe_error_code),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

function mapMalwareSecurityEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    mailboxKey: text(row.mailbox_key),
    providerMailbox: text(row.provider_mailbox),
    providerUidValidity: text(row.provider_uid_validity),
    providerUid: Number(row.provider_uid),
    sha256: text(row.sha256),
    engine: text(row.engine),
    engineVersion: text(row.engine_version),
    signatureVersion: text(row.signature_version),
    verdict: text(row.verdict),
    findingCode: text(row.finding_code),
    safeDetail: text(row.safe_detail),
    startedAt: row.scan_started_at,
    completedAt: row.scan_completed_at,
    createdAt: row.created_at
  };
}

function mapAttachmentRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    messageId: Number(row.message_id),
    sourceIndex: Number(row.source_index),
    originalName: normalizeUploadedFilename(row.original_name),
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    sha256: row.sha256,
    contentId: text(row.content_id),
    createdAt: row.created_at
  };
}

function mapDeliveryAttemptRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    messageId: Number(row.message_id),
    attemptNumber: Number(row.attempt_number),
    attemptedBy: numberOrNull(row.attempted_by),
    attemptedByDisplayName: text(row.attempted_by_display_name),
    status: row.status,
    providerMessageId: text(row.provider_message_id),
    safeError: text(row.safe_error),
    attemptedAt: row.attempted_at
  };
}

function mapSpamCleanupSummary(row = {}) {
  return {
    eligibleThreads: Number(row.eligible_threads || 0),
    messages: Number(row.message_count || 0),
    attachments: Number(row.attachment_count || 0),
    attachmentBytes: Number(row.attachment_bytes || 0),
    rawMessages: Number(row.raw_message_count || 0),
    rawMessageBytes: Number(row.raw_message_bytes || 0)
  };
}

function mapEmailPurgeCandidate(row) {
  if (!row) return null;
  return {
    threadId: Number(row.thread_id),
    mailboxKey: text(row.mailbox_key),
    subject: text(row.subject),
    triageStatus: text(row.triage_status),
    archiveDisposition: text(row.archive_disposition),
    lastMessageAt: row.last_message_at,
    messageCount: Number(row.message_count || 0),
    attachmentCount: Number(row.attachment_count || 0),
    attachmentBytes: Number(row.attachment_bytes || 0),
    rawMessageCount: Number(row.raw_message_count || 0),
    rawMessageBytes: Number(row.raw_message_bytes || 0),
    triageEventCount: Number(row.triage_event_count || 0),
    assignmentEventCount: Number(row.assignment_event_count || 0),
    attachmentPaths: jsonArray(row.attachment_paths).map(text).filter(Boolean),
    rawMessagePaths: jsonArray(row.raw_message_paths).map(text).filter(Boolean),
    rawMessageIds: jsonArray(row.raw_message_ids).map(Number).filter((value) => Number.isInteger(value) && value > 0)
  };
}

const emailPurgeBusinessEligibility = `
  thread.inquiry_id IS NULL
  AND thread.opportunity_id IS NULL
  AND thread.customer_id IS NULL
  AND thread.contact_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM email_messages outbound
    WHERE outbound.thread_id = thread.id AND outbound.direction = 'outbound'
  )
  AND NOT EXISTS (
    SELECT 1 FROM email_thread_triage_events business_event
    WHERE business_event.thread_id = thread.id
      AND business_event.event_type IN ('linked_opportunity', 'linked_inquiry', 'converted_inquiry')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM opportunity_activity_links activity_link
    JOIN email_messages activity_message ON activity_message.id = activity_link.email_message_id
    WHERE activity_message.thread_id = thread.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM quotation_package_versions package_version
    JOIN email_messages package_message ON package_message.id = package_version.sent_email_message_id
    WHERE package_message.thread_id = thread.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM email_messages referenced_message
    JOIN email_messages external_reply ON external_reply.reply_to_message_id = referenced_message.id
    WHERE referenced_message.thread_id = thread.id
      AND external_reply.thread_id <> thread.id
  )
`;

const spamPurgeEligibility = `
  thread.archive_disposition = 'spam'
  AND thread.triage_status = 'spam'
  AND ${emailPurgeBusinessEligibility}
`;

const threadSelect = `
  SELECT
    thread.id,
    thread.mailbox_key,
    COALESCE(mailbox_owners.mailbox_keys, jsonb_build_array(lower(btrim(thread.mailbox_key)))) AS mailbox_keys,
    mailbox_assignment.user_id AS mailbox_owner_user_id,
    COALESCE(mailbox_owners.user_ids, '[]'::jsonb) AS mailbox_owner_user_ids,
    COALESCE(
      mailbox_owners.has_shared_mailbox_delivery,
      lower(btrim(thread.mailbox_key)) = 'sales@sunkaier.com'
    ) AS has_shared_mailbox_delivery,
    thread.subject,
    thread.normalized_subject,
    thread.inquiry_id,
    inquiry.status AS inquiry_status,
    thread.opportunity_id,
    opportunity.opportunity_no,
    opportunity.title AS opportunity_title,
    thread.customer_id,
    customer.customer_code,
    customer.name AS customer_name,
    thread.contact_id,
    contact.contact_code,
    contact.name AS contact_name,
    thread.archive_disposition,
    thread.classification_category,
    thread.classification_reason,
    thread.triage_status,
    thread.triage_assigned_user_id,
    triage_assignee.display_name AS triage_assigned_display_name,
    thread.triaged_by,
    triage_actor.display_name AS triaged_by_display_name,
    thread.triaged_at,
    thread.triage_note,
    thread.last_message_at,
    thread.created_at,
    thread.updated_at,
    COALESCE(summary.message_count, 0) AS message_count,
    COALESCE(summary.attachment_count, 0) AS attachment_count,
    last_message.direction AS last_direction,
    last_message.from_address AS last_from_address,
    left(last_message.text_body, 240) AS last_text_preview
  FROM email_threads thread
  LEFT JOIN user_personal_mailbox_assignments mailbox_assignment
    ON mailbox_assignment.mailbox_address = lower(btrim(thread.mailbox_key))
    AND mailbox_assignment.unassigned_at IS NULL
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(DISTINCT delivery_assignment.user_id ORDER BY delivery_assignment.user_id)
        FILTER (WHERE delivery_assignment.user_id IS NOT NULL) AS user_ids,
      jsonb_agg(DISTINCT lower(btrim(delivery.mailbox_key)) ORDER BY lower(btrim(delivery.mailbox_key)))
        FILTER (WHERE btrim(delivery.mailbox_key) <> '') AS mailbox_keys,
      bool_or(lower(btrim(delivery.mailbox_key)) = 'sales@sunkaier.com') AS has_shared_mailbox_delivery
    FROM email_messages delivery_message
    JOIN email_message_mailbox_deliveries delivery
      ON delivery.message_id = delivery_message.id
    LEFT JOIN user_personal_mailbox_assignments delivery_assignment
      ON delivery_assignment.mailbox_address = lower(btrim(delivery.mailbox_key))
      AND delivery_assignment.unassigned_at IS NULL
    WHERE delivery_message.thread_id = thread.id
  ) mailbox_owners ON true
  LEFT JOIN inquiries inquiry ON inquiry.id = thread.inquiry_id
  LEFT JOIN users triage_assignee ON triage_assignee.id = thread.triage_assigned_user_id
  LEFT JOIN users triage_actor ON triage_actor.id = thread.triaged_by
  LEFT JOIN opportunities opportunity ON opportunity.id = thread.opportunity_id
  LEFT JOIN customers customer ON customer.id = thread.customer_id
  LEFT JOIN contacts contact ON contact.id = thread.contact_id
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT message.id)::integer AS message_count,
      count(attachment.id)::integer AS attachment_count
    FROM email_messages message
    LEFT JOIN email_attachments attachment ON attachment.message_id = message.id
    WHERE message.thread_id = thread.id
  ) summary ON true
  LEFT JOIN LATERAL (
    SELECT message.direction, message.from_address, message.text_body
    FROM email_messages message
    WHERE message.thread_id = thread.id
    ORDER BY COALESCE(message.received_at, message.sent_at, message.created_at) DESC, message.id DESC
    LIMIT 1
  ) last_message ON true
`;

const messageSelect = `
  SELECT
    message.*,
    author.display_name AS author_display_name,
    CASE
      WHEN package.version_no IS NOT NULL THEN 'QP-V' || package.version_no::text
      WHEN package.draft_revision_no IS NOT NULL THEN 'QP-D' || package.draft_revision_no::text
      ELSE ''
    END AS quotation_package_label
  FROM email_messages message
  LEFT JOIN users author ON author.id = message.authored_by
  LEFT JOIN quotation_package_versions package ON package.id = message.quotation_package_version_id
`;

export function createEmailArchiveRepository(queryTarget) {
  return {
    supportsEmailArchive: true,

    async findRawMessageIdentity(input) {
      const result = await queryTarget.query(`
        SELECT *
        FROM email_raw_messages
        WHERE mailbox_key = $1
          AND provider_mailbox = $2
          AND provider_uid_validity = $3
          AND provider_uid = $4
        LIMIT 1
      `, [
        input.mailboxKey,
        input.providerMailbox,
        input.providerUidValidity,
        input.providerUid
      ]);
      return mapRawMessageRow(result.rows[0]);
    },

    async createRawMessage(input) {
      const insertResult = await queryTarget.query(`
        INSERT INTO email_raw_messages (
          mailbox_key,
          provider_name,
          provider_mailbox,
          provider_uid_validity,
          provider_uid,
          rfc_message_id_hint,
          source_received_at,
          stored_path,
          file_size,
          sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (mailbox_key, provider_mailbox, provider_uid_validity, provider_uid)
        DO NOTHING
        RETURNING *
      `, [
        input.mailboxKey,
        input.providerName || 'imap',
        input.providerMailbox,
        input.providerUidValidity,
        input.providerUid,
        input.rfcMessageIdHint || '',
        input.sourceReceivedAt || null,
        input.storedPath,
        input.fileSize,
        input.sha256
      ]);
      const created = mapRawMessageRow(insertResult.rows[0]);
      if (created) return { rawMessage: created, created: true };
      return {
        rawMessage: await this.findRawMessageIdentity(input),
        created: false
      };
    },

    async findMalwareSecurityEventIdentity(input) {
      const result = await queryTarget.query(`
        SELECT *
        FROM email_raw_malware_events
        WHERE mailbox_key = $1
          AND provider_mailbox = $2
          AND provider_uid_validity = $3
          AND provider_uid = $4
        LIMIT 1
      `, [
        input.mailboxKey,
        input.providerMailbox,
        input.providerUidValidity,
        input.providerUid
      ]);
      return mapMalwareSecurityEventRow(result.rows[0]);
    },

    async createMalwareSecurityEvent(input) {
      const insertResult = await queryTarget.query(`
        INSERT INTO email_raw_malware_events (
          mailbox_key,
          provider_mailbox,
          provider_uid_validity,
          provider_uid,
          sha256,
          engine,
          engine_version,
          signature_version,
          verdict,
          finding_code,
          safe_detail,
          scan_started_at,
          scan_completed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (mailbox_key, provider_mailbox, provider_uid_validity, provider_uid)
        DO NOTHING
        RETURNING *
      `, [
        input.mailboxKey,
        input.providerMailbox,
        input.providerUidValidity,
        input.providerUid,
        input.sha256,
        input.engine,
        input.engineVersion || '',
        input.signatureVersion || '',
        input.verdict,
        input.findingCode || '',
        input.safeDetail || '',
        input.startedAt,
        input.completedAt
      ]);
      const created = mapMalwareSecurityEventRow(insertResult.rows[0]);
      if (created) return { malwareEvent: created, created: true };
      return {
        malwareEvent: await this.findMalwareSecurityEventIdentity(input),
        created: false
      };
    },

    async createRawScanAttempt(input) {
      const result = await queryTarget.query(`
        WITH next_attempt AS (
          SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
          FROM email_raw_scan_attempts
          WHERE raw_message_id = $1
        )
        INSERT INTO email_raw_scan_attempts (
          raw_message_id,
          attempt_no,
          engine,
          engine_version,
          signature_version,
          verdict,
          finding_code,
          safe_detail,
          started_at,
          completed_at
        )
        SELECT $1, next_attempt.attempt_no, $2, $3, $4, $5, $6, $7, $8, $9
        FROM next_attempt
        RETURNING *
      `, [
        input.rawMessageId,
        input.engine,
        input.engineVersion || '',
        input.signatureVersion || '',
        input.verdict,
        input.findingCode || '',
        input.safeDetail || '',
        input.startedAt,
        input.completedAt
      ]);
      return mapEvidenceAttemptRow(result.rows[0]);
    },

    async createRawProcessingAttempt(input) {
      const result = await queryTarget.query(`
        WITH next_attempt AS (
          SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
          FROM email_raw_processing_attempts
          WHERE raw_message_id = $1
        )
        INSERT INTO email_raw_processing_attempts (
          raw_message_id,
          attempt_no,
          stage,
          outcome,
          processor_version,
          safe_error_code,
          safe_detail,
          started_at,
          completed_at
        )
        SELECT $1, next_attempt.attempt_no, $2, $3, $4, $5, $6, $7, $8
        FROM next_attempt
        RETURNING *
      `, [
        input.rawMessageId,
        input.stage,
        input.outcome,
        input.processorVersion || '',
        input.safeErrorCode || '',
        input.safeDetail || '',
        input.startedAt,
        input.completedAt
      ]);
      return mapEvidenceAttemptRow(result.rows[0]);
    },

    async createAttachmentScanAttempt(input) {
      const result = await queryTarget.query(`
        WITH next_attempt AS (
          SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
          FROM email_attachment_scan_attempts
          WHERE attachment_id = $1
        )
        INSERT INTO email_attachment_scan_attempts (
          attachment_id,
          attempt_no,
          engine,
          engine_version,
          signature_version,
          verdict,
          finding_code,
          safe_detail,
          started_at,
          completed_at
        )
        SELECT $1, next_attempt.attempt_no, $2, $3, $4, $5, $6, $7, $8, $9
        FROM next_attempt
        RETURNING *
      `, [
        input.attachmentId,
        input.engine,
        input.engineVersion || '',
        input.signatureVersion || '',
        input.verdict,
        input.findingCode || '',
        input.safeDetail || '',
        input.startedAt,
        input.completedAt
      ]);
      return mapEvidenceAttemptRow(result.rows[0]);
    },

    async createClassificationEvent(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_classification_events (
          message_id,
          thread_id,
          actor_type,
          actor_version,
          actor_user_id,
          category,
          confidence,
          reason_codes,
          is_final
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        RETURNING *
      `, [
        input.messageId,
        input.threadId,
        input.actorType,
        input.actorVersion || '',
        input.actorUserId || null,
        input.category,
        input.confidence ?? null,
        JSON.stringify(input.reasonCodes || []),
        Boolean(input.isFinal)
      ]);
      return result.rows[0] || null;
    },

    async listThreads({ archiveDisposition = 'active', triageStatus = '', triageStatuses = [], mailboxKey = '', direction = '' } = {}) {
      const normalizedDisposition = ['active', 'archived', 'spam'].includes(archiveDisposition)
        ? archiveDisposition
        : '';
      const normalizedTriageStatus = [
        'pending',
        'linked_opportunity',
        'linked_inquiry',
        'converted_inquiry',
        'archived',
        'spam',
        'outbound_only'
      ].includes(triageStatus) ? triageStatus : '';
      const normalizedTriageStatuses = [...new Set((Array.isArray(triageStatuses) ? triageStatuses : [])
        .map((value) => text(value).trim())
        .filter((value) => [
          'pending',
          'linked_opportunity',
          'linked_inquiry',
          'converted_inquiry',
          'archived',
          'spam',
          'outbound_only'
        ].includes(value)))];
      const normalizedMailboxKey = text(mailboxKey).trim().toLowerCase();
      const normalizedDirection = ['inbound', 'outbound'].includes(direction) ? direction : '';
      const params = [];
      const where = [];
      let mailboxParamIndex = 0;
      if (normalizedDisposition) {
        params.push(normalizedDisposition);
        where.push(`thread.archive_disposition = $${params.length}`);
      }
      if (normalizedTriageStatus) {
        params.push(normalizedTriageStatus);
        where.push(`thread.triage_status = $${params.length}`);
      } else if (normalizedTriageStatuses.length) {
        params.push(normalizedTriageStatuses);
        where.push(`thread.triage_status = ANY($${params.length}::text[])`);
      }
      if (normalizedMailboxKey) {
        params.push(normalizedMailboxKey);
        mailboxParamIndex = params.length;
        where.push(`(
          EXISTS (
            SELECT 1
            FROM email_messages mailbox_message
            JOIN email_message_mailbox_deliveries mailbox_delivery
              ON mailbox_delivery.message_id = mailbox_message.id
            WHERE mailbox_message.thread_id = thread.id
              AND lower(btrim(mailbox_delivery.mailbox_key)) = $${params.length}
          )
          OR (
            lower(btrim(thread.mailbox_key)) = $${params.length}
            AND EXISTS (
              SELECT 1
              FROM email_messages native_message
              WHERE native_message.thread_id = thread.id
                AND NOT EXISTS (
                  SELECT 1
                  FROM email_message_mailbox_deliveries native_delivery
                  WHERE native_delivery.message_id = native_message.id
                )
            )
          )
        )`);
      }
      if (normalizedDirection) {
        params.push(normalizedDirection);
        where.push(`EXISTS (
          SELECT 1
          FROM email_messages direction_message
          LEFT JOIN email_message_mailbox_deliveries direction_delivery
            ON direction_delivery.message_id = direction_message.id
          WHERE direction_message.thread_id = thread.id
            AND direction_message.direction = $${params.length}
            ${normalizedMailboxKey ? `AND (
              lower(btrim(direction_delivery.mailbox_key)) = $${mailboxParamIndex}
              OR (
                direction_delivery.id IS NULL
                AND lower(btrim(thread.mailbox_key)) = $${mailboxParamIndex}
              )
            )` : ''}
        )`);
      }
      const result = await queryTarget.query(`
        ${threadSelect}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY thread.last_message_at DESC, thread.id DESC
      `, params);
      return result.rows.map(mapThreadRow);
    },

    async listActivePersonalMailboxAssignments() {
      const result = await queryTarget.query(`
        SELECT
          assignment.user_id,
          assignment.mailbox_address,
          mailbox_owner.display_name
        FROM user_personal_mailbox_assignments assignment
        JOIN users mailbox_owner ON mailbox_owner.id = assignment.user_id
        WHERE assignment.unassigned_at IS NULL
          AND mailbox_owner.is_active = true
        ORDER BY mailbox_owner.display_name, assignment.mailbox_address
      `);
      return result.rows.map((row) => ({
        userId: Number(row.user_id),
        mailboxAddress: text(row.mailbox_address).trim().toLowerCase(),
        displayName: text(row.display_name)
      }));
    },

    async listThreadsByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${threadSelect}
        WHERE thread.opportunity_id = $1
        ORDER BY thread.last_message_at DESC, thread.id DESC
      `, [opportunityId]);
      return result.rows.map(mapThreadRow);
    },

    async findThreadById(id) {
      const result = await queryTarget.query(`
        ${threadSelect}
        WHERE thread.id = $1
        LIMIT 1
      `, [id]);
      return mapThreadRow(result.rows[0]);
    },

    async getThreadDetail(id) {
      const thread = await this.findThreadById(id);
      if (!thread) return null;
      const [messageResult, attachmentResult, attemptResult, triageEventResult] = await Promise.all([
        queryTarget.query(`
          ${messageSelect}
          WHERE message.thread_id = $1
          ORDER BY COALESCE(message.received_at, message.sent_at, message.created_at), message.id
        `, [id]),
        queryTarget.query(`
          SELECT attachment.*
          FROM email_attachments attachment
          JOIN email_messages message ON message.id = attachment.message_id
          WHERE message.thread_id = $1
          ORDER BY attachment.message_id, attachment.source_index, attachment.id
        `, [id]),
        queryTarget.query(`
          SELECT attempt.*, actor.display_name AS attempted_by_display_name
          FROM email_delivery_attempts attempt
          LEFT JOIN users actor ON actor.id = attempt.attempted_by
          JOIN email_messages message ON message.id = attempt.message_id
          WHERE message.thread_id = $1
          ORDER BY attempt.message_id, attempt.attempt_number
        `, [id]),
        queryTarget.query(`
          SELECT
            event.*,
            actor.display_name AS actor_display_name,
            assignee.display_name AS assigned_display_name
          FROM email_thread_triage_events event
          JOIN users actor ON actor.id = event.actor_user_id
          LEFT JOIN users assignee ON assignee.id = event.assigned_user_id
          WHERE event.thread_id = $1
          ORDER BY event.id
        `, [id])
      ]);
      const messages = messageResult.rows.map(mapMessageRow);
      const messageMap = new Map(messages.map((message) => [message.id, message]));
      for (const row of attachmentResult.rows) {
        messageMap.get(Number(row.message_id))?.attachments.push(mapAttachmentRow(row));
      }
      for (const row of attemptResult.rows) {
        messageMap.get(Number(row.message_id))?.deliveryAttempts.push(mapDeliveryAttemptRow(row));
      }
      return {
        ...thread,
        messages,
        triageEvents: triageEventResult.rows.map(mapTriageEventRow)
      };
    },

    async findMessageById(id) {
      const result = await queryTarget.query(`
        ${messageSelect}
        WHERE message.id = $1
        LIMIT 1
      `, [id]);
      return mapMessageRow(result.rows[0]);
    },

    async findMessageIdentity({
      messageId = '',
      mailboxKey = '',
      providerMailbox = '',
      providerUidValidity = '',
      providerUid = null
    }) {
      const result = await queryTarget.query(`
        ${messageSelect}
        WHERE
          ($1 <> '' AND lower(message.message_id) = lower($1))
          OR EXISTS (
            SELECT 1
            FROM email_message_mailbox_deliveries delivery
            WHERE delivery.message_id = message.id
              AND delivery.mailbox_key = $2
              AND delivery.provider_mailbox = $3
              AND delivery.provider_uid_validity = $4
              AND delivery.provider_uid = $5
          )
        ORDER BY message.id
        LIMIT 1
      `, [messageId, mailboxKey, providerMailbox, providerUidValidity, providerUid]);
      return mapMessageRow(result.rows[0]);
    },

    async createMailboxDelivery(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_message_mailbox_deliveries (
          message_id,
          raw_message_id,
          mailbox_key,
          provider_name,
          provider_mailbox,
          provider_uid_validity,
          provider_uid,
          direction,
          first_observed_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (mailbox_key, provider_mailbox, provider_uid_validity, provider_uid)
        DO NOTHING
        RETURNING *
      `, [
        input.messageId,
        input.rawMessageId || null,
        input.mailboxKey,
        input.providerName || 'imap',
        input.providerMailbox,
        input.providerUidValidity,
        input.providerUid,
        input.direction,
        input.firstObservedAt || new Date().toISOString()
      ]);
      if (result.rows[0]) return result.rows[0];
      const existing = await queryTarget.query(`
        SELECT *
        FROM email_message_mailbox_deliveries
        WHERE mailbox_key = $1
          AND provider_mailbox = $2
          AND provider_uid_validity = $3
          AND provider_uid = $4
        LIMIT 1
      `, [input.mailboxKey, input.providerMailbox, input.providerUidValidity, input.providerUid]);
      return existing.rows[0] || null;
    },

    async findActivePersonalMailboxOwner(mailboxKey) {
      const result = await queryTarget.query(`
        SELECT assignment.user_id
        FROM user_personal_mailbox_assignments assignment
        JOIN users mailbox_owner ON mailbox_owner.id = assignment.user_id
        WHERE assignment.mailbox_address = lower(btrim($1))
          AND assignment.unassigned_at IS NULL
          AND mailbox_owner.is_active = true
        LIMIT 1
      `, [mailboxKey]);
      return result.rows[0]?.user_id ? Number(result.rows[0].user_id) : null;
    },

    async findThreadByReferences(referenceIds = []) {
      const normalized = referenceIds.map((value) => text(value).trim().toLowerCase()).filter(Boolean);
      if (!normalized.length) return null;
      const result = await queryTarget.query(`
        SELECT message.thread_id
        FROM email_messages message
        WHERE lower(message.message_id) = ANY($1::text[])
        ORDER BY array_position($1::text[], lower(message.message_id)), message.id DESC
        LIMIT 1
      `, [normalized]);
      return result.rows[0]?.thread_id ? this.findThreadById(result.rows[0].thread_id) : null;
    },

    async findLatestThreadByInquiry(inquiryId) {
      const result = await queryTarget.query(`
        ${threadSelect}
        WHERE thread.inquiry_id = $1
        ORDER BY thread.last_message_at DESC, thread.id DESC
        LIMIT 1
      `, [inquiryId]);
      return mapThreadRow(result.rows[0]);
    },

    async findLatestThreadByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${threadSelect}
        WHERE thread.opportunity_id = $1
        ORDER BY thread.last_message_at DESC, thread.id DESC
        LIMIT 1
      `, [opportunityId]);
      return mapThreadRow(result.rows[0]);
    },

    async createThread(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_threads (
          mailbox_key,
          subject,
          normalized_subject,
          inquiry_id,
          opportunity_id,
          customer_id,
          contact_id,
          archive_disposition,
          classification_category,
          classification_reason,
          triage_status,
          triage_assigned_user_id,
          triaged_by,
          triaged_at,
          triage_note,
          last_message_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `, [
        input.mailboxKey,
        input.subject || '',
        input.normalizedSubject || '',
        input.inquiryId || null,
        input.opportunityId || null,
        input.customerId || null,
        input.contactId || null,
        input.archiveDisposition || 'active',
        input.classificationCategory || 'inquiry',
        input.classificationReason || 'manual_review',
        input.triageStatus || 'pending',
        input.triageAssignedUserId || null,
        input.triagedBy || null,
        input.triagedAt || null,
        input.triageNote || '',
        input.lastMessageAt
      ]);
      return mapThreadRow(result.rows[0]);
    },

    async linkThreadToOpportunity(threadId, opportunityId) {
      const result = await queryTarget.query(`
        UPDATE email_threads
        SET opportunity_id = $2, updated_at = now()
        WHERE id = $1
          AND opportunity_id IS NULL
        RETURNING *
      `, [threadId, opportunityId]);
      return mapThreadRow(result.rows[0]);
    },

    async linkThreadToInquiry(threadId, inquiryId) {
      const result = await queryTarget.query(`
        UPDATE email_threads
        SET inquiry_id = $2, updated_at = now()
        WHERE id = $1
          AND inquiry_id IS NULL
        RETURNING *
      `, [threadId, inquiryId]);
      return mapThreadRow(result.rows[0]);
    },

    async assignThreadTriage(input) {
      const result = await queryTarget.query(`
        UPDATE email_threads
        SET
          triage_assigned_user_id = $2,
          updated_at = now()
        WHERE id = $1
          AND triage_status = 'pending'
        RETURNING *
      `, [input.threadId, input.assignedUserId || null]);
      return mapThreadRow(result.rows[0]);
    },

    async transitionThreadTriage(input) {
      const result = await queryTarget.query(`
        UPDATE email_threads
        SET
          triage_status = $3,
          archive_disposition = $4,
          triaged_by = $5,
          triaged_at = $6,
          triage_note = $7,
          updated_at = now()
        WHERE id = $1
          AND triage_status = $2
        RETURNING *
      `, [
        input.threadId,
        input.expectedStatus,
        input.triageStatus,
        input.archiveDisposition || 'active',
        input.actorUserId,
        input.triagedAt,
        input.note || ''
      ]);
      return mapThreadRow(result.rows[0]);
    },

    async getSpamCleanupSummary({ mailboxKey = '' }) {
      const result = await queryTarget.query(`
        WITH eligible AS (
          SELECT thread.id
          FROM email_threads thread
          WHERE ${spamPurgeEligibility}
            AND (
              $1 = ''
              OR lower(btrim(thread.mailbox_key)) = $1
              OR EXISTS (
                SELECT 1
                FROM email_messages mailbox_message
                JOIN email_message_mailbox_deliveries mailbox_delivery
                  ON mailbox_delivery.message_id = mailbox_message.id
                WHERE mailbox_message.thread_id = thread.id
                  AND lower(btrim(mailbox_delivery.mailbox_key)) = $1
              )
            )
        ),
        eligible_messages AS (
          SELECT message.*
          FROM email_messages message
          JOIN eligible ON eligible.id = message.thread_id
        ),
        eligible_raw_files AS (
          SELECT 'raw:' || raw.id::text AS file_key, raw.file_size
          FROM email_raw_messages raw
          JOIN eligible_messages message ON message.raw_message_id = raw.id
          UNION ALL
          SELECT 'legacy:' || message.id::text AS file_key, message.raw_eml_file_size
          FROM eligible_messages message
          WHERE message.raw_message_id IS NULL
            AND message.raw_eml_stored_path IS NOT NULL
            AND message.raw_eml_file_size IS NOT NULL
        )
        SELECT
          (SELECT count(*) FROM eligible) AS eligible_threads,
          (SELECT count(*) FROM eligible_messages) AS message_count,
          (
            SELECT count(*)
            FROM email_attachments attachment
            JOIN eligible_messages message ON message.id = attachment.message_id
          ) AS attachment_count,
          COALESCE((
            SELECT sum(attachment.file_size)
            FROM email_attachments attachment
            JOIN eligible_messages message ON message.id = attachment.message_id
          ), 0) AS attachment_bytes,
          (SELECT count(*) FROM eligible_raw_files) AS raw_message_count,
          COALESCE((SELECT sum(file_size) FROM eligible_raw_files), 0) AS raw_message_bytes
      `, [text(mailboxKey).trim().toLowerCase()]);
      return mapSpamCleanupSummary(result.rows[0]);
    },

    async listSpamPurgeCandidates({ mailboxKey = '', limit = 100 }) {
      const result = await queryTarget.query(`
        SELECT
          thread.id AS thread_id,
          thread.mailbox_key,
          thread.subject,
          thread.triage_status,
          thread.archive_disposition,
          thread.last_message_at
        FROM email_threads thread
        WHERE ${spamPurgeEligibility}
          AND (
            $1 = ''
            OR lower(btrim(thread.mailbox_key)) = $1
            OR EXISTS (
              SELECT 1
              FROM email_messages mailbox_message
              JOIN email_message_mailbox_deliveries mailbox_delivery
                ON mailbox_delivery.message_id = mailbox_message.id
              WHERE mailbox_message.thread_id = thread.id
                AND lower(btrim(mailbox_delivery.mailbox_key)) = $1
            )
          )
        ORDER BY thread.triaged_at NULLS FIRST, thread.id
        LIMIT $2
      `, [text(mailboxKey).trim().toLowerCase(), Math.max(1, Math.min(Number(limit) || 100, 100))]);
      return result.rows.map(mapEmailPurgeCandidate);
    },

    async isThreadPurgeEligible(threadId) {
      const result = await queryTarget.query(`
        SELECT EXISTS (
          SELECT 1
          FROM email_threads thread
          WHERE thread.id = $1
            AND ${emailPurgeBusinessEligibility}
        ) AS eligible
      `, [threadId]);
      return Boolean(result.rows[0]?.eligible);
    },

    async purgeEmailThread(input) {
      const candidateResult = await queryTarget.query(`
        SELECT
          thread.id AS thread_id,
          thread.mailbox_key,
          thread.subject,
          thread.triage_status,
          thread.archive_disposition,
          thread.last_message_at,
          (SELECT count(*) FROM email_messages message WHERE message.thread_id = thread.id) AS message_count,
          (
            SELECT count(*)
            FROM email_attachments attachment
            JOIN email_messages message ON message.id = attachment.message_id
            WHERE message.thread_id = thread.id
          ) AS attachment_count,
          COALESCE((
            SELECT sum(attachment.file_size)
            FROM email_attachments attachment
            JOIN email_messages message ON message.id = attachment.message_id
            WHERE message.thread_id = thread.id
          ), 0) AS attachment_bytes,
          COALESCE((
            SELECT jsonb_agg(attachment.stored_path ORDER BY attachment.id)
            FROM email_attachments attachment
            JOIN email_messages message ON message.id = attachment.message_id
            WHERE message.thread_id = thread.id
          ), '[]'::jsonb) AS attachment_paths,
          COALESCE((
            SELECT jsonb_agg(raw.id ORDER BY raw.id)
            FROM email_raw_messages raw
            JOIN email_messages message ON message.raw_message_id = raw.id
            WHERE message.thread_id = thread.id
          ), '[]'::jsonb) AS raw_message_ids,
          COALESCE((
            SELECT jsonb_agg(raw_file.stored_path ORDER BY raw_file.sort_id)
            FROM (
              SELECT raw.id * 2 AS sort_id, raw.stored_path
              FROM email_raw_messages raw
              JOIN email_messages message ON message.raw_message_id = raw.id
              WHERE message.thread_id = thread.id
              UNION ALL
              SELECT message.id * 2 + 1 AS sort_id, message.raw_eml_stored_path AS stored_path
              FROM email_messages message
              WHERE message.thread_id = thread.id
                AND message.raw_message_id IS NULL
                AND message.raw_eml_stored_path IS NOT NULL
            ) raw_file
          ), '[]'::jsonb) AS raw_message_paths,
          (
            SELECT count(*)
            FROM (
              SELECT raw.id
              FROM email_raw_messages raw
              JOIN email_messages message ON message.raw_message_id = raw.id
              WHERE message.thread_id = thread.id
              UNION ALL
              SELECT -message.id
              FROM email_messages message
              WHERE message.thread_id = thread.id
                AND message.raw_message_id IS NULL
                AND message.raw_eml_stored_path IS NOT NULL
            ) raw_file
          ) AS raw_message_count,
          COALESCE((
            SELECT sum(raw_file.file_size)
            FROM (
              SELECT raw.file_size
              FROM email_raw_messages raw
              JOIN email_messages message ON message.raw_message_id = raw.id
              WHERE message.thread_id = thread.id
              UNION ALL
              SELECT message.raw_eml_file_size AS file_size
              FROM email_messages message
              WHERE message.thread_id = thread.id
                AND message.raw_message_id IS NULL
                AND message.raw_eml_stored_path IS NOT NULL
            ) raw_file
          ), 0) AS raw_message_bytes,
          (SELECT count(*) FROM email_thread_triage_events event WHERE event.thread_id = thread.id) AS triage_event_count,
          (SELECT count(*) FROM email_thread_assignment_events event WHERE event.thread_id = thread.id) AS assignment_event_count
        FROM email_threads thread
        WHERE thread.id = $1
          AND ${emailPurgeBusinessEligibility}
        FOR UPDATE OF thread
      `, [input.threadId]);
      const candidate = mapEmailPurgeCandidate(candidateResult.rows[0]);
      if (!candidate) return null;

      await queryTarget.query(`SELECT set_config('bestcrm.email_purge', 'enabled', true)`);
      await queryTarget.query(`
        INSERT INTO email_purge_audits (
          thread_id,
          mailbox_key,
          subject_sha256,
          message_count,
          attachment_count,
          attachment_bytes,
          raw_message_count,
          raw_message_bytes,
          triage_event_count,
          assignment_event_count,
          triage_status,
          archive_disposition,
          last_message_at,
          purged_by,
          purge_reason
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        candidate.threadId,
        candidate.mailboxKey,
        input.subjectSha256,
        candidate.messageCount,
        candidate.attachmentCount,
        candidate.attachmentBytes,
        candidate.rawMessageCount,
        candidate.rawMessageBytes,
        candidate.triageEventCount,
        candidate.assignmentEventCount,
        candidate.triageStatus,
        candidate.archiveDisposition,
        candidate.lastMessageAt,
        input.actorUserId,
        input.reason
      ]);

      await queryTarget.query(`
        DELETE FROM email_attachment_scan_attempts
        WHERE attachment_id IN (
          SELECT attachment.id
          FROM email_attachments attachment
          JOIN email_messages message ON message.id = attachment.message_id
          WHERE message.thread_id = $1
        )
      `, [candidate.threadId]);
      await queryTarget.query(`
        DELETE FROM email_attachments
        WHERE message_id IN (SELECT id FROM email_messages WHERE thread_id = $1)
      `, [candidate.threadId]);
      await queryTarget.query(`
        DELETE FROM email_delivery_attempts
        WHERE message_id IN (SELECT id FROM email_messages WHERE thread_id = $1)
      `, [candidate.threadId]);
      await queryTarget.query(`
        DELETE FROM email_classification_events WHERE thread_id = $1
      `, [candidate.threadId]);
      await queryTarget.query(`
        DELETE FROM email_message_mailbox_deliveries
        WHERE message_id IN (SELECT id FROM email_messages WHERE thread_id = $1)
      `, [candidate.threadId]);
      await queryTarget.query(`DELETE FROM email_thread_assignment_events WHERE thread_id = $1`, [candidate.threadId]);
      await queryTarget.query(`DELETE FROM email_thread_triage_events WHERE thread_id = $1`, [candidate.threadId]);
      await queryTarget.query(`DELETE FROM email_messages WHERE thread_id = $1`, [candidate.threadId]);
      await queryTarget.query(`DELETE FROM email_threads WHERE id = $1`, [candidate.threadId]);
      if (candidate.rawMessageIds.length) {
        await queryTarget.query(`DELETE FROM email_raw_scan_attempts WHERE raw_message_id = ANY($1::bigint[])`, [candidate.rawMessageIds]);
        await queryTarget.query(`DELETE FROM email_raw_processing_attempts WHERE raw_message_id = ANY($1::bigint[])`, [candidate.rawMessageIds]);
        await queryTarget.query(`DELETE FROM email_raw_messages WHERE id = ANY($1::bigint[])`, [candidate.rawMessageIds]);
      }
      return candidate;
    },

    async createTriageEvent(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_thread_triage_events (
          thread_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          assigned_user_id,
          inquiry_id,
          opportunity_id,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        input.threadId,
        input.eventType,
        input.fromStatus,
        input.toStatus,
        input.actorUserId,
        input.assignedUserId || null,
        input.inquiryId || null,
        input.opportunityId || null,
        input.note || ''
      ]);
      return mapTriageEventRow(result.rows[0]);
    },

    async createInboundMessage(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_messages (
          thread_id,
          direction,
          message_id,
          in_reply_to,
          reference_ids,
          provider_mailbox,
          provider_uid_validity,
          provider_uid,
          raw_message_id,
          raw_eml_stored_path,
          raw_eml_file_size,
          raw_eml_sha256,
          imported_at,
          from_address,
          from_name,
          to_recipients,
          cc_recipients,
          subject,
          text_body,
          html_body,
          safe_headers,
          archive_disposition,
          classification_category,
          classification_reason,
          delivery_status,
          received_at
        )
        VALUES (
          $1, 'inbound', $2, $3, $4::jsonb, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20::jsonb,
          $21, $22, $23, 'received', $24
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `, [
        input.threadId,
        input.messageId || '',
        input.inReplyTo || '',
        JSON.stringify(input.referenceIds || []),
        input.providerMailbox || '',
        input.providerUidValidity || '',
        input.providerUid || null,
        input.rawMessageId || null,
        input.rawEmlStoredPath || null,
        input.rawEmlFileSize || null,
        input.rawEmlSha256 || null,
        input.importedAt || null,
        input.fromAddress,
        input.fromName || '',
        JSON.stringify(input.toRecipients || []),
        JSON.stringify(input.ccRecipients || []),
        input.subject || '',
        input.textBody || '',
        input.htmlBody || '',
        JSON.stringify(input.safeHeaders || {}),
        input.archiveDisposition || 'active',
        input.classificationCategory || 'inquiry',
        input.classificationReason || 'manual_review',
        input.receivedAt
      ]);
      return mapMessageRow(result.rows[0]);
    },

    async linkInboundMessageRawArchive(input) {
      const result = await queryTarget.query(`
        UPDATE email_messages
        SET
          raw_message_id = $2,
          raw_eml_stored_path = $3,
          raw_eml_file_size = $4,
          raw_eml_sha256 = $5,
          imported_at = COALESCE(imported_at, $6)
        WHERE id = $1
          AND direction = 'inbound'
          AND raw_message_id IS NULL
        RETURNING *
      `, [
        input.messageId,
        input.rawMessageId,
        input.rawEmlStoredPath,
        input.rawEmlFileSize,
        input.rawEmlSha256,
        input.importedAt
      ]);
      return mapMessageRow(result.rows[0]);
    },

    async createOutboundMessage(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_messages (
          thread_id,
          direction,
          message_id,
          in_reply_to,
          reference_ids,
          reply_to_message_id,
          quotation_package_version_id,
          from_address,
          from_name,
          to_recipients,
          cc_recipients,
          subject,
          text_body,
          html_body,
          safe_headers,
          delivery_status,
          authored_by
        )
        VALUES ($1, 'outbound', $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, '', $13::jsonb, $14, $15)
        RETURNING *
      `, [
        input.threadId,
        input.messageId,
        input.inReplyTo || '',
        JSON.stringify(input.referenceIds || []),
        input.replyToMessageId || null,
        input.quotationPackageVersionId || null,
        input.fromAddress,
        input.fromName,
        JSON.stringify(input.toRecipients || []),
        JSON.stringify(input.ccRecipients || []),
        input.subject || '',
        input.textBody || '',
        JSON.stringify(input.safeHeaders || {}),
        input.deliveryStatus,
        input.authoredBy
      ]);
      return mapMessageRow(result.rows[0]);
    },

    async createImportedOutboundMessage(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_messages (
          thread_id,
          direction,
          message_id,
          in_reply_to,
          reference_ids,
          provider_mailbox,
          provider_uid_validity,
          provider_uid,
          raw_message_id,
          raw_eml_stored_path,
          raw_eml_file_size,
          raw_eml_sha256,
          imported_at,
          from_address,
          from_name,
          to_recipients,
          cc_recipients,
          subject,
          text_body,
          html_body,
          safe_headers,
          archive_disposition,
          classification_category,
          classification_reason,
          delivery_status,
          provider_message_id,
          authored_by,
          sent_at
        )
        VALUES (
          $1, 'outbound', $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20::jsonb,
          'active', 'conversation', 'imported_sent_mail', 'sent', $21, $22, $23
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `, [
        input.threadId,
        input.messageId || '',
        input.inReplyTo || '',
        JSON.stringify(input.referenceIds || []),
        input.providerMailbox,
        input.providerUidValidity,
        input.providerUid,
        input.rawMessageId || null,
        input.rawEmlStoredPath || null,
        input.rawEmlFileSize || null,
        input.rawEmlSha256 || null,
        input.importedAt || null,
        input.fromAddress,
        input.fromName || '',
        JSON.stringify(input.toRecipients || []),
        JSON.stringify(input.ccRecipients || []),
        input.subject || '',
        input.textBody || '',
        input.htmlBody || '',
        JSON.stringify(input.safeHeaders || {}),
        input.providerMessageId || '',
        input.authoredBy || null,
        input.sentAt
      ]);
      return mapMessageRow(result.rows[0]);
    },

    async claimOutboundForSend(id) {
      const result = await queryTarget.query(`
        UPDATE email_messages
        SET delivery_status = 'pending', failure_code = '', failure_detail = ''
        WHERE id = $1
          AND direction = 'outbound'
          AND delivery_status IN ('draft', 'failed')
        RETURNING *
      `, [id]);
      return mapMessageRow(result.rows[0]);
    },

    async completeOutboundDelivery(input) {
      const result = await queryTarget.query(`
        UPDATE email_messages
        SET
          delivery_status = $2,
          provider_message_id = $3,
          failure_code = $4,
          failure_detail = $5,
          sent_at = CASE WHEN $2 = 'sent' THEN $6 ELSE sent_at END
        WHERE id = $1
          AND direction = 'outbound'
          AND delivery_status = 'pending'
        RETURNING *
      `, [
        input.messageId,
        input.status,
        input.providerMessageId || '',
        input.failureCode || '',
        input.failureDetail || '',
        input.sentAt || null
      ]);
      return mapMessageRow(result.rows[0]);
    },

    async createAttachment(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_attachments (
          message_id,
          source_index,
          original_name,
          stored_path,
          mime_type,
          file_size,
          sha256,
          content_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (message_id, source_index) DO NOTHING
        RETURNING *
      `, [
        input.messageId,
        input.sourceIndex,
        input.originalName,
        input.storedPath,
        input.mimeType || 'application/octet-stream',
        input.fileSize,
        input.sha256,
        input.contentId || ''
      ]);
      return mapAttachmentRow(result.rows[0]);
    },

    async findAttachmentById(id) {
      const result = await queryTarget.query(`
        SELECT attachment.*
        FROM email_attachments attachment
        WHERE attachment.id = $1
        LIMIT 1
      `, [id]);
      return mapAttachmentRow(result.rows[0]);
    },

    async listAttachmentsByMessage(messageId) {
      const result = await queryTarget.query(`
        SELECT attachment.*
        FROM email_attachments attachment
        WHERE attachment.message_id = $1
        ORDER BY attachment.source_index, attachment.id
      `, [messageId]);
      return result.rows.map(mapAttachmentRow);
    },

    async touchThread(id, lastMessageAt) {
      const result = await queryTarget.query(`
        UPDATE email_threads
        SET last_message_at = GREATEST(last_message_at, $2), updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [id, lastMessageAt]);
      return mapThreadRow(result.rows[0]);
    },

    async createDeliveryAttempt(input) {
      const result = await queryTarget.query(`
        WITH next_attempt AS (
          SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
          FROM email_delivery_attempts
          WHERE message_id = $1
        )
        INSERT INTO email_delivery_attempts (
          message_id,
          attempt_number,
          attempted_by,
          status,
          provider_message_id,
          safe_error
        )
        SELECT $1, next_attempt.attempt_number, $2, $3, $4, $5
        FROM next_attempt
        RETURNING *
      `, [
        input.messageId,
        input.attemptedBy || null,
        input.status,
        input.providerMessageId || '',
        input.safeError || ''
      ]);
      return mapDeliveryAttemptRow(result.rows[0]);
    },

    async initializeImapSyncState(input) {
      const result = await queryTarget.query(`
        INSERT INTO email_imap_sync_states (
          mailbox_key,
          mailbox_name,
          uid_validity,
          incremental_last_uid,
          backfill_before_uid,
          raw_backfill_before_uid
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (mailbox_key, mailbox_name)
        DO UPDATE SET
          uid_validity = EXCLUDED.uid_validity,
          incremental_last_uid = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN EXCLUDED.incremental_last_uid
            ELSE email_imap_sync_states.incremental_last_uid
          END,
          backfill_before_uid = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN EXCLUDED.backfill_before_uid
            ELSE email_imap_sync_states.backfill_before_uid
          END,
          backfill_complete = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN false
            ELSE email_imap_sync_states.backfill_complete
          END,
          raw_backfill_before_uid = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN EXCLUDED.raw_backfill_before_uid
            ELSE COALESCE(email_imap_sync_states.raw_backfill_before_uid, EXCLUDED.raw_backfill_before_uid)
          END,
          raw_backfill_complete = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN false
            ELSE email_imap_sync_states.raw_backfill_complete
          END,
          last_error_code = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN 'uid_validity_changed'
            ELSE email_imap_sync_states.last_error_code
          END,
          last_error_at = CASE
            WHEN email_imap_sync_states.uid_validity IS DISTINCT FROM EXCLUDED.uid_validity
              THEN now()
            ELSE email_imap_sync_states.last_error_at
          END,
          updated_at = now()
        RETURNING *
      `, [
        input.mailboxKey,
        input.mailboxName,
        input.uidValidity,
        input.incrementalLastUid || 0,
        input.backfillBeforeUid || null,
        input.rawBackfillBeforeUid || null
      ]);
      return mapImapSyncStateRow(result.rows[0]);
    },

    async updateImapIncrementalCheckpoint(input) {
      const result = await queryTarget.query(`
        UPDATE email_imap_sync_states
        SET
          incremental_last_uid = GREATEST(incremental_last_uid, $4),
          last_incremental_sync_at = now(),
          last_error_code = '',
          last_error_at = NULL,
          updated_at = now()
        WHERE mailbox_key = $1
          AND mailbox_name = $2
          AND uid_validity = $3
        RETURNING *
      `, [input.mailboxKey, input.mailboxName, input.uidValidity, input.uid]);
      return mapImapSyncStateRow(result.rows[0]);
    },

    async updateImapBackfillCheckpoint(input) {
      const result = await queryTarget.query(`
        UPDATE email_imap_sync_states
        SET
          backfill_before_uid = CASE
            WHEN $4::bigint IS NULL THEN backfill_before_uid
            WHEN backfill_before_uid IS NULL THEN $4
            ELSE LEAST(backfill_before_uid, $4)
          END,
          backfill_complete = $5,
          last_backfill_sync_at = now(),
          last_error_code = '',
          last_error_at = NULL,
          updated_at = now()
        WHERE mailbox_key = $1
          AND mailbox_name = $2
          AND uid_validity = $3
        RETURNING *
      `, [
        input.mailboxKey,
        input.mailboxName,
        input.uidValidity,
        input.beforeUid || null,
        Boolean(input.complete)
      ]);
      return mapImapSyncStateRow(result.rows[0]);
    },

    async updateImapRawBackfillCheckpoint(input) {
      const result = await queryTarget.query(`
        UPDATE email_imap_sync_states
        SET
          raw_backfill_before_uid = CASE
            WHEN $4::bigint IS NULL THEN raw_backfill_before_uid
            WHEN raw_backfill_before_uid IS NULL THEN $4
            ELSE LEAST(raw_backfill_before_uid, $4)
          END,
          raw_backfill_complete = $5,
          last_raw_backfill_sync_at = now(),
          last_error_code = '',
          last_error_at = NULL,
          updated_at = now()
        WHERE mailbox_key = $1
          AND mailbox_name = $2
          AND uid_validity = $3
        RETURNING *
      `, [
        input.mailboxKey,
        input.mailboxName,
        input.uidValidity,
        input.beforeUid || null,
        Boolean(input.complete)
      ]);
      return mapImapSyncStateRow(result.rows[0]);
    },

    async recordImapSyncError(input) {
      const result = await queryTarget.query(`
        UPDATE email_imap_sync_states
        SET last_error_code = $4, last_error_at = now(), updated_at = now()
        WHERE mailbox_key = $1
          AND mailbox_name = $2
          AND uid_validity = $3
        RETURNING *
      `, [input.mailboxKey, input.mailboxName, input.uidValidity, input.errorCode || 'sync_failed']);
      return mapImapSyncStateRow(result.rows[0]);
    }
  };
}
