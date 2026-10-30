# v2026.10.30-05-rc.1

Restore the missing Remove action on never-uploaded collaboration work packages for users already authorized to manage the engineering team. Show it only in editable technical/commercial preparation stages, for unarchived opportunities and packages with no latest version or historical versions. The confirmation form preserves CSRF and uses the existing soft-delete/audit endpoint. Technical and corresponding internal-cost rows share the renderer.

The form requests empty-only removal. Under the work-package lock, refuse removal if another user uploaded any version after the page was opened. Preserve existing rejection of submitted, accepted or referenced files and preserve physical files/history. No production business records are removed by deployment itself.

Validation covers manager-only visibility, archived/pending suppression, hidden history, POST/CSRF/confirmation fields, stale empty-only requests without mutation, transactional rollback, and the database lifecycle of empty soft deletion with submitted-file protection.

Deploy from v2026.10.30-04-rc.1 after service/space checks. Full verified backup before switching releases; no automatic pruning. No migration, dependency or production configuration change. Retain the team-engineer email permission fix and compact interface assets.
