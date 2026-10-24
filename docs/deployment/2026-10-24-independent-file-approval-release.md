# v2026.10.24-02-rc.1 — Independent work package file decisions

Each technical proposal and cost calculation file is now submitted and approved separately. Upload controls retain their existing position. Submitted files offer preview and download; reviewers see preview, download, approve and reject on one line. Reject expands a file-specific full-width opinion row, requiring save then confirmation. Returned files are revised offline and explicitly replaced on upload, preserving the original and its opinion.

The internal quotation display name is now 价格核算. Reviewer online editing/comments and work package online editing are disabled; existing review snapshots remain readable. Obsolete batch mutation requests return HTTP 409.

Migration 133 adds individual file decision metadata and copies each existing batch decision without altering its original version record. Commercial readiness still requires every active technical package and paired cost calculation to be approved. Existing approved version snapshots are retained when creating a new revision.

Validation: real PostgreSQL-compatible migration and repository regression, authenticated route/CSRF tests, technical/commercial stage gate tests, rejection interaction and output escaping tests. Deployment must verify current v2026.10.24-01-rc.1, create a complete verified backup, apply only migration 133, and preserve production, AI, Office and email configuration and permissions.

Rollback: stop business writes before reverting application code; do not run the old batch approval UI against mixed per-file decisions without a reviewed recovery plan. Migration 133 is additive; do not drop its metadata or remove historical attachments.
