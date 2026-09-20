# BESTCRM Legacy Attachment Integrity Design

Status: approved approach, written design checkpoint pending user review
Date: 2026-09-20
Scope: local design and implementation only; no Singapore connection, migration, or deployment

## 1. Goal

Make legacy opportunity and inquiry attachment evidence reconstructable and auditable without
moving file bodies into PostgreSQL. PostgreSQL remains the authority for attachment identity,
business relationships, lifecycle, permissions, and audit history; the upload filesystem remains
the byte store and must be recoverable from a verified backup.

This design covers the legacy `attachments` and `inquiry_attachments` tables. It closes the
current gaps where those rows contain only a path and size, where opportunity attachments can be
hard-deleted without a replacement history, and where a database or filesystem failure can leave
one side deleted while the other side survives.

## 2. Confirmed principles

1. A business attachment is evidence, not a disposable UI upload.
2. A stored file is identified by its safe relative path, exact byte size, and SHA-256 digest.
3. Existing bytes are never silently overwritten. A replacement is a new attachment linked to
   the prior attachment.
4. Opportunity attachments are never hard-deleted. A permitted user may retire one from the
   active view, but the row, file identity, file, and lifecycle history remain.
5. Inquiry attachments are provisional until the inquiry is accepted or converted. They may be
   permanently purged only with an otherwise deletable, unconverted inquiry and only through the
   guarded purge workflow.
6. An inquiry attachment associated with a converted inquiry or other protected business history
   cannot enter the purge set.
7. Audit commands never repair, delete, rename, or overwrite files. They report facts only.
8. Historical rows are not declared verified merely because a migration ran. Each legacy file must
   be read and hashed before its digest becomes authoritative.
9. No production migration, historical backfill, service restart, or deployment belongs to this
   local phase.

## 3. Existing systems that remain unchanged

- `email_attachments` already records SHA-256 and is protected by an immutable database trigger.
- Raw inbound `.eml` and generated outbound MIME evidence retain their existing immutable models.
- Technical-document files stored as database content already have their own hash and version
  controls.
- The approved lead workflow, email-center folder semantics, SMTP behavior, and opportunity
  numbering are outside this slice.
- Antivirus and content-classification behavior are outside this slice.

## 4. Attachment classes and retention

### 4.1 Opportunity attachments

Rows in `attachments` are business records. After creation:

- path, size, digest, original name, MIME type, opportunity, category, and uploader are immutable;
- the existing one-time material-version binding remains allowed from `NULL` to one value;
- deleting from the active screen means retirement, not database or filesystem deletion;
- replacement creates another row and links the retired row to the new row;
- the replacement must belong to the same opportunity and cannot point to itself;
- a retired row remains downloadable to an authorized user through history/audit views, although
  adding a new history UI is not required in this slice.

### 4.2 Inquiry attachments

Rows in `inquiry_attachments` are immutable source evidence while the inquiry exists. They have no
in-place replacement operation.

- Email-origin attachments remain independently preserved by the canonical email archive.
- Conversion may create an opportunity-owned copy, but that copy records the source inquiry
  attachment and must have the same SHA-256 digest.
- Once the inquiry is converted or otherwise protected by a business relationship, its attachments
  cannot be purged.
- If an unconverted inquiry is legitimately deleted, its attachment rows and files may be purged
  only through the durable guarded process in section 8.

## 5. Transitional database model

The first migration is deliberately compatible with existing, not-yet-hashed rows. It enforces the
new rules on new writes while making historical verification an explicit second operation.

### 5.1 `attachments`

Add:

- `sha256 char(64)`;
- `source_inquiry_attachment_id bigint REFERENCES inquiry_attachments(id) ON DELETE RESTRICT`;
- `retired_at timestamptz`;
- `retired_by bigint REFERENCES users(id) ON DELETE RESTRICT`;
- `retirement_reason text`;
- `replaced_by_attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT`.

Add database checks and triggers that:

- require a lowercase 64-character SHA-256 for every new row;
- require a safe, non-empty relative `stored_path` and non-negative `file_size` for every new row;
- allow a legacy `sha256` to change only once from `NULL` to a verified digest through the explicit
  backfill transaction setting;
- prevent changes to file identity and business ownership after creation;
- preserve the existing single transition for `opportunity_material_version_id` from `NULL` to one
  material version;
