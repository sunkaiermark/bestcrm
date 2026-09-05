# BESTCRM Authenticator MFA V1 Design

- Status: Frozen V1, approved by the user on 2026-09-05
- Date: 2026-09-05
- Scope: BESTCRM production login security
- Primary decision: Password + TOTP Authenticator + trusted device for 10 fixed days

## 1. Objective

BESTCRM will add account-level time-based one-time password authentication (TOTP)
without depending on SMS delivery, employee phone numbers, or an external identity
provider. A trusted browser may skip only the TOTP step for 10 days. The username
and password remain required for every new login session.

## 2. Frozen V1 Boundaries

V1 includes:

- Standard six-digit TOTP codes generated every 30 seconds.
- Compatibility with Microsoft Authenticator, Google Authenticator, 1Password,
  and other RFC 6238-compatible applications.
- Per-user enrollment and enforcement so rollout can be gradual.
- One-time recovery codes.
- A fixed 10-day trusted-device record and secure browser cookie.
- User self-service device review and revocation.
- Administrator enforcement and reset controls that never expose a TOTP secret.
- Reuse of the current password lockout, CSRF, session regeneration, RBAC, and
  login audit mechanisms.
- Bilingual Chinese and English login and account-security pages.

V1 does not include:

- SMS or email one-time codes.
- Push approval notifications.
- Passkeys or external single sign-on.
- Biometric data collection by BESTCRM.
- An administrator bypass code or the ability to view user secrets.

The existing SMS second-factor feature remains disabled during migration. Removing
its code is a separate later cleanup decision after TOTP production acceptance.

## 3. Security Decisions

### 3.1 TOTP profile

- Issuer: `BESTCRM`.
- Account label: the user's BESTCRM username.
- Six digits, 30-second period, RFC 6238-compatible algorithm.
- Verification accepts the current time step and at most one adjacent step for
  ordinary clock drift.
- Five failed codes end the pending login and feed the existing login lockout and
  audit controls.

### 3.2 Secret protection

TOTP verification requires the original shared secret, so it cannot be stored as
a one-way hash. BESTCRM will encrypt it with AES-256-GCM using a dedicated
production key supplied through `TOTP_ENCRYPTION_KEY`. The database stores only
ciphertext, nonce, authentication tag, and key version. The encryption key must
not be reused as the session secret and must never be displayed in the UI or logs.

The QR code and manual setup key are shown only during an unconfirmed enrollment.
After the first valid code is confirmed, the setup key cannot be displayed again.
Rebinding creates a new secret and invalidates the old one.

### 3.3 Recovery codes

- Ten random single-use recovery codes are generated after successful enrollment.
- They are shown once and may be downloaded or printed by the user.
- BESTCRM stores only keyed hashes using a separate
  `TOTP_RECOVERY_CODE_PEPPER`.
- Using one code marks it used atomically and creates a security audit event.
- Regenerating recovery codes immediately invalidates all previous unused codes.

## 4. Login and Enrollment Flows

### 4.1 Password login

1. The user submits the current username and password form.
2. BESTCRM applies the existing password failure and lockout policy.
3. A successful password does not yet create an authenticated application session
   when TOTP is required for the account.
4. If the user has not enrolled, BESTCRM starts forced enrollment.
5. If the user is enrolled, BESTCRM checks for a valid trusted-device token.
6. A valid trusted device skips the TOTP page; otherwise the user enters a TOTP or
   unused recovery code.
7. After the second-factor decision succeeds, BESTCRM regenerates the session ID
   and CSRF token, records the login result, and opens the workbench.

The pending-authentication session expires after five minutes and contains only
the minimum user ID, username, stage, attempts remaining, and return location. It
is not an authenticated session.

### 4.2 First enrollment

1. After successful password verification, BESTCRM creates a pending encrypted
   TOTP secret.
2. The enrollment page shows the QR code, a manual setup key, and supported-app
   guidance.
3. The user scans the QR code and submits the first six-digit code.
4. Only a valid code changes enrollment from `pending` to `active`.
5. BESTCRM generates and shows the recovery codes once.
6. The user acknowledges that recovery codes have been saved.
7. BESTCRM regenerates the session and completes login.

Refreshing or abandoning enrollment must not activate an unverified secret. A new
enrollment replaces any older unconfirmed secret.

### 4.3 Normal TOTP challenge

The challenge page accepts either a six-digit TOTP or one recovery code. It does
not identify whether the username, password, or TOTP was incorrect in a way that
helps account enumeration. Failed attempts are audited as
`invalid_second_factor` and do not create an authenticated session.

## 5. Trusted Device for 10 Days

### 5.1 User experience

The TOTP page includes an unchecked option:

`Trust this device for 10 days / 信任此设备 10 天`

Selecting it creates a trusted-device record only after a valid TOTP or recovery
code. Users must not select it on shared or public computers.

### 5.2 Token design

