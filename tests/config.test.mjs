import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('development config can use the local session secret default', () => {
  const config = loadConfig({ NODE_ENV: 'development' });

  assert.equal(config.sessionSecret, 'dev-session-secret');
  assert.equal(config.bidCenter.enabled, false);
  assert.equal(config.loginSecondFactor.enabled, false);
  assert.equal(config.maxUploadMb, 3072);
});

test('bid center stays disabled unless explicitly enabled with a supported boolean', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).bidCenter.enabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', BID_CENTER_ENABLED: 'true' }).bidCenter.enabled, true);
  assert.equal(loadConfig({ NODE_ENV: 'development', BID_CENTER_ENABLED: ' ON ' }).bidCenter.enabled, true);
  assert.equal(loadConfig({ NODE_ENV: 'development', BID_CENTER_ENABLED: 'false' }).bidCenter.enabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', BID_CENTER_ENABLED: 'enabled' }).bidCenter.enabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', BID_CENTER_ENABLED: '2' }).bidCenter.enabled, false);
});

test('config reads optional SMS login second-factor settings', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    LOGIN_SMS_2FA_ENABLED: 'true',
    LOGIN_SMS_2FA_CODE_TTL_MINUTES: '8',
    LOGIN_SMS_2FA_MAX_ATTEMPTS: '4',
    LOGIN_SMS_2FA_RESEND_COOLDOWN_SECONDS: '90',
    TENCENT_SMS_SECRET_ID: 'secret-id',
    TENCENT_SMS_SECRET_KEY: 'secret-key',
    TENCENT_SMS_SDK_APP_ID: 'app-id',
    TENCENT_SMS_SIGN_NAME: 'BESTCRM',
    TENCENT_SMS_LOGIN_TEMPLATE_ID: 'login-template-id'
  });

  assert.equal(config.loginSecondFactor.enabled, true);
  assert.equal(config.loginSecondFactor.codeTtlMinutes, 8);
  assert.equal(config.loginSecondFactor.maxAttempts, 4);
  assert.equal(config.loginSecondFactor.resendCooldownSeconds, 90);
  assert.equal(config.loginSecondFactor.sms.templateId, 'login-template-id');
});

test('Authenticator MFA stays disabled by default with the frozen 10-day trust period', () => {
  const config = loadConfig({ NODE_ENV: 'development' });

  assert.deepEqual(config.authenticatorMfa, {
    enabled: false,
    trustDays: 10,
    issuer: 'BESTCRM',
    encryptionKey: '',
    encryptionKeyVersion: 1,
    recoveryCodePepper: ''
  });
});

test('production accepts valid independent Authenticator MFA keys when enabled', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const recoveryCodePepper = 'recovery-pepper-with-at-least-32-chars';
  const config = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'independent-session-secret',
    LOGIN_TOTP_2FA_ENABLED: 'true',
    LOGIN_TOTP_TRUST_DAYS: '10',
    LOGIN_TOTP_ISSUER: 'SUNKAIER BESTCRM',
    TOTP_ENCRYPTION_KEY: encryptionKey,
    TOTP_ENCRYPTION_KEY_VERSION: '2',
    TOTP_RECOVERY_CODE_PEPPER: recoveryCodePepper
  });

  assert.equal(config.authenticatorMfa.enabled, true);
  assert.equal(config.authenticatorMfa.trustDays, 10);
  assert.equal(config.authenticatorMfa.issuer, 'SUNKAIER BESTCRM');
  assert.equal(config.authenticatorMfa.encryptionKey, encryptionKey);
  assert.equal(config.authenticatorMfa.encryptionKeyVersion, 2);
  assert.equal(config.authenticatorMfa.recoveryCodePepper, recoveryCodePepper);
});

test('production fails closed when enabled Authenticator MFA keys are missing or invalid', () => {
  const base = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'independent-session-secret',
    LOGIN_TOTP_2FA_ENABLED: 'true',
    TOTP_RECOVERY_CODE_PEPPER: 'recovery-pepper-with-at-least-32-chars'
  };

  assert.throws(
    () => loadConfig(base),
    /TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key/
  );
  assert.throws(
    () => loadConfig({ ...base, TOTP_ENCRYPTION_KEY: 'not-a-valid-key' }),
    /TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key/
  );
  assert.throws(
    () => loadConfig({
      ...base,
      TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      TOTP_RECOVERY_CODE_PEPPER: 'too-short'
    }),
    /TOTP_RECOVERY_CODE_PEPPER must be at least 32 characters/
  );
});

