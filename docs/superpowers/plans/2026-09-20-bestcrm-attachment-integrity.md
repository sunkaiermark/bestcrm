# BESTCRM Legacy Attachment Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make legacy opportunity and inquiry attachments hash-verifiable, immutable, lifecycle-audited, safely purgeable when provisional, and provably recoverable from backup.

**Architecture:** Add transitional database constraints that protect every new write while allowing a guarded one-time hash backfill for legacy rows. Centralize file hashing, route opportunity deletion through retirement, route provisional inquiry cleanup through a durable database queue, and extend audit/backup tooling to verify the database-to-file relationship without storing file bodies in PostgreSQL.

**Tech Stack:** Node.js ESM, Express, PostgreSQL migrations/triggers, `node:test`, filesystem SHA-256 streaming, Bash backup tooling.

---

## Boundaries

- Work locally only. Do not connect to Singapore, run production migrations, restart services, push, or deploy.
- Do not modify `email_attachments`, raw inbound `.eml`, generated outbound MIME, or database-backed technical-document file formats except where backup verification reads their existing paths.
- Preserve the existing upload and delete authorization rules. Opportunity delete becomes retirement; it does not grant a new permission.
- Do not auto-delete or auto-repair audit findings.
- Keep `.playwright-cli/` and `tmp/` untouched and untracked.

## File map

**Create**

- `src/db/migrations/067_legacy_attachment_integrity.sql`: hashes, immutability, retirement/replacement, and append-only opportunity attachment events.
- `src/db/migrations/068_inquiry_attachment_purge_jobs.sql`: immutable purge audit plus durable retry jobs.
- `src/repositories/attachmentIntegrityRepository.mjs`: audit/backfill inventory and guarded purge transaction methods.
- `src/services/attachmentIntegrityService.mjs`: opportunity creation, retirement, and replacement orchestration.
- `src/services/inquiryAttachmentPurgeFileCleanupService.mjs`: idempotent verified file cleanup worker.
- `src/services/attachmentIntegrityAuditService.mjs`: read-only database/filesystem audit.
- `src/services/attachmentIntegrityBackfillService.mjs`: dry-run/apply historical digest backfill.
- `scripts/audit-attachment-integrity.mjs`: CLI wrapper for read-only audit.
- `scripts/backfill-attachment-integrity.mjs`: explicit dry-run/apply wrapper.
- `scripts/export-attachment-evidence-inventory.mjs`: verified JSONL inventory for backups.
- Focused tests matching each new repository/service/script.

**Modify**

- `src/services/attachmentFileService.mjs`: stream hashing and hash-returning store/copy helpers.
- `src/repositories/attachmentRepository.mjs`: hash fields, active/history queries, retirement, and source links.
- `src/repositories/inquiryAttachmentRepository.mjs`: hash fields for immutable inquiry attachment evidence.
- `src/repositories/quotationPackageRepository.mjs`: exclude retired files from new package source selection while preserving frozen package reads.
- `src/services/emailInquiryAttachmentService.mjs`: persist hashes and source linkage.
- `src/services/emailInquiryAttachmentCleanupService.mjs`: queue durable cleanup instead of deleting files inline.
- `src/services/inquiryService.mjs`: delete eligible inquiries through the durable purge transaction.
- `src/services/emailReimportResetExecutionService.mjs`: keep the existing separately confirmed reset compatible with the new guarded delete trigger.
- `src/routes/opportunityRoutes.mjs`: verified create and retirement behavior.
- `src/routes/leadSubmissionRoutes.mjs`: verified inquiry uploads.
- `src/server.mjs`: repository wiring and cleanup worker lifecycle.
- `scripts/backup-production.sh`, `scripts/verify-backup-artifacts.mjs`, `scripts/verify-email-raw-restore.mjs`: attachment evidence inventory and isolated restore verification.
- `scripts/cleanup-email-inquiry-attachments.mjs`: inject the durable purge repository.
- `scripts/verify-opportunity-record-guardrails.mjs`, `scripts/verify-opportunity-activity-spine.mjs`: include valid digests in database verification fixtures.
- `package.json`: local audit/backfill commands.
- Existing schema, repository, service, route, smoke, and release-candidate tests.

### Task 1: Add transitional database integrity and lifecycle constraints

**Files:**
- Create: `src/db/migrations/067_legacy_attachment_integrity.sql`
- Modify: `tests/db/schema.test.mjs`