- require `retired_at`, `retired_by`, and `retirement_reason` to be set together;
- validate that a replacement belongs to the same opportunity and is not the same row;
- reject every `DELETE` from `attachments`.

The historical SHA-256 check is created `NOT VALID`. PostgreSQL still enforces it for new and
updated rows, while pre-existing `NULL` rows remain explicitly unverified until the backfill gate.

### 5.2 Opportunity attachment lifecycle events

Create an append-only `opportunity_attachment_events` table with:

- attachment ID;
- event type: `created`, `legacy_hash_verified`, `retired`, or `replaced`;
- actor when applicable;
- related replacement attachment when applicable;
- reason and timestamp.

Updates and deletes are blocked. Creation, retirement, and replacement write the attachment row and
event in one database transaction.

### 5.3 `inquiry_attachments`

Add:

- `sha256 char(64)`;
- safe-path, non-negative-size, and new-write SHA-256 checks;
- immutable identity protection for inquiry ID, source index, path, size, digest, original name,
  MIME type, CID, and upload timestamp.

The trigger allows only the explicit `NULL`-to-digest legacy backfill transition. Direct deletion
is rejected unless a transaction-local guarded purge setting is enabled by the approved purge
service.

## 6. New upload and copy flow

Every code path that creates a legacy attachment follows the same order:

1. write bytes to a newly generated path under the configured upload root;
2. calculate byte size and SHA-256 from the final stored bytes;
3. insert the database row with path, size, and digest;
4. add the relevant lifecycle event in the same transaction when the owner is an opportunity;
5. if the database transaction fails, remove only the newly created file;
6. never overwrite a pre-existing path.

This applies to direct opportunity uploads, manual lead uploads, email-to-inquiry extraction, and
inquiry-to-opportunity copying. Copying verifies the resulting bytes instead of trusting metadata
from the source row.

## 7. Retirement and replacement

The existing opportunity attachment delete endpoint keeps its authorization rules but changes its
effect:

- lock the attachment row;
- reject a second retirement or conflicting concurrent replacement;
- set retirement fields and write the append-only event;
- leave the physical file untouched;
- omit retired rows from the normal active attachment list.

Replacement is a single transaction that creates the new verified attachment, retires the old
attachment, links both rows, and writes `created` and `replaced` events. A failed transaction removes
only the newly written replacement file and leaves the original active.

No current workflow is required to expose a replacement button during this slice. The underlying
database and service behavior must nevertheless be complete and testable before a later UI uses it.

## 8. Guarded inquiry-attachment purge

Deleting an eligible unconverted inquiry is the only ordinary path that may permanently remove its
provisional attachment records and files.

The operation uses a durable design rather than deleting files inside the web request:

1. lock and re-check the inquiry inside a database transaction;
2. reject converted inquiries and any inquiry with protected business/email relationships;
3. create a minimal immutable purge audit containing operation ID, reason, counts, total bytes, and
   a digest of the purged file identities, but no filename or file content;
4. create one durable cleanup job per file with path, expected size, and expected SHA-256;
5. enable the transaction-local purge guard and delete the eligible inquiry/attachment rows;
6. commit the database transaction;
7. let an idempotent worker verify and remove each exact file, retrying failures safely;
8. after successful removal, let only the guarded worker delete that completed job row; pending or
   failed jobs remain retryable, while the permanent audit retains counts, completion state, and the
   aggregate identity digest without retaining filenames or file content.

The same guarded path replaces the current archived/spam inquiry-attachment cleanup. A crash after
database commit leaves retryable jobs, not untracked files. A path, size, or hash mismatch is marked
failed and never causes deletion of a different file.

## 9. Read-only integrity audit

Add a local/administrative audit command that reads database rows and files and returns structured
JSON plus a non-zero exit status when integrity failures exist.

For `attachments` and `inquiry_attachments`, report:

- total rows and bytes;
- verified and legacy-unverified rows;
- unsafe or empty paths;
- missing paths and non-regular files;
- recorded-size versus actual-size mismatches;
- recorded-hash versus actual-hash mismatches;
- duplicate stored paths;
- invalid replacement links and retirement state;
- inquiry attachments incorrectly eligible for purge despite a protected business relationship.

