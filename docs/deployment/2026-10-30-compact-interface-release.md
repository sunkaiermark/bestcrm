# v2026.10.30-03-rc.1

Unify shared application interface text at 16px and regular weight, with compact table cells, controls and section spacing. Preserve document-frame typography and the established landscape desktop phone layout.

Remove the duplicate email-center heading. Fit the opportunity list to its container with eight single-line columns, omit the estimated-amount display column, and retain underlying amounts and permissions. Long names use ellipsis. Fit typical-term tables to the available width with single-line summaries and existing detail links.

Validation: 147 route/form/phone regression tests passed after updating the opportunity-list assertion for the approved eight columns. Seventy-two desktop/Android template checks passed for 16px text, page containment and absence of phone cards. Eight long-content checks passed across desktop, narrowed desktop, phone and folding-phone viewports for table containment and single-line cells. Hardware phone acceptance remains a user check.

Deploy from v2026.10.30-02-rc.1 only. Verify a full database/upload backup before switching releases. No dependency, migration, production environment, AI or Office configuration change. Do not prune backups automatically. Check public assets, health, active release, mail intake and preserved migration history after deployment.