- [x] **Step 1: Write the failing schema test**

Add `legacyAttachmentIntegrityMigrationPath` and assert the exact contract:

```js
test('legacy attachment integrity migration protects hashes and opportunity history', async () => {
  const sql = await readFile(legacyAttachmentIntegrityMigrationPath, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS sha256 char\(64\)/);
  assert.match(sql, /attachments_sha256_required[\s\S]*NOT VALID/);
  assert.match(sql, /inquiry_attachments_sha256_required[\s\S]*NOT VALID/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS opportunity_attachment_events/);
  assert.match(sql, /event_type IN \('created', 'legacy_hash_verified', 'retired', 'replaced'\)/);
  assert.match(sql, /Opportunity attachments cannot be deleted/);
  assert.match(sql, /Inquiry attachment identity is immutable/);
  assert.match(sql, /current_setting\('bestcrm\.attachment_hash_backfill', true\) = 'enabled'/);
  assert.match(sql, /current_setting\('bestcrm\.inquiry_attachment_purge', true\) = 'enabled'/);
  assert.match(sql, /Opportunity attachment events are append-only/);
});
```

- [x] **Step 2: Verify RED**

Run:

```powershell
node --test tests/db/schema.test.mjs
```

Expected: FAIL because migration 067 does not exist.

- [x] **Step 3: Create migration 067**

Implement these database-level rules:

```sql
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS sha256 char(64);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS source_inquiry_attachment_id bigint;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS retired_by bigint;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS retirement_reason text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS replaced_by_attachment_id bigint;

ALTER TABLE inquiry_attachments ADD COLUMN IF NOT EXISTS sha256 char(64);

ALTER TABLE attachments
  ADD CONSTRAINT attachments_sha256_required
  CHECK (sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$') NOT VALID;

ALTER TABLE inquiry_attachments
  ADD CONSTRAINT inquiry_attachments_sha256_required
  CHECK (sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$') NOT VALID;
```

Also add safe-relative-path and non-negative-size checks as `NOT VALID`, `ON DELETE RESTRICT`
foreign keys, lifecycle consistency checks, replacement validation, an append-only
`opportunity_attachment_events` table, and triggers with these precise transitions:

- reject every `attachments` delete;
- reject identity changes;
- permit `sha256: NULL -> verified digest` only with transaction-local
  `bestcrm.attachment_hash_backfill=enabled`;
- permit material-version binding only from `NULL` to one value;
- permit retirement fields only from all-null to a complete state;
- require a replacement to be active and in the same opportunity;
- reject inquiry attachment updates except guarded hash backfill;
- reject inquiry attachment deletes unless `bestcrm.inquiry_attachment_purge=enabled`;
- generate `created`, `legacy_hash_verified`, `retired`, and `replaced` events from triggers;
- reject all event updates/deletes.

- [x] **Step 4: Verify GREEN**

Run the schema test again. Expected: PASS.

- [x] **Step 5: Commit**

```powershell
git add src/db/migrations/067_legacy_attachment_integrity.sql tests/db/schema.test.mjs
git commit -m "feat: protect legacy attachment evidence"
```

### Task 2: Hash final stored bytes in one shared file service

**Files:**
- Modify: `src/services/attachmentFileService.mjs`
- Create: `tests/services/attachmentFileService.test.mjs`

- [x] **Step 1: Write failing helper tests**

Test healthy files, unsafe paths, missing paths, and store/copy return values:

```js
test('inspectStoredAttachmentFile returns final byte size and sha256', async () => {
  const content = Buffer.from('attachment-evidence');
  const stored = await storeAttachmentBuffer({ uploadDir, originalName: 'a.pdf', content });
  assert.equal(stored.fileSize, content.length);
  assert.equal(stored.sha256, createHash('sha256').update(content).digest('hex'));
  assert.deepEqual(await inspectStoredAttachmentFile({ uploadDir, storedPath: stored.storedPath }), {
    absolutePath: stored.absolutePath,
    fileSize: content.length,
    sha256: stored.sha256
  });
});
```

- [x] **Step 2: Verify RED**

Run `node --test tests/services/attachmentFileService.test.mjs`.
Expected: FAIL because `inspectStoredAttachmentFile` and returned hashes do not exist.

- [x] **Step 3: Implement streaming SHA-256**

Export:

