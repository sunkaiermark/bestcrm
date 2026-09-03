# BESTCRM Singapore Release Candidate Checklist

- Candidate version: `v2026.09.03-01-rc.1`
- Scope: Steps 1-10 of the approved bilingual inquiry, engineering, quotation,
  and email-center workflow
- Status: local release candidate only; not deployed
- Email activation: explicitly out of scope for this candidate

## 1. Hard environment boundary

The Nanjing address `175.27.225.156` and its historic paths must not be used for
this release. The user previously identified `43.134.52.251` as the Singapore
CRM address, but Step 11 must verify it live before any SSH, upload, migration,
or service action. `crm.sunkaier.com` DNS must also be verified independently.

Do not infer that Nanjing and Singapore use the same SSH user, service name,
application path, environment path, database, upload directory, or backup
directory. Record the verified Singapore values in the table before deployment:

| Item | Expected / proposed value | Step 11 evidence |
| --- | --- | --- |
| Public hostname | `crm.sunkaier.com` | Pending live DNS/TLS check |
| Public IP | `43.134.52.251` (user-provided) | Pending provider/host check |
| SSH user | `ubuntu` (user-provided earlier) | Pending successful login check |
| Application root | `/opt/bestcrm` proposed | Pending read-only inventory |
| Current release | Unknown | Pending `current-release.txt`/service inventory |
| Service name | `bestcrm` proposed | Pending `systemctl` inventory |
| Environment file | `/etc/bestcrm/bestcrm.env` proposed | Pending existence/permission check; never print secrets |
| Upload directory | `/var/bestcrm/uploads` proposed | Pending inventory and size check |
| Backup directory | `/var/backups/bestcrm` proposed | Pending free-space and retention check |
| PostgreSQL database | Unknown | Pending safe environment-value lookup |

Stop if any verified value points to the Nanjing host or if the active stack is
partial, unhealthy, or cannot be backed up.

## 2. Candidate artifact contract

Build only from the final Step 10 Git commit:

```powershell
npm.cmd run release:build -- --version v2026.09.03-01-rc.1 --ref v2026.09.03-01-rc.1
```

The builder performs two independent `git archive` operations and requires
identical SHA-256 output. It rejects `.env`, `.env.*` secrets, private keys,
`node_modules`, uploads, test/browser output, coverage, local archives, and
temporary Codex folders. The release directory contains:

```text
bestcrm-v2026.09.03-01-rc.1.zip
bestcrm-v2026.09.03-01-rc.1.zip.sha256
bestcrm-v2026.09.03-01-rc.1.zip.manifest.json
```

The manifest must identify the exact full commit, the latest migration
`034_customer_email_sending.sql`, and all three email flags as `false`.

## 3. Required local acceptance evidence

- Full Node test suite passes with no skipped or failed tests.
- The combined acceptance flow completes:
  sales lead -> protected inquiry -> manager conversion -> opportunity ->
  lead/supporting engineering collaboration -> technical approval -> commercial
  approval -> `QP-V1` -> archived CRM email -> `QP-V2` -> archived reply ->
  accepted `QP-V2`.
- Chinese and English browser pages render without console errors or warnings.
- Sales Manager can see protected inquiry mail; salesperson cannot access it.
- Supporting Engineer without per-opportunity external-mail permission can save
  a draft but cannot send.
- CSRF, upload-size, HTML escaping, attachment checksum, duplicate intake,
  concurrent version allocation, failed-delivery retry, and audit tests pass.
- Production dependency audit results are recorded with severity and dependency
  chain; no unreviewed critical/high finding is allowed.

## 4. Email flags for the dark deployment

Before starting the Singapore service, verify values without printing secrets:

```text
CRM_EMAIL_CENTER_ENABLED=false
EMAIL_INTAKE_ENABLED=false
CRM_EMAIL_SENDING_ENABLED=false
```

Do not enter or test NetEase authorization credentials in Step 11. Both inbound
polling and outbound SMTP remain disabled after the code and migrations deploy.

## 5. Backup gate before migration

The pre-deployment backup must contain:

```text
database.sql
uploads.tar.gz
bestcrm.env
manifest.txt
```

The updated backup script records byte counts and SHA-256 for the database dump,
upload archive, and environment copy. Copy the backup or an encrypted equivalent
off the Singapore instance before migration. Verify it before service shutdown:

```bash
node /opt/bestcrm/scripts/verify-backup-artifacts.mjs \
  --backup-dir /var/backups/bestcrm/<backup-id> \
  --restore-dir /var/tmp/bestcrm-restore-check/<backup-id>
```

This checks database/upload hashes, rejects unsafe Tar paths, and extracts the
upload archive into an isolated directory. It does not restore over live data.

## 6. Isolated PostgreSQL restore gate

The current Windows workstation has no `psql`, `pg_dump`, or running Docker
engine, so a real PostgreSQL restore is deliberately not claimed in Step 10.
Before migration in Step 11, restore `database.sql` into a newly created,
isolated scratch database on the Singapore host or another compatible PostgreSQL
host. Never use the live database as the restore target.

The restore evidence must show:

- plain SQL import exits successfully with `ON_ERROR_STOP=1`;
- the application migration ledger matches the backup;
- core customer, inquiry, opportunity, attachment, and workflow counts are
  nonzero or match the live pre-backup counts;
- email tables restore when present;
- restored attachment samples match the archive checksums;
- the scratch database and extracted test directory are removed only after the
  evidence is recorded and the exact paths are revalidated.

## 7. Migration and compatibility notes

The candidate introduces migrations `025`, `026`, `029` through `034`; gaps in
the numeric sequence are intentional. Step 11 must read the live migration ledger
and apply only missing migrations through the standard migration runner.

Most changes are additive, but migration `034` deliberately prevents a quotation
package from being marked sent without an archived outbound CRM email. Therefore:

- a code-only rollback to a pre-Step-9 application can still read most existing
  CRM records, but its old manual quotation-send action is not compatible with
  the new database guard;
- keep all email flags false during a code rollback;
- if quotation sending must be restored immediately, use the current candidate
  or an explicit forward fix rather than bypassing the database guard;
- full database/upload restore is destructive and loses post-backup data, so it
  requires the existing explicit full-rollback confirmation and verified hashes.

Legacy backups without checksums are refused by default. The override
`BESTCRM_ALLOW_LEGACY_BACKUP=yes` is only for a separately and manually verified
historic backup; it must never be set as a permanent environment value.

## 8. Step 11 stop/rollback conditions

Do not deploy if any of the following is true:

- hostname/IP/SSH/path/service evidence is ambiguous;
- the current service is unhealthy before deployment;
- database, uploads, environment, or current release cannot be backed up;
- backup hashes or isolated extraction fail;
- isolated PostgreSQL restore fails;
- release SHA-256 differs after upload;
- the package enables any email flag;
- migration inventory differs from the expected source history without review.

After a successful dark deployment, validate existing login, customers,
inquiries, opportunities, attachments, approvals, and health checks while email
remains disabled. Production email activation belongs only to Step 12 and needs a
separate explicit confirmation.