- Generate an opaque random token with at least 256 bits of entropy.
- Store only its SHA-256 hash in PostgreSQL.
- Send the raw token in a dedicated cookie with `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, and `Max-Age=864000`.
- The expiry is fixed at exactly 10 days from issuance; successful use does not
  extend it.
- The record is bound to one user and includes creation, expiry, last-use, and
  revocation timestamps plus non-authoritative device/browser audit metadata.
- IP address is audit metadata only and is not a hard binding, so legitimate
  travel or network changes do not lock out an employee.

A trusted-device token skips only the TOTP challenge after a fresh valid password.
It never creates a login session by itself.

### 5.3 Revocation

All trusted devices are revoked when:

- the user changes the password;
- an administrator resets the password;
- TOTP is disabled, reset, or rebound;
- the user chooses `Sign out all sessions / 退出所有设备`;
- the user is deactivated.

Normal logout clears the application session. The account-security page separately
offers `Forget this device` and `Revoke all trusted devices` actions.

## 6. Data Model

Migration `041_authenticator_mfa.sql` will add:

### `user_mfa_settings`

- `user_id` unique foreign key to `users` with cascade delete
- `method` fixed to `totp`
- `status`: `pending`, `active`, or `disabled`
- `is_required`
- encrypted secret fields: ciphertext, nonce, authentication tag, key version
- enrollment timestamps and last verified timestamp
- created and updated timestamps

### `user_mfa_recovery_codes`

- user and settings foreign keys
- keyed code hash
- generation number
- created, used, and invalidated timestamps

### `user_trusted_devices`

- user foreign key
- unique token hash
- user-assigned or derived device label
- browser/user-agent audit hash and last IP metadata
- created, last-used, expires, and revoked timestamps

Indexes must support active enrollment lookup, token lookup, expiry cleanup, and
administrator status lists without exposing secret columns.

## 7. User and Administrator Controls

### 7.1 My account security

Users can:

- view whether Authenticator is active or required;
- bind or rebind after confirming the current password;
- regenerate recovery codes after confirming the current password and TOTP;
- list trusted devices by label and dates;
- revoke one device or all devices;
- forget the current device.

No page may reveal an active secret or previously generated recovery code.

### 7.2 System user management

Administrators can:

- see `Not enrolled`, `Pending`, and `Active` MFA status;
- mark an account as requiring Authenticator;
- revoke trusted devices;
- reset enrollment after an independent identity check.

An administrator reset does not generate a replacement secret or recovery code.
The user must enroll again after the next successful password login. All actions
are audited. Administrators cannot disable their own required MFA as a shortcut.

## 8. Configuration

```dotenv
LOGIN_TOTP_2FA_ENABLED=false
LOGIN_TOTP_TRUST_DAYS=10
LOGIN_TOTP_ISSUER=BESTCRM
TOTP_ENCRYPTION_KEY=base64-encoded-32-byte-key
TOTP_ENCRYPTION_KEY_VERSION=1
TOTP_RECOVERY_CODE_PEPPER=independent-long-random-secret
```

Production startup must fail closed if TOTP is enabled but an encryption or
recovery-code key is missing or invalid. Secrets are written directly to the
protected production environment file and are never sent through chat or stored
in Git.

## 9. Rollout

1. Deploy migration, account-security UI, and TOTP code with the global feature
   flag off.
2. Back up the database, environment file, application release, and uploads.
3. Configure production keys while the feature remains off.
4. Enable the feature for one administrator pilot account.
5. Test enrollment, ordinary login, trusted-device login, recovery code, device
   revocation, expired trust, and administrator reset.
6. Expand enforcement to managers, then all active users.
7. Keep the existing SMS feature disabled.

Rollback first disables `LOGIN_TOTP_2FA_ENABLED` and restarts BESTCRM. Password
login remains available and no password reset or user deletion is required.

## 10. Acceptance Criteria

- A password alone never completes login for an account that requires active TOTP
  unless a valid unexpired trusted-device record is present.
- A trusted device still requires the correct password and expires after exactly
  10 fixed days.
- Invalid, expired, revoked, or user-mismatched device tokens are ignored and do
  not reveal account state.
- TOTP secrets are encrypted at rest and absent from logs, HTML after enrollment,
  cookies, sessions, backups shown to operators, and audit records.
- Recovery codes work once and are never recoverable from the database.
- Password and MFA reset operations revoke sessions and trusted devices.
- Direct URLs enforce the same user/administrator authorization as navigation.
- Login and account-security mutations use CSRF protection and session fixation
  defenses.
- Chinese and English login flows are complete.
- Feature-off behavior preserves the current production password login.
- Database, service, route, and browser tests pass before production enablement.

## 11. Change Control

This document is the frozen BESTCRM Authenticator MFA V1 specification following
explicit user approval on 2026-09-05. Implementation must conform to this scope.
Any material change to the authentication method, 10-day trust period, recovery
model, enforcement model, or production rollout requires a versioned design change
and renewed explicit approval.