```js
export async function inspectStoredAttachmentFile({ uploadDir, storedPath }) {
  const absolutePath = resolveStoredPath(uploadDir, storedPath);
  if (!absolutePath) throw attachmentFileError('invalid_stored_path');
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw attachmentFileError('not_a_file');
  return {
    absolutePath,
    fileSize: fileStat.size,
    sha256: await sha256File(absolutePath)
  };
}
```

Make `storeAttachmentBuffer` and `copyStoredAttachmentFile` return the digest of the actual final
file. Preserve existing return fields.

- [x] **Step 4: Verify GREEN and regressions**

```powershell
node --test tests/services/attachmentFileService.test.mjs tests/services/emailArchiveService.test.mjs tests/services/emailOutboundMimeService.test.mjs
```

Expected: zero failures.

- [x] **Step 5: Commit**

```powershell
git add src/services/attachmentFileService.mjs tests/services/attachmentFileService.test.mjs
git commit -m "feat: hash stored attachment bytes"
```

### Task 3: Persist hashes, active/history state, and source linkage

**Files:**
- Modify: `src/repositories/attachmentRepository.mjs`
- Modify: `src/repositories/inquiryAttachmentRepository.mjs`
- Modify: `src/repositories/quotationPackageRepository.mjs`
- Modify: `tests/repositories/attachmentRepository.test.mjs`
- Create: `tests/repositories/inquiryAttachmentRepository.test.mjs`
- Modify: `tests/repositories/quotationPackageRepository.test.mjs`
- Modify: `scripts/verify-opportunity-record-guardrails.mjs`
- Modify: `scripts/verify-opportunity-activity-spine.mjs`

- [x] **Step 1: Write failing repository tests**

Require `sha256` on insert, map lifecycle fields, filter normal lists, retain history, and perform
single-transition retirement:

```js
assert.match(createCall.sql, /sha256/);
assert.deepEqual(createCall.params.slice(-2), [sourceInquiryAttachmentId, sha256]);
assert.match(activeListCall.sql, /a\.retired_at IS NULL/);
assert.match(retireCall.sql, /WHERE id = \$1[\s\S]*retired_at IS NULL/);
assert.match(retireCall.sql, /RETURNING/);
```

For inquiry attachments, require `sha256` in insert/select/mapping.
For new quotation-package source selection, require `a.retired_at IS NULL`; frozen package detail
queries must continue reading a previously selected attachment after retirement. Update both
database verification scripts to insert a deterministic valid digest with attachment fixtures.

- [x] **Step 2: Verify RED**

Run the two repository test files. Expected: failures for missing fields/methods.

- [x] **Step 3: Implement repository APIs**

`attachmentRepository` must expose:

```js
createAttachment(input)
listByOpportunity(opportunityId)       // active only
listHistoryByOpportunity(opportunityId)
findById(id)
retireById({ id, actorUserId, reason, replacedByAttachmentId = null })
replaceAttachment({ originalAttachmentId, actorUserId, reason, replacement })
bindUnboundToMaterialVersion(input)
```

Remove `deleteById`. `replaceAttachment` uses one data-modifying CTE/SQL statement so insertion of
the replacement and retirement/linkage of the original commit or fail together. Map `sha256`,
source ID, retirement fields, and replacement ID.
`inquiryAttachmentRepository.createAttachment` accepts and persists `sha256`.

- [x] **Step 4: Verify GREEN**

Run both repository tests. Expected: zero failures.

- [x] **Step 5: Commit**

```powershell
git add src/repositories/attachmentRepository.mjs src/repositories/inquiryAttachmentRepository.mjs src/repositories/quotationPackageRepository.mjs tests/repositories/attachmentRepository.test.mjs tests/repositories/inquiryAttachmentRepository.test.mjs tests/repositories/quotationPackageRepository.test.mjs scripts/verify-opportunity-record-guardrails.mjs scripts/verify-opportunity-activity-spine.mjs
git commit -m "feat: persist attachment evidence identity"
```

### Task 4: Make every new attachment creation path hash-safe

**Files:**
- Create: `src/services/attachmentIntegrityService.mjs`
- Create: `tests/services/attachmentIntegrityService.test.mjs`
- Modify: `src/services/emailInquiryAttachmentService.mjs`
- Create: `tests/services/emailInquiryAttachmentService.test.mjs`
- Modify: `src/routes/leadSubmissionRoutes.mjs`
- Modify: `src/routes/opportunityRoutes.mjs`
- Modify: `tests/routes/leadSubmissionRoutes.test.mjs`
- Modify: `tests/routes/opportunityRoutes.test.mjs`

