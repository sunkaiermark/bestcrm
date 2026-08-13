import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';

test('development config can use the local session secret default', () => {
  const config = loadConfig({ NODE_ENV: 'development' });

  assert.equal(config.sessionSecret, 'dev-session-secret');
  assert.equal(config.maxUploadMb, 3072);
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
    pollIntervalMs: 300000,
    maxMessages: 20,
    markSeen: true
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
