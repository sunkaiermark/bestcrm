# BESTCRM Authenticator MFA V1 Implementation Plan

- Frozen design: `docs/superpowers/specs/2026-09-05-bestcrm-authenticator-mfa-v1-design.md`
- Working branch: `codex/authenticator-mfa-v1`
- Working directory: `.codex-tmp/authenticator-mfa-v1`
- Production default: feature disabled until the explicit pilot gate

## Delivery Rules

- Complete one numbered step at a time and create a focused Git checkpoint.
- Run the targeted tests for the step and the relevant existing authentication
  regression tests before asking for the next approval.
- Do not read, guess, reset, or log user passwords, TOTP secrets, recovery codes,
  production encryption keys, or trusted-device tokens.
- Do not activate TOTP in production as part of a code deployment.
- Keep the existing SMS second-factor feature disabled.
- Preserve the existing HTTPS, Secure cookie, CSRF, lockout, session regeneration,
  RBAC, and login audit behavior.
- Any material deviation from the frozen design returns to a design approval gate.

## Step 0 - Freeze and Baseline

Deliverables:

- Mark the approved design as Frozen V1 and commit it independently.
- Create an isolated implementation branch and worktree.
- Inventory the existing authentication, session, account, administration, and
  migration integration points.
- Run the unchanged full automated test suite.
- Record that no dependency, schema, application, or production change occurred.

Approval gate: confirm Step 0 before beginning dependency or schema work.

## Step 1 - Configuration and Database Foundation

Files:

- `package.json`
- `package-lock.json`
- `src/config.mjs`
- `src/db/migrations/041_authenticator_mfa.sql`
- `src/repositories/mfaRepository.mjs`
- `tests/config.test.mjs`
- `tests/db/schema.test.mjs`
- `tests/repositories/mfaRepository.test.mjs`
- `docs/deployment/templates/bestcrm.env.example`

Work:

- Pin maintained TOTP and QR-generation dependencies in the lockfile.
- Add disabled-by-default TOTP configuration and strict production key checks.
- Add the three frozen MFA tables, constraints, indexes, expiry fields, and
  secret-safe repository mappings.
- Ensure ordinary repository reads never return encrypted secret columns unless
  the dedicated verification method explicitly requests them.

Approval gate: configuration and migration tests pass; no route or UI behavior
changes yet.

## Step 2 - Cryptographic Services

Files:

- `src/services/totpService.mjs`
- `src/services/mfaSecretEncryptionService.mjs`
- `src/services/mfaRecoveryCodeService.mjs`
- `src/services/trustedDeviceService.mjs`
- corresponding service tests

Work:

- Implement RFC 6238 enrollment and verification with the frozen tolerance.
- Encrypt TOTP secrets with AES-256-GCM and versioned key metadata.
- Generate ten recovery codes, store only keyed hashes, and consume atomically.
- Generate 256-bit trusted-device tokens and store only SHA-256 hashes.
- Test malformed data, key mismatch, expiry, replay, and one-time consumption.

Approval gate: service tests pass without routes, cookies, or production keys.

## Step 3 - Two-Stage Authentication Flow

Files:

- `src/routes/authRoutes.mjs`
- `src/server.mjs`
- `src/views/auth/verify-totp.ejs`
- `tests/routes/authRoutes.test.mjs`

Work:

- Refactor password success into a generic pending-authentication decision.
- Force enrollment when required but not active.
- Challenge active accounts unless a valid trusted-device token exists.
- Regenerate session ID and CSRF only after the second-factor decision succeeds.
- Reuse lockout and `invalid_second_factor` audit behavior.
- Keep feature-off password login and disabled SMS behavior unchanged.

Approval gate: route tests cover success, failure, expiry, lockout, token mismatch,
and feature-off compatibility.

## Step 4 - Enrollment and Recovery UI

Files:

- `src/routes/authRoutes.mjs`
- `src/views/auth/enroll-totp.ejs`
- `src/views/auth/recovery-codes.ejs`
- authentication route and rendering tests

Work:

- Show QR and manual key only during pending enrollment.
- Require one valid TOTP before activation.
- Show recovery codes once and require acknowledgement before completing login.
- Apply no-store cache headers and prevent secret values from reaching logs.
- Complete Chinese and English guidance.

Approval gate: browser-visible enrollment works locally with no active-secret
redisplay path.

## Step 5 - Trusted Device for 10 Fixed Days

Files:

- `src/routes/authRoutes.mjs`
- `src/middleware` trusted-device integration
- `src/views/auth/verify-totp.ejs`
- route, cookie, and repository tests

Work:

- Add the unchecked 10-day trust choice.
- Issue the dedicated Secure, HttpOnly, SameSite=Lax cookie only after a valid
  second factor.
- Keep expiry fixed at 864000 seconds and never extend it on use.
- Ignore invalid, expired, revoked, and user-mismatched tokens safely.

Approval gate: a trusted browser skips only TOTP after a fresh valid password.

## Step 6 - My Account Security

Files:

- `src/routes/accountRoutes.mjs`
- account security services and views
- account route tests

Work:

- Display enrollment state and trusted-device inventory.
- Support bind/rebind, recovery-code regeneration, current-device forget, one
  device revoke, and all-device revoke.
- Require the current password and active TOTP for high-risk self-service changes.
- Revoke sessions and trusted devices on password or MFA reset as frozen.

Approval gate: self-service operations pass CSRF, credential, and revocation tests.

## Step 7 - Administrator Controls

Files:

- `src/routes/systemRoutes.mjs`
- `src/services/systemUserService.mjs`
- system user list/form views
- system route and service tests

Work:

- Show Not enrolled, Pending, and Active status.
- Support per-user requirement, trusted-device revoke, and enrollment reset.
- Prevent secret visibility and administrator self-bypass.
- Revoke sessions/devices on reset, password reset, and deactivation.

Approval gate: administrator UI and direct URLs enforce existing RBAC.

## Step 8 - Integrated Local Acceptance

Work:

- Run configuration, migration, repository, service, route, security, and full
  regression suites.
- Run local browser tests for enrollment, 10-day trust, recovery, revocation,
  language switching, logout, and feature-off behavior.
- Review logs and rendered HTML for secret leakage.
- Build and verify the release archive without production credentials.

Approval gate: explicit approval is required before any server upload.

## Step 9 - Dark Deployment

Work:

- Create an immutable release tag and verified archive.
- Back up the Singapore database, uploads, environment file, and current release.
- Deploy migration and code with `LOGIN_TOTP_2FA_ENABLED=false`.
- Verify health, password login, permissions, attachment access, and feature-off
  behavior.

Approval gate: explicit approval is required before configuring keys or enabling a
pilot user.

## Step 10 - Administrator Pilot and Rollout

Work:

- Write production TOTP keys directly into the protected environment file without
  displaying them.
- Enable the feature globally but require it only for one administrator pilot.
- Verify enrollment, ordinary challenge, 10-day trust, recovery, revocation, and
  administrator reset end to end.
- Expand per-user enforcement only after explicit approval.
- Roll back by disabling the feature flag and restarting if any acceptance check
  fails.

Completion gate: production rollout scope and enforcement list are confirmed by
the user.