- [x] **Step 1: Write failing service and route tests**

Cover:

- direct opportunity upload persists the hash of disk bytes;
- failed database insert removes only the newly uploaded file;
- manual lead upload persists hash;
- email inquiry buffer storage persists returned hash;
- inquiry-to-opportunity copy persists the copied file hash and `sourceInquiryAttachmentId`;
- copied digest must equal the source digest when the source is already verified.

- [x] **Step 2: Verify RED**

Run the focused new/existing route and service tests. Expected: hash/source assertions fail.

- [x] **Step 3: Implement creation orchestration**

Export from `attachmentIntegrityService.mjs`:

```js
export async function persistUploadedOpportunityAttachment({
  attachmentRepository, uploadDir, file, opportunityId, category, actorUserId,
  sourceInquiryAttachmentId = null
})

export async function retireOpportunityAttachment({
  attachmentRepository, attachmentId, actorUserId, reason, replacedByAttachmentId = null
})
```

The creation function derives a safe relative path, inspects final bytes, passes size/hash to the
repository, and removes `file.path` only if the database insert fails. Update direct upload, manual
lead upload, email extraction, and copy code to pass verified digests.

- [x] **Step 4: Verify GREEN**

Run:

```powershell
node --test tests/services/attachmentIntegrityService.test.mjs tests/services/emailInquiryAttachmentService.test.mjs tests/routes/leadSubmissionRoutes.test.mjs tests/routes/opportunityRoutes.test.mjs
```

Expected: zero failures.

- [x] **Step 5: Commit**

```powershell
git add src/services/attachmentIntegrityService.mjs src/services/emailInquiryAttachmentService.mjs src/routes/leadSubmissionRoutes.mjs src/routes/opportunityRoutes.mjs tests/services/attachmentIntegrityService.test.mjs tests/services/emailInquiryAttachmentService.test.mjs tests/routes/leadSubmissionRoutes.test.mjs tests/routes/opportunityRoutes.test.mjs
git commit -m "feat: verify attachment writes"
```

### Task 5: Replace opportunity hard delete with retirement and test replacement atomicity

**Files:**
- Modify: `src/services/attachmentIntegrityService.mjs`
- Modify: `src/routes/opportunityRoutes.mjs`
- Modify: `tests/services/attachmentIntegrityService.test.mjs`
- Modify: `tests/routes/opportunityRoutes.test.mjs`

- [x] **Step 1: Write failing retirement tests**

Assert that the existing delete route calls `retireById`, leaves the file on disk, preserves current
permission checks, rejects repeated retirement, and removes the attachment from the active list.

Add a service-level replacement test that sends one verified replacement payload to the repository's
atomic `replaceAttachment` method and removes only the newly created file if that database statement
fails.

- [x] **Step 2: Verify RED**

Run the two focused test files. Expected: existing hard-delete behavior fails the new assertions.

- [x] **Step 3: Implement retirement/replacement**

The route keeps its URL for compatibility but changes the call:

```js
await retireOpportunityAttachment({
  attachmentRepository,
  attachmentId: attachment.id,
  actorUserId: req.currentUser.id,
  reason: String(req.body.reason || 'removed_from_active_view')
});
```

Do not call `rm` for retirement. Implement the replacement service API without adding a new UI
button in this slice.

- [x] **Step 4: Verify GREEN**

Run the focused tests. Expected: zero failures.

- [x] **Step 5: Commit**

```powershell
git add src/services/attachmentIntegrityService.mjs src/routes/opportunityRoutes.mjs tests/services/attachmentIntegrityService.test.mjs tests/routes/opportunityRoutes.test.mjs
git commit -m "feat: retain opportunity attachment history"
```

### Task 6: Add durable guarded purge for provisional inquiry attachments

