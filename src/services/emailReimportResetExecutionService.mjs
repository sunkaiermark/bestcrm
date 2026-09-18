import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildEmailReimportResetPlan,
  EMAIL_REIMPORT_RESET_PLAN_SCHEMA_VERSION,
  EMAIL_REIMPORT_RESET_RETENTION_RULE_VERSION
} from './emailReimportResetAuditService.mjs';

export const EMAIL_REIMPORT_RESET_CONFIRMATION = 'DELETE_NON_OPPORTUNITY_EMAIL_AND_REIMPORT';

export class EmailReimportResetError extends Error {
  constructor(message, code = 'EMAIL_REIMPORT_RESET_FAILED') {
    super(message);
    this.name = 'EmailReimportResetError';
    this.code = code;
  }
}

function requiredText(value, name) {
  const text = String(value || '').trim();
  if (!text) throw new EmailReimportResetError(`${name} is required`, 'INVALID_INPUT');
  return text;
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeManifest(operationDir, manifest) {
  const manifestPath = path.join(operationDir, 'manifest.json');
  const temporaryPath = path.join(operationDir, '.manifest.tmp');
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w'
  });
  await rename(temporaryPath, manifestPath);
}

export async function stageEmailReimportResetFiles({
  uploadDir,
  operationId,
  planSha256,
  files
}) {
  const uploadRoot = path.resolve(requiredText(uploadDir, 'uploadDir'));
  const quarantineRoot = path.resolve(path.dirname(uploadRoot), 'email-reset-quarantine');
  const operationDir = path.resolve(quarantineRoot, requiredText(operationId, 'operationId'));
  if (!/^[0-9a-f-]{36}$/i.test(operationId) || !isPathWithin(quarantineRoot, operationDir)) {
    throw new EmailReimportResetError('operationId is unsafe', 'INVALID_INPUT');
  }
  await mkdir(quarantineRoot, { recursive: true });
  if (await exists(operationDir)) {
    throw new EmailReimportResetError(
      `Quarantine operation already exists: ${operationId}`,
      'QUARANTINE_OPERATION_EXISTS'
    );
  }
  await mkdir(operationDir);
  const fileRoot = path.join(operationDir, 'files');
  const moved = [];
  const manifest = {
    schemaVersion: 1,
    operationId,
    planSha256,
    uploadRoot,
    status: 'preparing',
    files: files.map((file) => ({ storedPath: file.storedPath, expectedBytes: file.expectedBytes }))
  };
  await writeManifest(operationDir, manifest);

  try {
    for (const file of files) {
      const sourcePath = path.resolve(file.absolutePath);
      if (!isPathWithin(uploadRoot, sourcePath)) {
        throw new EmailReimportResetError(
          `Refusing to stage a file outside the upload root: ${file.storedPath}`,
          'UNSAFE_FILE_PATH'
        );
      }
      const destinationPath = path.resolve(fileRoot, ...file.storedPath.split('/'));
      if (!isPathWithin(fileRoot, destinationPath)) {
        throw new EmailReimportResetError(
          `Refusing unsafe quarantine path: ${file.storedPath}`,
          'UNSAFE_FILE_PATH'
        );
      }
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await rename(sourcePath, destinationPath);
      moved.push({ sourcePath, destinationPath, storedPath: file.storedPath });
    }
    manifest.status = 'staged';
    await writeManifest(operationDir, manifest);
  } catch (error) {
    for (const file of [...moved].reverse()) {
      if (await exists(file.destinationPath)) {
        await mkdir(path.dirname(file.sourcePath), { recursive: true });
        await rename(file.destinationPath, file.sourcePath);
      }
    }
    if (!isPathWithin(quarantineRoot, operationDir)) {
      throw new EmailReimportResetError('Unsafe quarantine cleanup target', 'UNSAFE_QUARANTINE_PATH');
    }
    await rm(operationDir, { recursive: true, force: true });
    throw error;
  }

  return {
    operationDir,
    fileCount: moved.length,
    async markDatabaseCommitted() {
      manifest.status = 'database_committed';
      await writeManifest(operationDir, manifest);
    },
    async restore() {
      for (const file of [...moved].reverse()) {
        if (!(await exists(file.destinationPath))) continue;
        if (await exists(file.sourcePath)) {
          throw new EmailReimportResetError(
            `Cannot restore staged file because the source path exists: ${file.storedPath}`,
            'QUARANTINE_RESTORE_CONFLICT'
          );
        }
        await mkdir(path.dirname(file.sourcePath), { recursive: true });
        await rename(file.destinationPath, file.sourcePath);
      }
      if (!isPathWithin(quarantineRoot, operationDir)) {
        throw new EmailReimportResetError('Unsafe quarantine cleanup target', 'UNSAFE_QUARANTINE_PATH');
      }
      await rm(operationDir, { recursive: true, force: true });
    },
    async remove() {
      if (!isPathWithin(quarantineRoot, operationDir)) {
        throw new EmailReimportResetError('Unsafe quarantine cleanup target', 'UNSAFE_QUARANTINE_PATH');
      }
      await rm(operationDir, { recursive: true, force: true });
    }
  };
}

