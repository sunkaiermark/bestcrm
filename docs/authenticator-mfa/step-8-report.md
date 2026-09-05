# BESTCRM Authenticator MFA V1 - Step 8 Local Acceptance

Date: 2026-09-05

Scope: isolated local worktree, isolated PostgreSQL, real browser, no Tencent Cloud access

Result: PASS

## Acceptance environment

- Branch: `codex/authenticator-mfa-v1`
- Application: `http://127.0.0.1:3308`
- Database: isolated PostgreSQL 16 on `127.0.0.1:55434`
- Migration state: 40 migration files applied; latest migration is `041_authenticator_mfa.sql`
- Test data: synthetic local account and credentials only
- Production credentials: not read, copied, generated, or packaged

## Browser acceptance

The flow was exercised with Playwright CLI against the real Express application,
PostgreSQL repositories, PostgreSQL session store, templates, cookies, and routes.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Login language switch | PASS | Chinese login changed immediately to English without a manual reload. |
| Required first enrollment | PASS | Password login redirected to the Authenticator enrollment page. |
| TOTP enrollment | PASS | QR/manual-key presentation accepted a current six-digit TOTP and activated the account. |
| Recovery-code handoff | PASS | Ten one-time codes were shown only on the no-store acknowledgement page. |
| Authenticated session | PASS | No application session existed before acknowledgement; acknowledgement opened the workbench. |
| Ten-day trust | PASS | Opt-in issued the `__Host-bestcrm.mfa_trust` cookie with HttpOnly, Secure, SameSite=Lax, root path, and fixed ten-day expiry. |
| Trust boundary | PASS | The trust cookie alone could not open the workbench; a fresh correct password was still required. |
| Trusted-device login | PASS | After the correct password, the same browser skipped only the TOTP challenge. |
| Revocation | PASS | “Forget current device” revoked the database record, cleared the browser cookie, and restored the TOTP challenge on the next password login. |
| Recovery login | PASS | One saved recovery code completed the challenge; database evidence shows one used and nine available codes. |
| Pending-flow language | PASS | An active TOTP challenge changed from Chinese to English and remained valid. |
| Logout | PASS | Logout removed the authenticated session and returned to the login page. |
| Feature off | PASS | With `LOGIN_TOTP_2FA_ENABLED=false`, the same active/required account used the unchanged password-only login path, while account security showed Authenticator as unavailable. |

Browser console result on the final clean run: 0 errors, 0 warnings.

## Defect found and corrected

The real-browser run reproduced the previously reported login-language problem:
the first redirect could render the cached language and change only after a reload.
The local correction now saves the language session before redirecting and marks
the login response `Cache-Control: no-store`. The immediate Chinese-to-English
switch passed after the correction.

## Security review

- Enrollment secrets appeared only on the no-store enrollment page.
- Plain recovery codes appeared only on the one-time no-store recovery page.
- Workbench, challenge, account-security, feature-off, and administrator-safe
  views did not expose the enrollment secret, encrypted columns, authentication
  tag, recovery codes, or trusted-device token hash.
- The PostgreSQL session table contained zero rows matching the local enrollment
  secret or secret-field markers.
- Database evidence confirmed encrypted enrollment material, no plaintext copy,
  one consumed recovery code, and the revoked trusted-device record.
- The release builder now fails if the deployment template enables Authenticator,
  changes the frozen ten-day period, or contains a TOTP encryption key or recovery
  pepper.

## Automated verification

- MFA/configuration/migration/repository/service/route/security suite: 172/172 passed.
- Focused language and release-safety suite: 43/43 passed.
- Full BESTCRM regression suite: 797/797 passed.

## Release candidate boundary

The local commit-only candidate is built as `v2026.09.05-03-rc.1`. The build
verifies repeatable ZIP output, LF-only deployment scripts, forbidden-path
exclusion, disabled email features, disabled Authenticator, fixed ten-day trust,
and absence of production MFA credentials. The ZIP, checksum, and manifest remain
under ignored `output/releases/` and are not uploaded in Step 8.

## Gate

Step 8 is locally accepted. No server upload, migration, environment change,
feature enablement, or production user enforcement is authorized until the user
explicitly approves Step 9 dark deployment.