**Files:**
- Create: `src/db/migrations/068_inquiry_attachment_purge_jobs.sql`
- Modify: `tests/db/schema.test.mjs`
- Create: `src/repositories/attachmentIntegrityRepository.mjs`
- Create: `tests/repositories/attachmentIntegrityRepository.test.mjs`
- Create: `src/services/inquiryAttachmentPurgeFileCleanupService.mjs`
- Create: `tests/services/inquiryAttachmentPurgeFileCleanupService.test.mjs`
- Modify: `src/services/inquiryService.mjs`
- Modify: `src/services/emailInquiryAttachmentCleanupService.mjs`
- Modify: `src/services/emailReimportResetExecutionService.mjs`
- Modify: `scripts/cleanup-email-inquiry-attachments.mjs`
- Modify: `tests/services/inquiryService.test.mjs`
- Modify: `tests/services/emailInquiryAttachmentCleanupService.test.mjs`
- Modify: `tests/services/emailReimportResetExecutionService.test.mjs`
- Modify: `tests/routes/inquiryRoutes.test.mjs`

- [x] **Step 1: Write failing migration tests**

Require immutable `inquiry_attachment_purge_audits`, append-only purge events, retryable cleanup
jobs with leases, safe relative paths, size/hash identity, and guarded mutation settings.

- [x] **Step 2: Verify RED and create migration 068**

Run schema tests, observe missing migration failure, then implement:

```sql
CREATE TABLE inquiry_attachment_purge_audits (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  inquiry_id_snapshot bigint NOT NULL CHECK (inquiry_id_snapshot > 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  attachment_count bigint NOT NULL CHECK (attachment_count >= 0),
  total_bytes bigint NOT NULL CHECK (total_bytes >= 0),
  identity_digest char(64) NOT NULL CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
  initiated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inquiry_attachment_purge_events (
  id bigserial PRIMARY KEY,
  purge_audit_id bigint NOT NULL REFERENCES inquiry_attachment_purge_audits(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('planned', 'completed', 'failed')),
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  detail_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inquiry_attachment_purge_file_jobs (
  id bigserial PRIMARY KEY,
  purge_audit_id bigint NOT NULL REFERENCES inquiry_attachment_purge_audits(id) ON DELETE RESTRICT,
  stored_path text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size >= 0),
  expected_sha256 char(64) NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purge_audit_id, stored_path)
);
```

The permanent audit stores operation UUID, reason, inquiry snapshot ID, counts, total bytes, and one
aggregate identity digest. It stores no filename or file content. Events are append-only. Job
identity is immutable; lease/status fields and successful job deletion require
`bestcrm.inquiry_attachment_file_cleanup=enabled`.

- [x] **Step 3: Write failing repository/service tests**

Cover atomic planning, converted/business rejection, guarded cascade deletion, worker retry after a
simulated crash, already-missing idempotence, wrong-size/hash fail-closed behavior, and permanent
audit retention after successful job removal.

- [x] **Step 4: Verify RED**

Run repository, purge worker, inquiry service, and cleanup service tests. Expected: missing APIs and
old inline deletion behavior fail.

- [x] **Step 5: Implement guarded purge transaction and worker**

Repository APIs:

```js
planInquiryAttachmentPurge({ inquiryId, actorUserId, reason, deleteInquiry })
claimInquiryAttachmentPurgeJobs({ workerId, limit, leaseSeconds })
completeInquiryAttachmentPurgeJob({ jobId, workerId })
failInquiryAttachmentPurgeJob({ jobId, workerId, errorCode, errorDetail, retryDelaySeconds })
countInquiryAttachmentPurgeJobs({ purgeAuditIds = [] })
```

`planInquiryAttachmentPurge` runs in one transaction, locks the inquiry, rejects converted or
business-linked records, inserts audit/jobs, enables the transaction-local delete guard, and deletes
the intended attachment rows/inquiry. The worker verifies path, size, and hash before deletion and
uses leases/retries like the existing email purge worker.

- [x] **Step 6: Replace inline deletion callers**

`deleteInquiry` and archived/spam attachment cleanup enqueue jobs; they no longer remove files in
the request or script process. Update the cleanup CLI to construct/inject the repository.

The separately confirmed email reimport-reset workflow keeps its existing quarantine/rollback
design and enables `bestcrm.inquiry_attachment_purge` only inside its serializable deletion
transaction. Add a regression assertion for that guard; do not route reset files into the ordinary
worker or weaken its dedicated confirmation/backup requirements.

- [x] **Step 7: Verify GREEN**

Run all focused purge/inquiry tests. Expected: zero failures.

- [x] **Step 8: Commit**