async function deleteExactIds(client, tableName, ids) {
  if (!ids.length) return 0;
  const result = await client.query(
    `DELETE FROM ${tableName} WHERE id = ANY($1::bigint[])`,
    [ids]
  );
  if (result.rowCount !== ids.length) {
    throw new EmailReimportResetError(
      `Deletion count mismatch for ${tableName}: expected ${ids.length}, deleted ${result.rowCount}`,
      'DELETE_COUNT_MISMATCH'
    );
  }
  return result.rowCount;
}

const deletionOrder = [
  ['email_attachment_scan_attempts', 'attachmentScanAttemptIds'],
  ['email_attachments', 'emailAttachmentIds'],
  ['email_delivery_attempts', 'deliveryAttemptIds'],
  ['email_classification_events', 'classificationEventIds'],
  ['email_message_mailbox_deliveries', 'mailboxDeliveryIds'],
  ['email_thread_assignment_events', 'assignmentEventIds'],
  ['email_thread_triage_events', 'triageEventIds'],
  ['email_messages', 'messageIds'],
  ['email_threads', 'threadIds'],
  ['email_raw_scan_attempts', 'rawScanAttemptIds'],
  ['email_raw_processing_attempts', 'rawProcessingAttemptIds'],
  ['email_raw_messages', 'rawMessageIds'],
  ['inquiry_attachments', 'inquiryAttachmentIds'],
  ['inquiry_customer_approvals', 'inquiryApprovalIds'],
  ['inquiries', 'inquiryIds'],
  ['email_imap_sync_states', 'syncStateIds']
];

const lockedTables = [
  'email_threads',
  'email_messages',
  'email_attachments',
  'email_delivery_attempts',
  'email_attachment_scan_attempts',
  'email_classification_events',
  'email_message_mailbox_deliveries',
  'email_thread_assignment_events',
  'email_thread_triage_events',
  'email_raw_messages',
  'email_raw_scan_attempts',
  'email_raw_processing_attempts',
  'email_imap_sync_states',
  'inquiries',
  'inquiry_attachments',
  'inquiry_customer_approvals',
  'opportunities',
  'opportunity_activity_links',
  'quotation_package_versions'
];

