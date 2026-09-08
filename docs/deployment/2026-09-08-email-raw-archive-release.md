# Immutable email source archive release

Status: prepared locally; production deployment and mailbox backfill are not authorized by this document.

## Frozen architecture

- Email Center is the searchable business-mail library.
- Each accepted inbound message has one immutable `.eml` source object plus a database index and append-only scan/processing/classification evidence.
- Inquiries and Opportunities reference the Email Center record. They do not own a second copy of the original mail.
- High-confidence spam is scanned and classified, then discarded before any CRM raw/message/inquiry record is committed.
- Malware or scanner failure is fail-closed: no CRM record and no mailbox checkpoint advance.
- Attachments are scanned individually before storage. No attachment is sent to an external AI service by default.
- Historical `.eml` capture uses its own IMAP cursor. It must never reuse or reset the parsed-email cursor.
- Raw files and evidence rows are append-only. Operational cleanup must never delete them.

## Release safety defaults

The release archive must contain these defaults:

```text
EMAIL_RAW_ARCHIVE_ENABLED=false
EMAIL_RAW_MALWARE_SCAN_ENABLED=false
EMAIL_RAW_BACKFILL_ENABLED=false
```

Deploying the code and migrations therefore cannot start raw capture or historical backfill. Enabling incremental capture and enabling historical backfill are separate approval gates.

## Production sequence

### Gate 1 — read-only baseline

1. Confirm the active release, app symlink, service states, free disk, backup directory, and current migration boundary.
2. Run `scripts/preflight-email-raw-production.sh` from the candidate release in read-only mode.
3. Record the output. Do not continue if the production checkout differs from the confirmed active release.

### Gate 2 — scanner readiness

1. With separate approval, install and update the host-managed ClamAV daemon/client.
2. Keep all three raw-email flags false.
3. Run the preflight with `BESTCRM_REQUIRE_RAW_ACTIVATION_READY=yes` after migrations 049 and 050 exist. The service account must successfully scan the deployed `package.json` through `clamdscan`.
4. Do not store scanner output containing message content, sender addresses, subjects, or attachment names.

### Gate 3 — code and schema deployment, features still off

1. Verify the release ZIP SHA-256 and manifest.
2. Create and verify a production backup.
3. Deploy the exact commit-only release archive.
4. Confirm migrations `049_email_raw_archive_foundation.sql` and `050_email_raw_backfill_checkpoint.sql` are present in `schema_migrations`.
5. Confirm the main app is healthy and all raw-email flags remain false.

### Gate 4 — incremental raw capture

1. Stop the main and email-intake services for the configuration change.
2. Set `EMAIL_RAW_MALWARE_SCAN_ENABLED=true` and `EMAIL_RAW_ARCHIVE_ENABLED=true`; keep `EMAIL_RAW_BACKFILL_ENABLED=false`.
3. Start the main and email-intake services. Keep the historical backfill service inactive.
4. Send one controlled clean test message, then run `npm run email:raw:audit`.
5. Confirm one database raw index, one clean scan event, the matching `.eml` SHA-256, normal inquiry processing, and no mailbox checkpoint error.
6. Test one scanner failure in a controlled non-production fixture; never send live malware through the company mailbox.

### Gate 5 — backup and isolated restore rehearsal

When raw capture is enabled, `backup-production.sh` refuses an online backup. Stop the main, intake, and backfill services first so the database dump, upload archive, and raw inventory describe one frozen state.

1. Run the backup and keep its `database.sql`, `uploads.tar.gz`, `email-raw-files.sha256`, and `manifest.txt` together.
2. Run `npm run backup:verify -- --backup-dir <backup> --restore-dir <isolated-directory>`.
3. Restore `database.sql` into a separately named temporary PostgreSQL database.
4. Point `DATABASE_URL` only at that temporary database and run `npm run backup:verify:email-raw -- --backup-dir <backup> --restore-dir <second-isolated-directory>`.
5. Compare database raw indexes, clean scan evidence, file sizes, file SHA-256 values, and unexpected files. Preserve the rehearsal log.
6. Restart normal services only after the frozen backup has passed verification.

`--require-complete` is valid only after the historical backfill is complete and the audit reports zero inbound messages without raw evidence.

### Gate 6 — historical mailbox backfill (later approval)

1. Run `npm run email:raw:preview` first. It lists UID coverage only and does not fetch content or alter mailbox flags.
2. Review mailbox UID count, missing raw count, disk capacity, backup capacity, and estimated maintenance duration.
3. Obtain a separate approval.
4. Set `EMAIL_RAW_BACKFILL_ENABLED=true` only for the controlled backfill window and run small batches.
5. After every batch, run `npm run email:raw:audit`; review every `rawIdentityConflicts` entry as a provider UID/RFC Message-ID conflict requiring manual reconciliation, and pause on any missing file, hash mismatch, unindexed file, non-clean latest scan, or checkpoint error. A conflict is preserved as indexed raw evidence with a permanent processing outcome; it never replaces the existing message's immutable raw binding.
6. When complete, set `EMAIL_RAW_BACKFILL_ENABLED=false`, verify it is inactive, take a frozen backup, and perform an isolated restore rehearsal with `--require-complete`.
7. Only then prepare a later migration that makes `email_messages.raw_message_id` mandatory for inbound mail.

## Rollback

### Activation rollback without data loss

If incremental capture fails, stop intake, set `EMAIL_RAW_ARCHIVE_ENABLED=false` and `EMAIL_RAW_BACKFILL_ENABLED=false`, then restart the prior intake path. Do not delete raw files, raw indexes, scan events, or processing events already captured.

### Code-only rollback

Use `scripts/rollback-production.sh <previous-version>` to repoint the app to the previous immutable release. Migrations 049 and 050 are additive and may remain in place while the flags are false.

### Full data rollback

Use a full rollback only when both the exact backup ID and release version are approved. The rollback script requires database/upload checksums and, for new backups, the raw-email inventory checksum. `BESTCRM_ALLOW_LEGACY_BACKUP=yes` is reserved for manually verified backups created before the raw inventory existed.

A full rollback replaces the database and upload tree. Preserve the current failed state as a separate backup before restoring an older state whenever it is readable.

## Stop conditions

Stop immediately and leave backfill disabled if any of these occur:

- scanner unavailable, timeout, suspicious, malware, or error verdict;
- database row without its `.eml`, file without an index, size mismatch, or SHA-256 mismatch;
- backfill service active during backup;
- raw capture enabled while attempting an online backup;
- unexpected production release, migration boundary, service account, upload path, or mailbox UIDVALIDITY;
- insufficient disk space for both the source archive and at least one verified backup/restore rehearsal.