```powershell
git add src/db/migrations/068_inquiry_attachment_purge_jobs.sql src/repositories/attachmentIntegrityRepository.mjs src/services/inquiryAttachmentPurgeFileCleanupService.mjs src/services/inquiryService.mjs src/services/emailInquiryAttachmentCleanupService.mjs src/services/emailReimportResetExecutionService.mjs scripts/cleanup-email-inquiry-attachments.mjs tests/db/schema.test.mjs tests/repositories/attachmentIntegrityRepository.test.mjs tests/services/inquiryAttachmentPurgeFileCleanupService.test.mjs tests/services/inquiryService.test.mjs tests/services/emailInquiryAttachmentCleanupService.test.mjs tests/services/emailReimportResetExecutionService.test.mjs tests/routes/inquiryRoutes.test.mjs
git commit -m "feat: durably purge provisional attachments"
```

### Task 7: Wire the cleanup loop without changing production enablement

**Files:**
- Modify: `src/server.mjs`
- Modify: `tests/smoke/server.test.mjs`
- Modify: `tests/services/releaseCandidateWorkflow.test.mjs`

- [x] **Step 1: Write failing wiring tests**

Assert the app starts exactly one attachment cleanup loop when a pool is available, supports an
injected disabled option for tests, and does not start it without a database.

- [x] **Step 2: Verify RED**

Run smoke/release tests. Expected: missing worker wiring assertions fail.

- [x] **Step 3: Wire repository and loop**

Instantiate `attachmentIntegrityRepository`, inject it into inquiry routes/services, start
`startInquiryAttachmentPurgeFileCleanupLoop`, store the handle in `app.locals`, and preserve test
dependency injection.

- [x] **Step 4: Verify GREEN and commit**

```powershell
node --test tests/smoke/server.test.mjs tests/services/releaseCandidateWorkflow.test.mjs
git add src/server.mjs tests/smoke/server.test.mjs tests/services/releaseCandidateWorkflow.test.mjs
git commit -m "feat: run attachment cleanup worker"
```

### Task 8: Add read-only audit and guarded historical backfill

**Files:**
- Create: `src/services/attachmentIntegrityAuditService.mjs`
- Create: `src/services/attachmentIntegrityBackfillService.mjs`
- Create: `scripts/audit-attachment-integrity.mjs`
- Create: `scripts/backfill-attachment-integrity.mjs`
- Create: `tests/services/attachmentIntegrityAuditService.test.mjs`
- Create: `tests/services/attachmentIntegrityBackfillService.test.mjs`
- Modify: `src/repositories/attachmentIntegrityRepository.mjs`
- Modify: `package.json`

- [x] **Step 1: Write failing audit tests**

Use temporary directories and fake rows to cover healthy, unverified, missing, unsafe, non-file,
wrong-size, wrong-hash, duplicate-path, lifecycle error, and restricted orphan-candidate cases.

- [x] **Step 2: Verify RED and implement audit**

The result shape is stable JSON:

```js
{
  ok,
  totals: { records, bytes, verified, unverified },
  issues: [{ model, id, storedPath, reason }],
  orphanCandidates: [{ storedPath, size }]
}
```

No audit code calls an update/delete repository method.

- [x] **Step 3: Write failing backfill tests**

Cover dry-run default, healthy apply, unsafe/missing/size mismatch refusal, row identity changed
between read and lock, bounded batches, and idempotent rerun.

- [x] **Step 4: Verify RED and implement backfill**

Export:

```js
backfillLegacyAttachmentHashes({ repository, uploadDir, apply = false, batchSize = 100 })
```

Apply mode enables only `bestcrm.attachment_hash_backfill` inside each row/batch transaction. It
does not validate the final historical `NOT NULL` constraint.

- [x] **Step 5: Add CLI commands and verify GREEN**

```json
"attachment:integrity:audit": "node scripts/audit-attachment-integrity.mjs",
"attachment:integrity:backfill": "node scripts/backfill-attachment-integrity.mjs"
```

Run focused audit/backfill tests. Expected: zero failures.

- [x] **Step 6: Commit**

```powershell
git add src/services/attachmentIntegrityAuditService.mjs src/services/attachmentIntegrityBackfillService.mjs src/repositories/attachmentIntegrityRepository.mjs scripts/audit-attachment-integrity.mjs scripts/backfill-attachment-integrity.mjs tests/services/attachmentIntegrityAuditService.test.mjs tests/services/attachmentIntegrityBackfillService.test.mjs package.json
git commit -m "feat: audit legacy attachment integrity"
```