Unreferenced-file detection is limited to upload path namespaces owned by these two legacy models
and compares against all known filesystem-backed email evidence paths. The command must label these
as `orphan_candidates`; it must not delete them or claim they are safe to delete.

## 10. Historical hash backfill

Backfill is separate from schema migration and defaults to dry-run.

For each row with `sha256 IS NULL`, the tool:

1. resolves the relative path beneath the configured upload root;
2. rejects unsafe, missing, or non-regular paths;
3. compares actual size with recorded size;
4. computes SHA-256;
5. in apply mode, locks the row and writes the digest only if identity fields still match;
6. records the legacy verification event for opportunity attachments;
7. commits in bounded batches and remains idempotent.

Any path or size anomaly is reported and left unchanged. The tool never guesses a replacement file,
changes a stored path, or accepts a mismatched size.

Only after a production copy has zero unresolved anomalies may a later, separately approved
migration validate the historical SHA-256 constraints and make the columns `NOT NULL`. That final
production constraint migration is not part of this local slice.

## 11. Backup and restoration

The upload archive already contains legacy files, but backup verification must also prove the
database-to-file relationship.

Extend the backup manifest with an attachment evidence inventory containing model, record ID,
relative path, size, and SHA-256 for:

- active and retired opportunity attachments;
- retained inquiry attachments;
- outstanding durable purge jobs needed for safe cleanup recovery.

Backup verification checks that every inventory entry is present in `uploads.tar.gz` with the exact
size and digest. Restore verification extracts into an isolated directory, checks the inventory,
and confirms database rows and lifecycle/purge state are readable. It never restores over the live
upload directory during local acceptance.

A backup made while legacy-unverified rows remain must state their count explicitly and cannot be
used as the final evidence for validating the historical `NOT NULL` constraint.

## 12. Error handling and concurrency

- File writes use unique paths and never overwrite.
- Database failures remove only files created by the failed request.
- Retirement/replacement locks the original row so only one concurrent action succeeds.
- Backfill locks each row and accepts only the expected pre-update identity.
- Purge locks the inquiry, re-evaluates eligibility, and persists retry jobs before returning.
- File cleanup is idempotent: an already absent file is successful only when the job identity still
  proves that it was the intended path; mismatched existing files fail closed.
- Audit and dry-run modes perform no writes.

## 13. Permissions and presentation

- Existing attachment upload and deletion permission checks remain authoritative.
- A permitted opportunity “delete” action becomes retirement; unauthorized users gain no new
  capability.
- Inquiry purge retains its existing administrator/business eligibility boundary.
- Normal lists hide retired opportunity attachments; no broad page redesign is included.
- Download and preview continue to use the existing access checks and safe path resolution.

## 14. Local acceptance criteria

1. Schema tests prove new-write hash requirements, identity immutability, no hard deletion of
   opportunity attachments, guarded inquiry deletion, lifecycle append-only behavior, and valid
   replacement relationships.
2. Every creation path computes SHA-256 from stored bytes and cleans up a newly created file after a
   failed database write.
3. Retirement leaves the database row and file intact and removes it only from active listings.
4. Replacement produces two immutable rows and an auditable link without overwriting bytes.
5. Converted/business inquiry attachments cannot be purged.
6. Eligible provisional attachment purge survives a simulated worker crash and resumes safely.
7. Audit tests cover healthy, missing, wrong-size, wrong-hash, unsafe-path, duplicate-path, and
   orphan-candidate cases using temporary directories.
8. Backup and isolated restore tests verify the legacy attachment inventory.
9. Focused tests, the complete sequential test suite, syntax checks, and `git diff --check` pass.
10. Only intended files are committed; `.playwright-cli/` and `tmp/` remain untouched.
11. No Singapore connection, migration, service restart, push, or deployment occurs.

## 15. Delivery gates

### Gate A: design checkpoint

Commit this design only. The user reviews the written design before implementation planning.

### Gate B: local implementation checkpoint

After review, create a TDD implementation plan, implement locally, run the acceptance criteria, and
commit the local changes. Stop and report; do not deploy.

### Gate C: future production preparation

Only after explicit approval: prove production/local baseline ancestry, run a production read-only
inventory, create and verify a frozen backup, rehearse an isolated restore, and decide how to handle
every legacy anomaly before any migration or deployment.