export async function executeEmailReimportReset({
  pool,
  uploadDir,
  expectedPlanSha256,
  backupId,
  confirmation,
  executedBy,
  operationId = randomUUID(),
  planBuilder = buildEmailReimportResetPlan,
  fileStager = stageEmailReimportResetFiles
}) {
  if (confirmation !== EMAIL_REIMPORT_RESET_CONFIRMATION) {
    throw new EmailReimportResetError('Dedicated confirmation token is missing', 'CONFIRMATION_REQUIRED');
  }
  const expectedHash = requiredText(expectedPlanSha256, 'expectedPlanSha256').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new EmailReimportResetError('expectedPlanSha256 must be a SHA-256 hex digest', 'INVALID_INPUT');
  }
  const verifiedBackupId = requiredText(backupId, 'backupId');
  const actor = requiredText(executedBy, 'executedBy');
  const client = await pool.connect();
  let staging = null;
  let committed = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await client.query(`LOCK TABLE ${lockedTables.join(', ')} IN SHARE ROW EXCLUSIVE MODE`);
    await client.query("SET LOCAL statement_timeout = '15min'");
    const result = await planBuilder(client, { uploadDir });
    if (result.audit.planSha256 !== expectedHash) {
      throw new EmailReimportResetError(
        `Plan hash changed: expected ${expectedHash}, current ${result.audit.planSha256}`,
        'PLAN_HASH_MISMATCH'
      );
    }
    if (!result.fileValidation.ok) {
      throw new EmailReimportResetError(
        `File validation failed for ${result.fileValidation.errors.length} file(s)`,
        'FILE_VALIDATION_FAILED'
      );
    }
    staging = await fileStager({
      uploadDir,
      operationId,
      planSha256: expectedHash,
      files: result.fileValidation.files
    });

    await client.query(`SELECT set_config('bestcrm.email_purge', 'enabled', true)`);
    const deletedCounts = {};
    for (const [tableName, key] of deletionOrder) {
      deletedCounts[key] = await deleteExactIds(client, tableName, result.plan.delete[key] || []);
    }
    await client.query(`
      INSERT INTO email_reimport_reset_audits (
        operation_id,
        plan_schema_version,
        plan_sha256,
        retention_rule_version,
        backup_id,
        retained_email_inquiries,
        deleted_email_inquiries,
        retained_threads,
        deleted_threads,
        deleted_messages,
        deleted_email_attachments,
        deleted_inquiry_attachments,
        deleted_raw_messages,
        deleted_files,
        deleted_file_bytes,
        reset_sync_states,
        retained_malware_metadata_events,
        executed_by,
        summary
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb
      )
    `, [
      operationId,
      EMAIL_REIMPORT_RESET_PLAN_SCHEMA_VERSION,
      expectedHash,
      EMAIL_REIMPORT_RESET_RETENTION_RULE_VERSION,
      verifiedBackupId,
      result.audit.inquiries.retainedForOpportunityHistory,
      result.audit.inquiries.deleteCandidates,
      result.audit.emailCenter.retainedOpportunityThreads,
      result.audit.emailCenter.deleteCandidateThreads,
      result.audit.emailCenter.deleteCandidateMessages,
      result.audit.emailCenter.deleteCandidateAttachments,
      result.audit.inquiries.deleteCandidateAttachments,
      result.audit.emailCenter.deleteCandidateRawMessages,
      result.audit.files.deleteCandidateFiles,
      result.audit.files.deleteCandidateBytes,
      result.plan.delete.syncStateIds.length,
      result.audit.emailCenter.retainedMalwareMetadataEvents,
      actor,
      JSON.stringify(result.audit)
    ]);
    await client.query('COMMIT');
    committed = true;
    await staging.markDatabaseCommitted();

    let quarantineCleanupPending = false;
    try {
      await staging.remove();
    } catch {
      quarantineCleanupPending = true;
    }
    return {
      operationId,
      planSha256: expectedHash,
      backupId: verifiedBackupId,
      deletedCounts,
      deletedFiles: result.audit.files.deleteCandidateFiles,
      deletedFileBytes: result.audit.files.deleteCandidateBytes,
      quarantineCleanupPending
    };
  } catch (error) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
      if (staging) {
        try {
          await staging.restore();
        } catch (restoreError) {
          error.restoreError = restoreError;
        }
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