### Task 9: Verify attachment evidence in backups and isolated restores

**Files:**
- Create: `scripts/export-attachment-evidence-inventory.mjs`
- Create: `tests/scripts/attachmentEvidenceInventory.test.mjs`
- Modify: `scripts/backup-production.sh`
- Modify: `scripts/verify-backup-artifacts.mjs`
- Modify: `scripts/verify-email-raw-restore.mjs`
- Modify: `tests/scripts/backupArtifacts.test.mjs`

- [x] **Step 1: Write failing inventory and backup tests**

Require sorted JSONL rows containing model, record ID, path, size, SHA-256, and lifecycle state.
Reject duplicate/unsafe paths, unverified rows when strict mode is requested, archive omissions,
wrong restored size, and wrong restored hash.

- [x] **Step 2: Verify RED**

Run both script test files. Expected: missing inventory exporter/parser failures.

- [x] **Step 3: Implement exporter and backup integration**

The backup script runs the exporter after `pg_dump` while writes remain paused, writes
`attachment-evidence-files.jsonl`, records its checksum/count/bytes/unverified count in
`manifest.txt`, and includes the file in backup verification.

`verifyBackupArtifacts` preserves backward compatibility for older backups without this inventory;
new backups containing its manifest checksum must verify every listed archived/restored file.

- [x] **Step 4: Verify GREEN and shell syntax**

```powershell
node --test tests/scripts/attachmentEvidenceInventory.test.mjs tests/scripts/backupArtifacts.test.mjs
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/backup-production.sh scripts/rollback-production.sh
```

Expected: zero test failures and Bash exit code 0.

- [x] **Step 5: Commit**

```powershell
git add scripts/export-attachment-evidence-inventory.mjs scripts/backup-production.sh scripts/verify-backup-artifacts.mjs scripts/verify-email-raw-restore.mjs tests/scripts/attachmentEvidenceInventory.test.mjs tests/scripts/backupArtifacts.test.mjs
git commit -m "feat: verify attachment backup evidence"
```

### Task 10: Local acceptance gate

**Files:**
- Modify only if a test exposes a scoped defect; every defect requires a failing regression test first.

- [ ] **Step 1: Run focused attachment suite**

```powershell
node --test --test-concurrency=1 tests/db/schema.test.mjs tests/repositories/attachmentRepository.test.mjs tests/repositories/inquiryAttachmentRepository.test.mjs tests/repositories/attachmentIntegrityRepository.test.mjs tests/services/attachmentFileService.test.mjs tests/services/attachmentIntegrityService.test.mjs tests/services/emailInquiryAttachmentService.test.mjs tests/services/inquiryAttachmentPurgeFileCleanupService.test.mjs tests/services/attachmentIntegrityAuditService.test.mjs tests/services/attachmentIntegrityBackfillService.test.mjs tests/services/inquiryService.test.mjs tests/services/emailInquiryAttachmentCleanupService.test.mjs tests/routes/leadSubmissionRoutes.test.mjs tests/routes/inquiryRoutes.test.mjs tests/routes/opportunityRoutes.test.mjs tests/scripts/attachmentEvidenceInventory.test.mjs tests/scripts/backupArtifacts.test.mjs tests/smoke/server.test.mjs tests/services/releaseCandidateWorkflow.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run syntax checks**

```powershell
node --check src/services/attachmentIntegrityService.mjs
node --check src/services/inquiryAttachmentPurgeFileCleanupService.mjs
node --check src/services/attachmentIntegrityAuditService.mjs
node --check src/services/attachmentIntegrityBackfillService.mjs
node --check scripts/export-attachment-evidence-inventory.mjs
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/backup-production.sh scripts/rollback-production.sh
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the complete suite sequentially**

```powershell
node --test --test-concurrency=1 --test-reporter=dot "tests/**/*.test.mjs"
```

Expected: zero failures.

- [ ] **Step 4: Inspect scope**

```powershell
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: only intended attachment-integrity files/commits; `.playwright-cli/` and `tmp/` remain
untracked and untouched.

- [ ] **Step 5: Stop and report**

Report exact test counts, commits, remaining transitional risks, and changed files. Do not push,
connect to Singapore, run production audit/backfill, migrate, restart services, or deploy.
