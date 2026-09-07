# BESTCRM Phase A+B Opportunity Foundation Release

- Candidate: `v2026.09.07-03-rc.2`
- Production target: `crm.sunkaier.com` / Singapore `43.134.52.251`
- Application root: `/opt/bestcrm`
- Previous production release: `v2026.09.07-02-rc.1`
- Latest candidate migration: `048_opportunity_activity_spine.sql`
- Approval: production deployment approved by the user after every gate below passes

## Scope boundary

This release contains the already accepted Inquiries responsive-list commit plus
the Phase A and Phase B opportunity-record foundation:

- `be11063` - responsive Inquiries layout, filters, by-page/all view, compact
  headings, date-only display, alignment, wrapping, and mobile behavior;
- `bf137f0` - stable record identities, archive/reopen behavior, delete
  guardrails, restrictive core foreign keys, and lifecycle audit events;
- `ff8a8ef` - opportunity contact history, append-only activity spine, typed
  source links, participants, database triggers, bounded backfill, and audits;
- release-preparation changes for the seven-day application-backup retention,
  read-only production preflight, and release-manifest test.

The release archive is built from a committed Git object. Uncommitted local
work on Opportunities, Customers, Contacts, the sidebar, and email polling is
excluded. No Phase C meeting/channel tables, Phase D document vault, Phase E
new timeline UI, or Phase F recovery proof is included.

## Verified production baseline

The read-only preflight on 2026-09-07 verified:

- hostname `VM-0-17-ubuntu` and public health HTTP 200;
- current release and symlink both resolve to `v2026.09.07-02-rc.1`;
- `bestcrm` and email intake are active; historical email backfill is inactive;
- root volume: 197 GiB total, 78 GiB used, 112 GiB available;
- memory: 3.6 GiB total, 2.6 GiB available; swap: 4.0 GiB total;
- PostgreSQL database `bestcrm`: 157,125,979 bytes;
- 45 applied migrations, latest `046_customer_contact_uniqueness.sql`;
- 101 customers, 87 contacts, 107 opportunities, and 8,160 inquiries;
- the exact 32-constraint Phase A foreign-key inventory matches;
- migrations 047 and 048 are not yet applied;
- 508 existing source rows are eligible for Phase B backfill: 230 workflow
  events, 1 email message, 231 attachments, 39 technical solutions, and 7 owner
  transfers; the other seven source types currently have zero eligible rows;
- uploads occupy 13,003,533,355 bytes and existing application backups occupy
  58,834,524,025 bytes;
- the production backup script defaults to seven-day retention and its checksum
  matches the local script.

The server has enough working space for the release, a fresh backup, and an
isolated restore rehearsal. Stop if available space falls below 45 GiB before
the final backup.

## Immutable artifact gate

Build only from the release-preparation commit:

```powershell
npm.cmd run release:build -- --version v2026.09.07-03-rc.2 --ref <commit>
```

The generated manifest is authoritative for the full commit and SHA-256. Before
upload and again on the server, verify the ZIP against its `.sha256` file. The
manifest must report:

- `reproducibleArchiveVerified: true`;
- latest migration `048_opportunity_activity_spine.sql`;
- all email feature defaults `false`;
- Authenticator MFA disabled with no production credentials;
- no `.env`, private key, upload, `node_modules`, output, or temporary files.

## Pre-deployment gates

1. Run the committed `scripts/preflight-phase-ab-production.sh` read-only and
   require `PREFLIGHT_RESULT=passed`.
2. Require the exact release ZIP test suite and both isolated PostgreSQL
   migration integrations to pass.
3. Upload the ZIP, manifest, and checksum without changing the active symlink.
4. Verify the uploaded ZIP SHA-256.
5. Pause the main service and incremental email-intake worker so the final
   database/upload backup represents one controlled cutover point.
6. Run `/opt/bestcrm/scripts/backup-production.sh`, record the backup ID, verify
   all recorded hashes, and inspect the upload archive without restoring over
   live data.
7. Restore the database dump into a new isolated scratch database, apply
   migrations 047 and 048 there, run both audits, backfill all 12 source types,
   rerun the activity audit, and compare the core/source counts above.
8. Remove the scratch database only after its evidence is recorded and its
   exact name is revalidated. Keep the verified backup.

Any mismatch stops the deployment and restarts the unchanged current release.

## Controlled deployment

Deploy only the checksum-verified candidate with the existing atomic release
script. Keep the email feature configuration unchanged. After migration:

1. run the Phase A guardrail audit;
2. backfill each of the 12 Phase B source types in batches of 250 until the next
   batch reports zero processed rows;
3. run the Phase B activity audit and require zero missing, duplicate, or
   mismatched primary links;
4. verify local and public health with retry after service start;
5. verify login, Inquiries in English and Chinese, Customers, Contacts,
   Opportunities, one opportunity detail, attachment access, and role denial;
6. restart and verify the incremental email-intake worker; keep the historical
   backfill worker inactive unless separately required;
7. record the deployed release, backup ID, migration ledger, audit output,
   service state, and public-health result.

## Rollback plan

### Code rollback

Use this when health or UI behavior fails but data remains intact:

```bash
sudo -n /opt/bestcrm/scripts/rollback-production.sh code v2026.09.07-02-rc.1
```

Migrations 047 and 048 are additive and remain installed. The previous code can
continue ordinary reads and writes, but its legacy hard-delete actions will be
rejected by the Phase A database guardrails. Do not bypass those guardrails.

### Full database/upload rollback

Use this only if migration or data integrity is damaged and code rollback is
insufficient. It restores the verified cutover backup and therefore discards
every post-backup database and upload change:

```bash
BESTCRM_CONFIRM_FULL_ROLLBACK=yes \
  sudo -n /opt/bestcrm/scripts/rollback-production.sh full \
  <verified-backup-id> v2026.09.07-02-rc.1
```

Before a full rollback, stop the main and email-intake services, record the
incident, reverify `database.sql`, `uploads.tar.gz`, and the manifest checksums,
and confirm the exact backup ID. After either rollback, verify service health,
public health, migration state, core counts, uploads, and email-intake status.

## Stop conditions

Do not deploy, or immediately enter the rollback decision, when any of these is
true:

- host, IP, application path, current release, or service identity differs;
- public or local health is not green before cutover;
- release or backup checksum differs;
- isolated restore, migration, backfill, or either audit fails;
- the Phase A foreign-key inventory differs;
- available disk is below 45 GiB;
- any unreviewed file enters the release archive;
- email or MFA feature flags would change;
- the previous release or verified backup cannot be used for rollback.
