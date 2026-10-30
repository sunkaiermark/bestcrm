# v2026.10.30-04-rc.1

Active quotation engineers assigned as active supporting engineers to an opportunity may compose/send customer emails and send existing drafts without the legacy per-member external-email flag. Use the same existing supporting-engineer definition for the compose context, saved-draft button and send endpoint. Removed assignments, inactive users, unassigned engineers and unrelated membership roles do not acquire this permission. Existing administrator, designated-owner and explicit-grant behavior otherwise remains intact.

Validation: 47 customer-email service and route tests passed, including fake SMTP delivery of a saved draft, compose/send visibility, revoked membership, unrelated users/roles, inactive accounts, attachment release checks and duplicate-send protection. No real email was sent during testing.

The cumulative release includes the approved compact-interface changes. Deploy from v2026.10.30-02-rc.1 or v2026.10.30-03-rc.1 after checking the running version and health. Create and verify a full backup first. No dependency/migration or production configuration change; no automatic backup pruning. Post-deploy verify the central authorization function with synthetic users only, existing health, migrations, mail intake and Office/AI configuration.