test('production rejects non-frozen trust periods and reused Authenticator MFA secrets', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const base = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'independent-session-secret',
    LOGIN_TOTP_2FA_ENABLED: 'true',
    TOTP_ENCRYPTION_KEY: encryptionKey,
    TOTP_RECOVERY_CODE_PEPPER: 'recovery-pepper-with-at-least-32-chars'
  };

  assert.throws(
    () => loadConfig({ ...base, LOGIN_TOTP_TRUST_DAYS: '30' }),
    /LOGIN_TOTP_TRUST_DAYS must be 10/
  );
  assert.throws(
    () => loadConfig({ ...base, TOTP_ENCRYPTION_KEY_VERSION: '1.5' }),
    /TOTP_ENCRYPTION_KEY_VERSION must be a positive integer/
  );
  assert.throws(
    () => loadConfig({ ...base, SESSION_SECRET: encryptionKey }),
    /TOTP_ENCRYPTION_KEY must not reuse SESSION_SECRET/
  );
  assert.throws(
    () => loadConfig({
      ...base,
      SESSION_SECRET: 'same-session-secret-with-at-least-32-characters',
      TOTP_RECOVERY_CODE_PEPPER: 'same-session-secret-with-at-least-32-characters'
    }),
    /TOTP_RECOVERY_CODE_PEPPER must not reuse SESSION_SECRET/
  );
});

test('config accepts a positive custom upload limit and rejects invalid values', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development', MAX_UPLOAD_MB: '500' }).maxUploadMb, 500);
  assert.equal(loadConfig({ NODE_ENV: 'development', MAX_UPLOAD_MB: 'invalid' }).maxUploadMb, 3072);
});

test('config reads optional inquiry intake secret', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    INQUIRY_INTAKE_SECRET: 'website-intake-secret',
    CHATWOOT_INQUIRY_INTAKE_SECRET: 'chatwoot-intake-secret',
    EMAIL_INTAKE_ENABLED: 'true',
    EMAIL_INTAKE_HOST: 'imap.example.com',
    EMAIL_INTAKE_PORT: '993',
    EMAIL_INTAKE_SECURE: 'true',
    EMAIL_INTAKE_USER: 'sales@sunkaier.com',
    EMAIL_INTAKE_PASSWORD: 'app-password',
    EMAIL_INTAKE_MAILBOX: 'INBOX',
    EMAIL_INTAKE_MAILBOX_KEY: 'sales@sunkaier.com',
    EMAIL_INTAKE_POLL_INTERVAL_MS: '300000',
    EMAIL_INTAKE_MAX_MESSAGES: '20',
    EMAIL_INTAKE_MARK_SEEN: 'true'
  });

  assert.equal(config.inquiryIntakeSecret, 'website-intake-secret');
  assert.equal(config.chatwootInquiryIntakeSecret, 'chatwoot-intake-secret');
  assert.deepEqual(config.emailIntake, {
    enabled: true,
    host: 'imap.example.com',
    port: 993,
    secure: true,
    user: 'sales@sunkaier.com',
    password: 'app-password',
    mailbox: 'INBOX',
    mailboxKey: 'sales@sunkaier.com',
    pollIntervalMs: 300000,
    maxMessages: 20,
    markSeen: true
  });
});

test('email center interface stays disabled unless explicitly enabled', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).emailCenter.enabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'development', CRM_EMAIL_CENTER_ENABLED: 'true' }).emailCenter.enabled, true);
  assert.equal(loadConfig({ NODE_ENV: 'development' }).emailIntake.markSeen, false);
});

test('email intake hard-caps every batch at 50 messages', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    EMAIL_INTAKE_MAX_MESSAGES: '500'
  });

  assert.equal(config.emailIntake.maxMessages, 50);
});

