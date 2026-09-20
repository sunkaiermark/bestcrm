import { createHash, randomUUID } from 'node:crypto';

function text(value) {
  return String(value || '').trim();
}

function positiveId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be a positive integer`);
    error.code = 'invalid_input';
    throw error;
  }
  return parsed;
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validSha256(value) {
  return /^[0-9a-f]{64}$/.test(text(value));
}

function safeRelativePath(value) {
  const storedPath = text(value);
  return Boolean(storedPath)
    && !storedPath.startsWith('/')
    && !storedPath.startsWith('\\')
    && !/^[A-Za-z]:/.test(storedPath)
    && !/(^|[\\/])\.\.([\\/]|$)/.test(storedPath)
    && !storedPath.includes('\0');
}

function identityDigest(rows) {
  const canonical = [...rows]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((row) => `${row.id}\0${row.stored_path}\0${row.file_size}\0${row.sha256}\n`)
    .join('');
  return createHash('sha256').update(canonical).digest('hex');
}

function mapPurgeFileJob(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    purgeAuditId: Number(row.purge_audit_id),
    storedPath: text(row.stored_path),
    expectedSize: Number(row.expected_size),
    expectedSha256: text(row.expected_sha256),
    status: text(row.status),
    attemptCount: Number(row.attempt_count || 0)
  };
}

async function withTransaction(pool, callback) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client !== pool && typeof client.release === 'function') client.release();
  }
}

export function createAttachmentIntegrityRepository(pool, options = {}) {
  const operationIdFactory = options.operationIdFactory || randomUUID;

  return {
    async planInquiryAttachmentPurge(input) {
      const inquiryId = positiveId(input.inquiryId, 'inquiryId');
      const actorUserId = positiveId(input.actorUserId, 'actorUserId');
      const reason = text(input.reason);
      if (!reason) throw repositoryError('invalid_input', 'Purge reason is required');
      const deleteInquiry = input.deleteInquiry === true;

      return withTransaction(pool, async (client) => {
        const inquiryResult = await client.query(`
          SELECT
            i.id,
            i.converted_opportunity_id,
            i.matched_customer_id,
            i.matched_contact_id,
            EXISTS (
              SELECT 1 FROM opportunities opportunity
              WHERE opportunity.origin_inquiry_id = i.id
            ) AS has_origin_opportunity,
            EXISTS (
              SELECT 1 FROM email_threads thread
              WHERE thread.inquiry_id = i.id
                AND (
                  thread.opportunity_id IS NOT NULL
                  OR thread.customer_id IS NOT NULL
                  OR thread.contact_id IS NOT NULL
                )
            ) AS has_business_email_thread,
            EXISTS (
              SELECT 1 FROM inquiry_customer_approvals approval
              WHERE approval.inquiry_id = i.id
            ) AS has_customer_approval
          FROM inquiries i
          WHERE i.id = $1
          FOR UPDATE OF i
        `, [inquiryId]);
        const inquiry = inquiryResult.rows[0];
        if (!inquiry) throw repositoryError('inquiry_not_found', 'Inquiry not found');
        if (
          inquiry.converted_opportunity_id !== null
          || inquiry.matched_customer_id !== null
          || inquiry.matched_contact_id !== null
          || inquiry.has_origin_opportunity === true
          || inquiry.has_business_email_thread === true
          || inquiry.has_customer_approval === true
        ) {
          throw repositoryError(
            'inquiry_attachment_purge_forbidden',
            'Inquiry is linked to protected business history'
          );
        }

        const attachmentResult = await client.query(`
          SELECT id, inquiry_id, stored_path, file_size, sha256
          FROM inquiry_attachments
          WHERE inquiry_id = $1
          ORDER BY id
          FOR UPDATE
        `, [inquiryId]);
        const attachments = attachmentResult.rows;
        for (const attachment of attachments) {
          if (!validSha256(attachment.sha256)) {
            throw repositoryError(
              'inquiry_attachment_unverified',
              'Inquiry attachment has no verified SHA-256 identity'
            );
          }
          if (!safeRelativePath(attachment.stored_path) || Number(attachment.file_size) < 0) {
            throw repositoryError(
              'inquiry_attachment_invalid_identity',
              'Inquiry attachment has an unsafe stored identity'
            );
          }
        }

        const operationId = operationIdFactory();
        const attachmentCount = attachments.length;
        const totalBytes = attachments.reduce((total, attachment) => total + Number(attachment.file_size), 0);
        const digest = identityDigest(attachments);
        const auditResult = await client.query(`
          INSERT INTO inquiry_attachment_purge_audits (
            operation_id,
            inquiry_id_snapshot,
            reason,
            attachment_count,
            total_bytes,
            identity_digest,
            initiated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `, [operationId, inquiryId, reason, attachmentCount, totalBytes, digest, actorUserId]);
        const purgeAuditId = Number(auditResult.rows[0].id);

        for (const attachment of attachments) {
          await client.query(`
            INSERT INTO inquiry_attachment_purge_file_jobs (
              purge_audit_id,
              stored_path,
              expected_size,
              expected_sha256
            )
            VALUES ($1, $2, $3, $4)
          `, [
            purgeAuditId,
            attachment.stored_path,
            Number(attachment.file_size),
            text(attachment.sha256)
          ]);
        }
        await client.query(`
          INSERT INTO inquiry_attachment_purge_events (
            purge_audit_id,
            event_type,
            actor_user_id,
            detail_code
          )
          VALUES ($1, 'planned', $2, $3)
        `, [purgeAuditId, actorUserId, deleteInquiry ? 'inquiry_delete' : 'attachment_cleanup']);

        await client.query(`SELECT set_config('bestcrm.inquiry_attachment_purge', 'enabled', true)`);
        const deletedAttachments = await client.query(`
          DELETE FROM inquiry_attachments
          WHERE inquiry_id = $1
        `, [inquiryId]);
        if (Number(deletedAttachments.rowCount || 0) !== attachmentCount) {
          throw repositoryError('inquiry_attachment_purge_conflict', 'Inquiry attachments changed during purge planning');
        }

        let inquiryDeleted = false;
        if (deleteInquiry) {
          const deletedInquiry = await client.query(`
            DELETE FROM inquiries
            WHERE id = $1
          `, [inquiryId]);
          if (Number(deletedInquiry.rowCount || 0) !== 1) {
            throw repositoryError('inquiry_not_found', 'Inquiry not found');
          }
          inquiryDeleted = true;
        }

        if (attachmentCount === 0) {
          await client.query(`
            INSERT INTO inquiry_attachment_purge_events (
              purge_audit_id,
              event_type,
              actor_user_id,
              detail_code
            )
            VALUES ($1, 'completed', $2, 'no_files')
          `, [purgeAuditId, actorUserId]);
        }

        return {
          purgeAuditId,
          operationId,
          inquiryId,
          attachmentCount,
          totalBytes,
          identityDigest: digest,
          fileJobCount: attachmentCount,
          inquiryDeleted
        };
      });
    },

    async claimInquiryAttachmentPurgeJobs(input = {}) {
      const limit = Math.max(1, Math.min(Number(input.limit) || 50, 200));
      const leaseSeconds = Math.max(30, Math.min(Number(input.leaseSeconds) || 300, 3600));
      const workerId = text(input.workerId);
      if (!workerId) throw repositoryError('invalid_input', 'workerId is required');
      const purgeAuditIds = Array.isArray(input.purgeAuditIds) && input.purgeAuditIds.length
        ? input.purgeAuditIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : null;
      const result = await pool.query(`
        WITH cleanup_setting AS MATERIALIZED (
          SELECT set_config('bestcrm.inquiry_attachment_file_cleanup', 'enabled', true)
        ), claimable AS (
          SELECT job.id
          FROM inquiry_attachment_purge_file_jobs job
          WHERE (
              (job.status IN ('pending', 'failed') AND job.available_at <= now())
              OR
              (job.status = 'processing' AND job.lease_expires_at <= now())
            )
            AND ($4::bigint[] IS NULL OR job.purge_audit_id = ANY($4::bigint[]))
          ORDER BY job.available_at, job.id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        )
        UPDATE inquiry_attachment_purge_file_jobs job
        SET
          status = 'processing',
          attempt_count = job.attempt_count + 1,
          lease_owner = $1,
          lease_expires_at = now() + ($3::integer * interval '1 second'),
          last_attempt_at = now(),
          updated_at = now()
        FROM claimable, cleanup_setting
        WHERE job.id = claimable.id
        RETURNING job.*
      `, [workerId, limit, leaseSeconds, purgeAuditIds]);
      return result.rows.map(mapPurgeFileJob);
    },

    async completeInquiryAttachmentPurgeJob(input) {
      const jobId = positiveId(input.jobId, 'jobId');
      const workerId = text(input.workerId);
      if (!workerId) throw repositoryError('invalid_input', 'workerId is required');
      return withTransaction(pool, async (client) => {
        await client.query(`SELECT set_config('bestcrm.inquiry_attachment_file_cleanup', 'enabled', true)`);
        const deleted = await client.query(`
          DELETE FROM inquiry_attachment_purge_file_jobs job
          WHERE job.id = $1
            AND job.status = 'processing'
            AND job.lease_owner = $2
          RETURNING job.purge_audit_id
        `, [jobId, workerId]);
        if (Number(deleted.rowCount || 0) !== 1) return false;
        const purgeAuditId = Number(deleted.rows[0].purge_audit_id);
        const remaining = await client.query(`
          SELECT count(*) AS count
          FROM inquiry_attachment_purge_file_jobs
          WHERE purge_audit_id = $1
        `, [purgeAuditId]);
        if (Number(remaining.rows[0]?.count || 0) === 0) {
          await client.query(`
            INSERT INTO inquiry_attachment_purge_events (
              purge_audit_id,
              event_type,
              detail_code
            )
            VALUES ($1, 'completed', 'all_files_removed')
          `, [purgeAuditId]);
        }
        return true;
      });
    },

    async failInquiryAttachmentPurgeJob(input) {
      const retryDelaySeconds = Math.max(30, Math.min(Number(input.retryDelaySeconds) || 60, 3600));
      const result = await pool.query(`
        WITH cleanup_setting AS MATERIALIZED (
          SELECT set_config('bestcrm.inquiry_attachment_file_cleanup', 'enabled', true)
        ), failed_job AS (
          UPDATE inquiry_attachment_purge_file_jobs job
          SET
            status = 'failed',
            available_at = now() + ($3::integer * interval '1 second'),
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error_code = left($4, 80),
            last_error_detail = left($5, 500),
            updated_at = now()
          FROM cleanup_setting
          WHERE job.id = $1
            AND job.status = 'processing'
            AND job.lease_owner = $2
          RETURNING job.id, job.purge_audit_id
        )
        INSERT INTO inquiry_attachment_purge_events (
          purge_audit_id,
          event_type,
          detail_code
        )
        SELECT purge_audit_id, 'failed', left($4, 80)
        FROM failed_job
        RETURNING id
      `, [
        positiveId(input.jobId, 'jobId'),
        text(input.workerId),
        retryDelaySeconds,
        text(input.errorCode),
        text(input.errorDetail)
      ]);
      return Number(result.rowCount || 0) === 1;
    },

    async countInquiryAttachmentPurgeJobs(input = {}) {
      const purgeAuditIds = Array.isArray(input.purgeAuditIds) && input.purgeAuditIds.length
        ? input.purgeAuditIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : null;
      const result = await pool.query(`
        SELECT count(*) AS count
        FROM inquiry_attachment_purge_file_jobs job
        WHERE $1::bigint[] IS NULL OR job.purge_audit_id = ANY($1::bigint[])
      `, [purgeAuditIds]);
      return Number(result.rows[0]?.count || 0);
    }
  };
}
