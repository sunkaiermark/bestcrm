# BESTCRM Opportunity Record Guardrails Implementation Plan

- Date: 2026-09-07
- Status: Ready for local implementation after architecture checkpoint
- Parent design: `docs/superpowers/specs/2026-09-07-bestcrm-opportunity-record-system-design.md`
- Scope: Phase A guardrails only
- Production authorization: Not granted by this plan

## Goal

Prevent accidental or application-driven destruction of customer, contact, and
opportunity history before building the unified opportunity activity spine.

This phase does not redesign the UI, import new communication channels, move the
production database, or migrate files. It establishes durable identities,
archive semantics, and database-level no-delete protection on the current data.

## Required safety boundary

- Work from the verified current production source baseline plus approved local
  changes.
- Keep current unrelated and list-layout worktree changes unstaged.
- Use a new forward-only migration; never edit an applied migration.
- Test on the local database and then an isolated restored production backup.
- Do not run the migration or deploy code to production without a fresh backup,
  restore evidence, checksum evidence, and explicit production approval.
- Never deploy the local development database or preview data.

## Task 1: Characterize current deletion and archive behavior

Inspect and test:

- opportunity/customer/contact delete routes and role checks
- repository `DELETE` statements
- all foreign keys referencing the three core record types
- list/detail queries and archived-record filters
- current workflow archive behaviour
- file deletion behaviour and stored-object references
- email/thread preservation triggers

Deliverables:

- executable preflight query reporting all affected constraints
- test fixtures covering records with email, files, workflow, technical,
  quotation, bid, sales-work, and participant history
- exact before-change row counts for every affected table

## Task 2: Add stable record identities and lifecycle metadata

Create a new provisional migration named
`047_opportunity_record_guardrails.sql` after confirming no newer migration has
claimed that number.

Add immutable `record_uid uuid` values with unique indexes to:

- `customers`
- `contacts`
- `opportunities`

Add lifecycle metadata where not already present:

- `archived_at`
- `archived_by`
- `archive_reason`
- `merged_into_id` for customers and contacts
- `updated_at` where required for consistent repository behaviour

Constraints:

- existing rows receive one stable UID during migration
- UIDs are `NOT NULL` after backfill
- merge targets cannot point to the same record
- merge chains and cycles are rejected by service and integrity tests
- historical records keep their original numeric IDs and links

## Task 3: Replace hard delete with archive/merge operations

Change repositories and services so:

- opportunity delete becomes opportunity archive
- customer delete becomes archive, or merge when resolving duplicates
- contact delete becomes archive, or merge when resolving duplicates
- users see Archive/Reopen/Merge wording rather than Delete for core records
- every archive, reopen, and merge requires actor and reason
- every operation appends a business event and audit record

Keep existing authorization at least as restrictive as today. Direct POST/API
access must enforce the same service-layer permissions as the UI.

## Task 4: Enforce database no-delete protection

After application archive behaviour is working locally:

- replace opportunity-history `ON DELETE CASCADE` and `ON DELETE SET NULL`
  relationships with `ON DELETE RESTRICT` where the retained business link must
  never disappear
- add database triggers rejecting deletion of opportunities, customers, and
  contacts
- ensure email archive, approved technical/quotation versions, workflow events,
  sales work, attachments, ownership history, and participant records remain
  linked after archive
- retain narrowly justified cascade behaviour only for non-business ephemeral
  children, documented individually

The migration must abort if unexpected constraint names, orphan rows, or
unclassified delete relationships are found.

## Task 5: Preserve query compatibility

Update list/read behaviour deliberately:

- normal lists exclude archived core records unless an Archive scope is chosen
- historical opportunity pages can still display archived customer/contact
  snapshots and links where permitted
- archived opportunities retain their complete timeline and documents
- filters remain permission-scoped
- API and HTML reads use the same archive semantics

Do not hide records merely because a linked user has been deactivated.

## Task 6: Automated verification

Required tests:

- migration applies to a current-schema database with realistic linked records
- stable UIDs are populated and unique
- direct SQL delete of a protected customer/contact/opportunity fails
- application archive/reopen succeeds and records actor/reason
- cascade-loss regression test proves all linked row counts remain unchanged
- email/thread links remain present
- attachments and file manifests remain present
- workflow, technical, quotation, bid, sales-work, and member history remains
  queryable
- current role/visibility tests remain green
- all existing full-suite tests pass

Required integrity report after migration:

- row counts by affected table
- orphan check results
- foreign-key delete-action inventory
- duplicate/missing UID checks
- archive/reopen event counts
- file-manifest/object reconciliation status

## Task 7: Isolated restore rehearsal

Before production approval:

1. Create a production database and file backup using the approved backup tools.
2. Restore them into an isolated database and file location.
3. Apply the guardrail migration only to the restored copy.
4. Run the full test and integrity suite.
5. Sample at least one opportunity with email, file, workflow, and quotation data.
6. Verify that the restored current application and a simple read-only script
   can reconstruct the same history.
7. Record duration, checksums, row counts, and rollback steps.

## Task 8: Production gate

Stop and obtain explicit approval immediately before production deployment.

The production package must contain only committed source and the reviewed
forward migration. Deployment must use the existing backup, archive/hash,
atomic release, health-check, and rollback workflow. Verify service health,
database migration state, protected-route behaviour, core row counts, and sample
opportunity reconstruction after cutover.

## Phase A completion criteria

- No application path can hard-delete a customer, contact, or opportunity.
- The database itself rejects hard deletion of protected core records.
- Archiving does not remove or detach historical business data.
- Stable UIDs exist for future exports and application rewrites.
- Current CRM behaviour and permission tests remain green.
- An isolated full restore and sample opportunity reconstruction succeed.
- No production change occurs without the final approval gate.