test('raw email archive and historical raw backfill are fail-closed and disabled by default', () => {
  const defaults = loadConfig({ NODE_ENV: 'development' });
  assert.deepEqual(defaults.emailRawArchive, {
    enabled: false,
    backfillEnabled: false,
    maxBytes: 50 * 1024 * 1024,
    scanner: {
      enabled: false,
      command: 'clamdscan',
      timeoutMs: 120000
    }
  });

  assert.throws(() => loadConfig({
    NODE_ENV: 'development',
    EMAIL_RAW_ARCHIVE_ENABLED: 'true'
  }), /EMAIL_RAW_MALWARE_SCAN_ENABLED must be true/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'development',
    EMAIL_RAW_BACKFILL_ENABLED: 'true'
  }), /EMAIL_RAW_ARCHIVE_ENABLED must be true/);

  const configured = loadConfig({
    NODE_ENV: 'development',
    EMAIL_RAW_ARCHIVE_ENABLED: 'true',
    EMAIL_RAW_MALWARE_SCAN_ENABLED: 'true',
    EMAIL_RAW_BACKFILL_ENABLED: 'true',
    EMAIL_RAW_MAX_MB: '25',
    EMAIL_RAW_SCANNER_COMMAND: '/usr/bin/clamdscan',
    EMAIL_RAW_SCAN_TIMEOUT_MS: '60000'
  });
  assert.equal(configured.emailRawArchive.enabled, true);
  assert.equal(configured.emailRawArchive.backfillEnabled, true);
  assert.equal(configured.emailRawArchive.maxBytes, 25 * 1024 * 1024);
  assert.equal(configured.emailRawArchive.scanner.command, '/usr/bin/clamdscan');
  assert.equal(configured.emailRawArchive.scanner.timeoutMs, 60000);
});

test('Google mail stays fully disabled with the frozen single mailbox defaults', () => {
  const config = loadConfig({ NODE_ENV: 'development' });

  assert.deepEqual(config.googleMail, {
    enabled: false,
    inboundEnabled: false,
    outboundEnabled: false,
    pushEnabled: false,
    providerName: 'google_gmail',
    mailboxAddress: 'sales@sunkaier.com',
    reconcileIntervalMs: 300000,
    watchRenewalIntervalMs: 86400000,
    oauth: {
      clientId: '',
      clientSecret: '',
      redirectUri: '',
      encryptionKey: '',
      encryptionKeyVersion: 1
    },
    pubsub: {
      topic: '',
      audience: ''
    }
  });
});

test('production accepts an independent Google OAuth configuration while mail flow remains dark', () => {
  const encryptionKey = Buffer.alloc(32, 31).toString('base64');
  const config = loadConfig({
    NODE_ENV: 'production',
    BASE_URL: 'https://crm.sunkaier.com',
    SESSION_SECRET: 'independent-session-secret',
    CRM_EMAIL_CENTER_ENABLED: 'true',
    GOOGLE_MAIL_ENABLED: 'true',
    GOOGLE_MAILBOX_ADDRESS: 'SALES@SUNKAIER.COM',
    GOOGLE_MAIL_OAUTH_CLIENT_ID: 'bestcrm.apps.googleusercontent.com',
    GOOGLE_MAIL_OAUTH_CLIENT_SECRET: 'independent-google-client-secret',
    GOOGLE_MAIL_OAUTH_REDIRECT_URI: 'https://crm.sunkaier.com/system/mail-connections/google/callback',
    MAIL_OAUTH_ENCRYPTION_KEY: encryptionKey,
    MAIL_OAUTH_ENCRYPTION_KEY_VERSION: '2'
  });

  assert.equal(config.googleMail.enabled, true);
  assert.equal(config.googleMail.inboundEnabled, false);
  assert.equal(config.googleMail.outboundEnabled, false);
  assert.equal(config.googleMail.pushEnabled, false);
  assert.equal(config.googleMail.mailboxAddress, 'sales@sunkaier.com');
  assert.equal(config.googleMail.oauth.encryptionKeyVersion, 2);
});

test('Google mail sub-features fail closed unless their parent features are enabled', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'development', GOOGLE_MAIL_INBOUND_ENABLED: 'true' }),
    /GOOGLE_MAIL_ENABLED must be true/
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'development',
      GOOGLE_MAIL_ENABLED: 'true',
      GOOGLE_MAIL_PUSH_ENABLED: 'true'
    }),
    /GOOGLE_MAIL_INBOUND_ENABLED must be true/
  );
});

