# v2026.10.26-01-rc.1 — Read-only opportunity Excel preview

Opportunity XLSX previews now open the original workbook in the configured ONLYOFFICE document server instead of reconstructing it as an HTML table. This avoids the old table's minimum column widths, substituted fonts, lost number formats and omitted empty rows. Actual rendering still depends on the document server's supported workbook features and installed fonts.

The viewer is read-only and has no callback, editing session, save or approval operation. Original-file download remains available through CRM. An explicit simplified-table fallback remains available when the document server cannot load. Signed source URLs expire after one hour and recheck the current user's access and the original file hash on every retrieval. Existing Office secrets and configuration are reused without modification.

Scope: opportunity XLSX attachments. Other file formats and email attachment previews retain their existing paths. Mobile application layout changes are deferred to the next task.

Validation: 35 focused tests passed, including the original-byte delivery integration, authentication and revocation, signed-token checks, hash checks, viewer loading/error behavior, existing Office review/edit routes, public health and report timeout regression tests. The local interface preview is a labeled simulation; final visual acceptance must use production attachment 386 on opportunity 178 and the supplied test.xlsx after deployment.

The release includes the previously committed report timeout fix (5d09bf8), whose production deployment was not confirmed. Deployment accepts only v2026.10.24-02-rc.1 or v2026.10.24-03-rc.1 as the current release. No new migration, dependency, environment, Nginx or service configuration change is required. Historical migrations 124–133 and configuration checks are preserved. The deployment creates and verifies a full backup before switching the active release and does not delete existing backups.
