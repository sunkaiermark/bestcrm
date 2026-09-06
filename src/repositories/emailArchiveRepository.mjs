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
  return {
    id: Number(row.id),
    mailboxKey: row.mailbox_key,
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
    contactName: text(row.contact_name),
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: Number(row.message_count || 0),
    lastDirection: text(row.last_direction),
    lastFromAddress: text(row.last_from_address),
    lastTextPreview: text(row.last_text_preview)
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
    fromAddress: text(row.from_address),
    fromName: text(row.from_name),
    toRecipients: jsonArray(row.to_recipients),
    ccRecipients: jsonArray(row.cc_recipients),
    subject: text(row.subject),
    textBody: text(row.text_body),
    htmlBody: text(row.html_body),
    safeHeaders: row.safe_headers || {},
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

const threadSelect = `
  SELECT
    thread.id,
    thread.mailbox_key,
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
    contact.name AS contact_name,
    thread.last_message_at,
    thread.created_at,
    thread.updated_at,
    COALESCE(summary.message_count, 0) AS message_count,
    last_message.direction AS last_direction,
    last_message.from_address AS last_from_address,
    left(last_message.text_body, 240) AS last_text_preview
  FROM email_threads thread
  LEFT JOIN inquiries inquiry ON inquiry.id = thread.inquiry_id
  LEFT JOIN opportunities opportunity ON opportunity.id = thread.opportunity_id
  LEFT JOIN customers customer ON customer.id = thread.customer_id
  LEFT JOIN contacts contact ON contact.id = thread.contact_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS message_count
    FROM email_messages message
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

    async listThreads() {
      const result = await queryTarget.query(`
        ${threadSelect}
        ORDER BY thread.last_message_at DESC, thread.id DESC
      `);
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
      const [messageResult, attachmentResult, attemptResult] = await Promise.all([
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
      return { ...thread, messages };
    },

    async findMessageById(id) {
      const result = await queryTarget.query(`
        ${messageSelect}
        WHERE message.id = $1
        LIMIT 1
      `, [id]);
      return mapMessageRow(result.rows[0]);
    },

    async findMessageIdentity({ messageId = '', providerMailbox = '', providerUidValidity = '', providerUid = null }) {
      const result = await queryTarget.query(`
        ${messageSelect}
        WHERE
          ($1 <> '' AND lower(message.message_id) = lower($1))
          OR (
            $2 <> ''
            AND message.provider_mailbox = $2
            AND message.provider_uid_validity = $3
            AND message.provider_uid = $4
          )
        ORDER BY message.id
        LIMIT 1
      `, [messageId, providerMailbox, providerUidValidity, providerUid]);
      return mapMessageRow(result.rows[0]);
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
          last_message_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        input.mailboxKey,
        input.subject || '',
        input.normalizedSubject || '',
        input.inquiryId || null,
        input.opportunityId || null,
        input.customerId || null,
        input.contactId || null,
        input.lastMessageAt
      ]);
      return mapThreadRow(result.rows[0]);
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
          from_address,
          from_name,
          to_recipients,
          cc_recipients,
          subject,
          text_body,
          html_body,
          safe_headers,
          delivery_status,
          received_at
        )
        VALUES ($1, 'inbound', $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15::jsonb, 'received', $16)
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
        input.fromAddress,
        input.fromName || '',
        JSON.stringify(input.toRecipients || []),
        JSON.stringify(input.ccRecipients || []),
        input.subject || '',
        input.textBody || '',
        input.htmlBody || '',
        JSON.stringify(input.safeHeaders || {}),
        input.receivedAt
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
    }
  };
}
