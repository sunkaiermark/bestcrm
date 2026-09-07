# BESTCRM Opportunity Activity Spine Implementation Plan

- Date: 2026-09-07
- Scope: Phase B only
- Status: Approved for local implementation by the user's `PHASE B` instruction

## Goal

Create a durable, append-only chronological index for every opportunity while
keeping the existing specialized CRM tables authoritative. Phase B must not
move or delete current records, change the current opportunity pages, enable a
mail provider, or deploy to production.

## Safety boundary

- Implement and verify locally first.
- Use additive migrations only.
- Preserve all existing specialized tables and current read paths.
- Create activity rows and typed links in the same database transaction as new
  specialized records by using database triggers.
- Backfill by bounded, idempotent batches that can be stopped and resumed.
- Do not store email bodies, file bytes, or secrets in activity snapshots.
- Do not implement meetings, channel adapters, the document vault, or the new
  timeline UI in this phase.

## Task 1: Add opportunity contact history

Create `opportunity_contacts` with stable relationship history, role, primary
state, validity dates, and contact identity snapshots. Backfill the current
primary contact for every opportunity. Enforce one current primary contact per
opportunity and protect historical rows from deletion.

## Task 2: Add activity catalogue and append-only spine

Create:

- `activity_types`
- `opportunity_activities`
- `opportunity_activity_links`
- `opportunity_activity_participants`

Seed the approved activity types: email, meeting, call, channel message, note,
task, file, workflow, approval, technical, quotation, contract, ownership, and
outcome. Use text-backed catalogue references rather than PostgreSQL enums.

Enforce:

- immutable activity identity, opportunity, type, occurrence time, source
  identity, and snapshot;
- append-only typed links and participants;
- exactly one specialized record per typed link;
- one primary activity link per specialized source record;
- unique external source identity;
- timeline, type, actor, contact participant, and source indexes.

## Task 3: Add idempotent source index functions

Create one database index function for each Phase B source:

- workflow events;
- opportunity-linked email messages;
- sales work plans and logs;
- opportunity attachments;
- technical solution versions;
- commercial quote versions and quotation package versions;
- contract approvals;
- owner transfers and member events;
- engineering contributions.

Each function creates the activity, typed primary link, and known internal user
or customer-contact participants using the same transaction. Repeated calls for
the same source record must return the same activity without duplication.

## Task 4: Dual-write new source records

Attach `AFTER INSERT` triggers to every covered specialized source table. Add an
email-thread opportunity-link trigger so messages received before inquiry
conversion are indexed when their thread becomes linked to an opportunity.

Phase B indexes the durable creation/version event of each source row. Existing
mutable record editing remains on its current path until the corresponding
specialized revision model is hardened in a later phase.

## Task 5: Bounded resumable backfill

Add a command-line backfill worker that:

- requires an explicit database URL;
- validates that migration 048 is present;
- processes one source and a bounded ID batch at a time;
- stores source high-water marks in `opportunity_activity_backfill_state`;
- can resume safely after interruption;
- reports scanned, indexed, skipped, and remaining counts;
- never updates or deletes source data.

## Task 6: Stable repository read contract

Add an activity repository that lists opportunity activities using the existing
server-side opportunity visibility check. The repository returns stable IDs,
catalogue labels, participants, typed source identities, and snapshots without
requiring the current UI to switch read paths.

## Task 7: Automated verification

Add static schema tests plus an isolated PostgreSQL integration test proving:

- every covered source creates exactly one primary activity;
- repeat indexing and repeat backfill do not duplicate records;
- email received before opportunity assignment is indexed after assignment;
- activities, links, and participants cannot be updated or deleted;
- typed links reject zero or multiple specialized source IDs;
- unrelated and unlinked records are not indexed;
- source counts, IDs, opportunity IDs, timestamps, and file/email hashes remain
  reconcilable.

Add a read-only audit command for any migrated database. It must compare every
covered eligible source row to its primary activity link and report missing,
duplicate, or mismatched records without changing data.

## Completion gate

Phase B is complete only when:

- migration and schema tests pass;
- isolated database integration covers every source type;
- backfill is resumable and idempotent;
- local audit reports no missing or duplicate primary links;
- current specialized-table tests remain passing;
- the exact staged Git snapshot passes the Phase B test set;
- no production action has occurred.

Production migration, a new timeline UI, meeting/channel tables, file-object
versioning, and recovery rehearsal require later phases and separate approval.
