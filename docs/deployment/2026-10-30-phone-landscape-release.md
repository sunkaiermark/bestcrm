# v2026.10.30-01-rc.1 — Desktop-style phone landscape and opportunity scrolling

Phone browsers initialize a consistent 1280px desktop workspace before rendering. Single-screen and folding phones retain the same sidebar, columns and table rows, without the old phone card/menu transformation. Pinch zoom remains enabled. Portrait prompts rotation; rotating does not reload or replace form nodes. Desktop browser layout and viewport metadata are unchanged.

Phone opportunity pages use the outer page for vertical scrolling. Long record lists lose their internal height cap and scroll containment; same-origin read-only email frames expand to content height including margins, padding and borders, avoiding tiny residual inner scroll ranges that consume gestures. Horizontal table scrolling remains available. Email isolation/CSP and foreign-origin/Office frames are unchanged.

Validation: 13 focused tests passed. Android simulations at 844x390 and 1100x650 produced identical 220px sidebar and 1060px content columns; portrait 390x844 showed the rotation prompt. Touch events over a mail frame moved the outer page while the frame offset stayed zero; unsaved work-package input survived rotation. Forty real-template desktop comparisons remained unchanged. Physical Honor-device acceptance remains required.

Deploy only from v2026.10.29-01-rc.1 with healthy CRM, email intake and Office, no write maintenance and enough space for a verified full backup. Preserve existing migration/dependency/deployment files and AI/Office configuration and permissions. No new migration, dependency or production configuration change. No backup pruning. Verify health, active release and new phone assets after cutover.
