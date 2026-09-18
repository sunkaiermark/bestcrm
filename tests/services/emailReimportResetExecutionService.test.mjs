import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  EMAIL_REIMPORT_RESET_CONFIRMATION,
  executeEmailReimportReset,
  stageEmailReimportResetFiles
} from '../../src/services/emailReimportResetExecutionService.mjs';

function fakePool(query) {
  return {
    async connect() {
      return { query, release() {} };
    }
  };
}

function planResult(hash) {
  return {
    plan: {
      delete: {
        attachmentScanAttemptIds: [],
        emailAttachmentIds: ['1'],
        deliveryAttemptIds: [],
        classificationEventIds: [],
        mailboxDeliveryIds: [],
        assignmentEventIds: [],
        triageEventIds: [],
        messageIds: ['2'],
        threadIds: ['3'],
        rawScanAttemptIds: [],
        rawProcessingAttemptIds: [],
        rawMessageIds: ['4'],
        inquiryAttachmentIds: [],
        inquiryApprovalIds: [],
        inquiryIds: ['5'],
        syncStateIds: ['6']
      }
    },
    audit: {
      planSha256: hash,
      inquiries: {
        retainedForOpportunityHistory: 2,
        deleteCandidates: 1,
        deleteCandidateAttachments: 0
      },
      emailCenter: {
        retainedOpportunityThreads: 2,
        deleteCandidateThreads: 1,
        deleteCandidateMessages: 1,
        deleteCandidateAttachments: 1,
        deleteCandidateRawMessages: 1,
        retainedMalwareMetadataEvents: 3
      },
      files: { deleteCandidateFiles: 0, deleteCandidateBytes: 0 }
    },
    fileValidation: { ok: true, files: [], errors: [] }
  };
}

test('email reset execution aborts before staging when the audited plan hash changes', async () => {
  const statements = [];
  let staged = false;
  const expectedHash = 'a'.repeat(64);
  const currentHash = 'b'.repeat(64);

  await assert.rejects(
    executeEmailReimportReset({
      pool: fakePool(async (sql) => {
        statements.push(String(sql));
        return { rows: [], rowCount: 0 };
      }),
      uploadDir: '/var/bestcrm/uploads',
      expectedPlanSha256: expectedHash,
      backupId: '20260918-120000',
      confirmation: EMAIL_REIMPORT_RESET_CONFIRMATION,
      executedBy: 'test',
      planBuilder: async () => planResult(currentHash),
      fileStager: async () => {
        staged = true;
      }
    }),
    (error) => error.code === 'PLAN_HASH_MISMATCH'
  );

  assert.equal(staged, false);
  assert.ok(statements.some((sql) => /^ROLLBACK$/i.test(sql)));
  assert.ok(statements.every((sql) => !/^\s*DELETE\s/i.test(sql)));
});

test('email reset execution deletes exact audited ids in dependency order and records the audit', async () => {
  const statements = [];
  const expectedHash = 'c'.repeat(64);
  const stagingEvents = [];
  const result = await executeEmailReimportReset({
    pool: fakePool(async (sql, params = []) => {
      const statement = String(sql);
      statements.push(statement);
      if (/^DELETE FROM/i.test(statement.trim())) {
        return { rows: [], rowCount: params[0].length };
      }
      return { rows: [], rowCount: 1 };
    }),
    uploadDir: '/var/bestcrm/uploads',
    expectedPlanSha256: expectedHash,
    backupId: '20260918-120000',
    confirmation: EMAIL_REIMPORT_RESET_CONFIRMATION,
    executedBy: 'test',
    planBuilder: async () => planResult(expectedHash),
    fileStager: async () => ({
      async markDatabaseCommitted() { stagingEvents.push('committed'); },
      async remove() { stagingEvents.push('removed'); },
      async restore() { stagingEvents.push('restored'); }
    })
  });

  const deletedTables = statements
    .filter((sql) => /^\s*DELETE FROM/i.test(sql))
    .map((sql) => sql.match(/DELETE FROM\s+([a-z_]+)/i)[1]);
  assert.deepEqual(deletedTables, [
    'email_attachments',
    'email_messages',
    'email_threads',
    'email_raw_messages',
    'inquiries',
    'email_imap_sync_states'
  ]);
  assert.ok(statements.some((sql) => /INSERT INTO email_reimport_reset_audits/i.test(sql)));
  assert.deepEqual(stagingEvents, ['committed', 'removed']);
  assert.equal(result.planSha256, expectedHash);
  assert.equal(result.quarantineCleanupPending, false);
});

test('email reset file quarantine restores before commit and removes after commit', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-reset-stage-'));
  const uploadDir = path.join(parent, 'uploads');
  const storedPath = 'email-archive/sample.txt';
  const sourcePath = path.join(uploadDir, 'email-archive', 'sample.txt');
  try {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, 'sample', 'utf8');
    const staged = await stageEmailReimportResetFiles({
      uploadDir,
      operationId: '11111111-1111-4111-8111-111111111111',
      planSha256: 'd'.repeat(64),
      files: [{ storedPath, expectedBytes: 6, absolutePath: sourcePath }]
    });
    await assert.rejects(access(sourcePath));
    await staged.restore();
    await access(sourcePath);

    const committed = await stageEmailReimportResetFiles({
      uploadDir,
      operationId: '22222222-2222-4222-8222-222222222222',
      planSha256: 'd'.repeat(64),
      files: [{ storedPath, expectedBytes: 6, absolutePath: sourcePath }]
    });
    await committed.markDatabaseCommitted();
    await committed.remove();
    await assert.rejects(access(sourcePath));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