test('production Google mail requires the frozen mailbox, HTTPS callback, credentials, and key', () => {
  const encryptionKey = Buffer.alloc(32, 31).toString('base64');
  const base = {
    NODE_ENV: 'production',
    BASE_URL: 'https://crm.sunkaier.com',
    SESSION_SECRET: 'independent-session-secret',
    CRM_EMAIL_CENTER_ENABLED: 'true',
    GOOGLE_MAIL_ENABLED: 'true',
    GOOGLE_MAIL_OAUTH_CLIENT_ID: 'bestcrm.apps.googleusercontent.com',
    GOOGLE_MAIL_OAUTH_CLIENT_SECRET: 'independent-google-client-secret',
    GOOGLE_MAIL_OAUTH_REDIRECT_URI: 'https://crm.sunkaier.com/system/mail-connections/google/callback',
    MAIL_OAUTH_ENCRYPTION_KEY: encryptionKey
  };

  assert.throws(
    () => loadConfig({ ...base, CRM_EMAIL_CENTER_ENABLED: 'false' }),
    /CRM_EMAIL_CENTER_ENABLED must be true/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAILBOX_ADDRESS: 'info@sunkaier.com' }),
    /GOOGLE_MAILBOX_ADDRESS must be sales@sunkaier.com/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAIL_OAUTH_CLIENT_ID: '' }),
    /GOOGLE_MAIL_OAUTH_CLIENT_ID is required/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAIL_OAUTH_CLIENT_ID: 'not-a-google-client' }),
    /must be a Google OAuth web client ID/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAIL_OAUTH_CLIENT_SECRET: '' }),
    /GOOGLE_MAIL_OAUTH_CLIENT_SECRET is required/
  );
  assert.throws(
    () => loadConfig({ ...base, BASE_URL: 'http://crm.sunkaier.com' }),
    /BASE_URL must be an absolute HTTPS URL/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAIL_OAUTH_REDIRECT_URI: 'https://other.example.com/system/mail-connections/google/callback' }),
    /must use the BASE_URL origin/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAIL_OAUTH_REDIRECT_URI: 'https://crm.sunkaier.com/wrong' }),
    /must use the frozen Google callback path/
  );
  assert.throws(
    () => loadConfig({ ...base, MAIL_OAUTH_ENCRYPTION_KEY: 'invalid' }),
    /base64-encoded 32-byte key/
  );
  assert.throws(
    () => loadConfig({ ...base, MAIL_OAUTH_ENCRYPTION_KEY_VERSION: '1.5' }),
    /must be a positive integer/
  );
});

test('production Google mail rejects reused secrets and validates Pub/Sub settings', () => {
  const encryptionKey = Buffer.alloc(32, 31).toString('base64');
  const base = {
    NODE_ENV: 'production',
    BASE_URL: 'https://crm.sunkaier.com',
    SESSION_SECRET: 'independent-session-secret',
    CRM_EMAIL_CENTER_ENABLED: 'true',
    GOOGLE_MAIL_ENABLED: 'true',
    GOOGLE_MAIL_INBOUND_ENABLED: 'true',
    GOOGLE_MAIL_OAUTH_CLIENT_ID: 'bestcrm.apps.googleusercontent.com',
    GOOGLE_MAIL_OAUTH_CLIENT_SECRET: 'independent-google-client-secret',
    GOOGLE_MAIL_OAUTH_REDIRECT_URI: 'https://crm.sunkaier.com/system/mail-connections/google/callback',
    MAIL_OAUTH_ENCRYPTION_KEY: encryptionKey
  };

  assert.throws(
    () => loadConfig({ ...base, SESSION_SECRET: encryptionKey }),
    /MAIL_OAUTH_ENCRYPTION_KEY must not reuse SESSION_SECRET/
  );
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_MAIL_OAUTH_CLIENT_SECRET: encryptionKey }),
    /MAIL_OAUTH_ENCRYPTION_KEY must not reuse GOOGLE_MAIL_OAUTH_CLIENT_SECRET/
  );
  assert.throws(
    () => loadConfig({
      ...base,
      GOOGLE_MAIL_PUSH_ENABLED: 'true',
      GOOGLE_MAIL_PUBSUB_TOPIC: 'bad-topic',
      GOOGLE_MAIL_PUBSUB_AUDIENCE: 'https://crm.sunkaier.com/api/mail/google/pubsub'
    }),
    /GOOGLE_MAIL_PUBSUB_TOPIC must be a full Google Cloud Pub\/Sub topic name/
  );
  assert.throws(
    () => loadConfig({
      ...base,
      GOOGLE_MAIL_PUSH_ENABLED: 'true',
      GOOGLE_MAIL_PUBSUB_TOPIC: 'projects/bestcrm-mail-prod/topics/gmail-events',
      GOOGLE_MAIL_PUBSUB_AUDIENCE: 'https://other.example.com/api/mail/google/pubsub'
    }),
    /must use the frozen BESTCRM Pub\/Sub callback/
  );

  const config = loadConfig({
    ...base,
    GOOGLE_MAIL_PUSH_ENABLED: 'true',
    GOOGLE_MAIL_PUBSUB_TOPIC: 'projects/bestcrm-mail-prod/topics/gmail-events',
    GOOGLE_MAIL_PUBSUB_AUDIENCE: 'https://crm.sunkaier.com/api/mail/google/pubsub'
  });
  assert.equal(config.googleMail.pushEnabled, true);
  assert.equal(config.googleMail.pubsub.topic, 'projects/bestcrm-mail-prod/topics/gmail-events');
});

test('customer email sending has a separate disabled-by-default flag and fixed shared sender', () => {
  const defaults = loadConfig({ NODE_ENV: 'development' });
  assert.equal(defaults.customerEmail.enabled, false);
  assert.equal(defaults.customerEmail.sharedAddress, 'sales@sunkaier.com');
  assert.equal(defaults.customerEmail.maxUploadMb, 25);

  const configured = loadConfig({
    NODE_ENV: 'development',
    CRM_EMAIL_SENDING_ENABLED: 'true',
    CRM_EMAIL_MAX_UPLOAD_MB: '12',
    CUSTOMER_SMTP_HOST: 'smtp.example.com',
    CUSTOMER_SMTP_PORT: '587',
    CUSTOMER_SMTP_SECURE: 'false',
    CUSTOMER_SMTP_USER: 'sales@sunkaier.com',
    CUSTOMER_SMTP_PASSWORD: 'app-password'
  });
  assert.deepEqual(configured.customerEmail, {
    enabled: true,
    sharedAddress: 'sales@sunkaier.com',
    maxUploadMb: 12,
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'sales@sunkaier.com',
      password: 'app-password'
    }
  });
});

test('config reads notification delivery providers without enabling them by default', () => {
  const defaults = loadConfig({ NODE_ENV: 'development' });
  assert.equal(defaults.notificationDelivery.enabled, false);

  const config = loadConfig({
    NODE_ENV: 'development',
    NOTIFICATION_DELIVERY_ENABLED: 'true',
    NOTIFICATION_DELIVERY_POLL_INTERVAL_MS: '12000',
    NOTIFICATION_DELIVERY_BATCH_SIZE: '30',
    WEB_PUSH_PUBLIC_KEY: 'public-key',
    WEB_PUSH_PRIVATE_KEY: 'private-key',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'crm@example.com',
    SMTP_PASSWORD: 'password',
    TENCENT_SMS_SECRET_ID: 'secret-id',
    TENCENT_SMS_SECRET_KEY: 'secret-key',
    TENCENT_SMS_SDK_APP_ID: 'app-id',
    TENCENT_SMS_SIGN_NAME: 'BESTCRM',
    TENCENT_SMS_TEMPLATE_ID: 'template-id'
  });

  assert.equal(config.notificationDelivery.enabled, true);
  assert.equal(config.notificationDelivery.pollIntervalMs, 12000);
  assert.equal(config.notificationDelivery.batchSize, 30);
  assert.equal(config.notificationDelivery.webPush.publicKey, 'public-key');
  assert.equal(config.notificationDelivery.smtp.secure, false);
  assert.equal(config.notificationDelivery.smtp.port, 587);
  assert.equal(config.notificationDelivery.sms.templateId, 'template-id');
});

test('production config requires an explicit session secret', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /SESSION_SECRET is required in production/
  );
});

test('production config accepts an explicit session secret', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-production-only-secret'
  });

  assert.equal(config.sessionSecret, 'a-production-only-secret');
});

test('session cookie secure flag can be disabled for public IP HTTP deployment', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    BASE_URL: 'http://175.27.225.156',
    SESSION_SECRET: 'a-production-only-secret',
    SESSION_COOKIE_SECURE: 'false'
  });

  assert.equal(config.sessionCookieSecure, false);
});

test('production HTTP base URL does not force secure session cookies', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    BASE_URL: 'http://175.27.225.156',
    SESSION_SECRET: 'a-production-only-secret'
  });

  assert.equal(config.sessionCookieSecure, false);
});

test('production HTTPS base URL uses secure session cookies by default', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    BASE_URL: 'https://crm.example.com',
    SESSION_SECRET: 'a-production-only-secret'
  });

  assert.equal(config.sessionCookieSecure, true);
});
