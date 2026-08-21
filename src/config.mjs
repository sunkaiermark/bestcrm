import 'dotenv/config';

function booleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function numberEnv(value, defaultValue) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : defaultValue;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const baseUrl = env.BASE_URL || 'http://127.0.0.1:3000';
  const sessionSecret = env.SESSION_SECRET || '';
  if (nodeEnv === 'production' && !sessionSecret) {
    throw new Error('SESSION_SECRET is required in production');
  }
  const sessionCookieSecure = 'SESSION_COOKIE_SECURE' in env
    ? env.SESSION_COOKIE_SECURE !== 'false'
    : nodeEnv === 'production' && baseUrl.startsWith('https://');

  return {
    nodeEnv,
    port: Number(env.PORT || 3000),
    baseUrl,
    databaseUrl: env.DATABASE_URL || '',
    sessionSecret: sessionSecret || 'dev-session-secret',
    sessionCookieSecure,
    inquiryIntakeSecret: env.INQUIRY_INTAKE_SECRET || '',
    chatwootInquiryIntakeSecret: env.CHATWOOT_INQUIRY_INTAKE_SECRET || '',
    emailIntake: {
      enabled: booleanEnv(env.EMAIL_INTAKE_ENABLED, false),
      host: env.EMAIL_INTAKE_HOST || '',
      port: numberEnv(env.EMAIL_INTAKE_PORT, booleanEnv(env.EMAIL_INTAKE_SECURE, true) ? 993 : 143),
      secure: booleanEnv(env.EMAIL_INTAKE_SECURE, true),
      user: env.EMAIL_INTAKE_USER || '',
      password: env.EMAIL_INTAKE_PASSWORD || '',
      mailbox: env.EMAIL_INTAKE_MAILBOX || 'INBOX',
      pollIntervalMs: numberEnv(env.EMAIL_INTAKE_POLL_INTERVAL_MS, 5 * 60 * 1000),
      maxMessages: numberEnv(env.EMAIL_INTAKE_MAX_MESSAGES, 20),
      markSeen: booleanEnv(env.EMAIL_INTAKE_MARK_SEEN, true)
    },
    notificationDelivery: {
      enabled: booleanEnv(env.NOTIFICATION_DELIVERY_ENABLED, false),
      pollIntervalMs: numberEnv(env.NOTIFICATION_DELIVERY_POLL_INTERVAL_MS, 10 * 1000),
      batchSize: numberEnv(env.NOTIFICATION_DELIVERY_BATCH_SIZE, 20),
      webPush: {
        publicKey: env.WEB_PUSH_PUBLIC_KEY || '',
        privateKey: env.WEB_PUSH_PRIVATE_KEY || '',
        subject: env.WEB_PUSH_SUBJECT || 'mailto:sales@sunkaier.com'
      },
      smtp: {
        host: env.SMTP_HOST || '',
        port: numberEnv(env.SMTP_PORT, booleanEnv(env.SMTP_SECURE, true) ? 465 : 587),
        secure: booleanEnv(env.SMTP_SECURE, true),
        user: env.SMTP_USER || '',
        password: env.SMTP_PASSWORD || '',
        from: env.SMTP_FROM || 'BESTCRM <sales@sunkaier.com>'
      },
      sms: {
        secretId: env.TENCENT_SMS_SECRET_ID || '',
        secretKey: env.TENCENT_SMS_SECRET_KEY || '',
        region: env.TENCENT_SMS_REGION || 'ap-guangzhou',
        sdkAppId: env.TENCENT_SMS_SDK_APP_ID || '',
        signName: env.TENCENT_SMS_SIGN_NAME || '',
        templateId: env.TENCENT_SMS_TEMPLATE_ID || ''
      }
    },
    loginSecondFactor: {
      enabled: booleanEnv(env.LOGIN_SMS_2FA_ENABLED, false),
      codeTtlMinutes: numberEnv(env.LOGIN_SMS_2FA_CODE_TTL_MINUTES, 5),
      maxAttempts: numberEnv(env.LOGIN_SMS_2FA_MAX_ATTEMPTS, 5),
      resendCooldownSeconds: numberEnv(env.LOGIN_SMS_2FA_RESEND_COOLDOWN_SECONDS, 60),
      sms: {
        secretId: env.TENCENT_SMS_SECRET_ID || '',
        secretKey: env.TENCENT_SMS_SECRET_KEY || '',
        region: env.TENCENT_SMS_REGION || 'ap-guangzhou',
        sdkAppId: env.TENCENT_SMS_SDK_APP_ID || '',
        signName: env.TENCENT_SMS_SIGN_NAME || '',
        templateId: env.TENCENT_SMS_LOGIN_TEMPLATE_ID || ''
      }
    },
    uploadDir: env.UPLOAD_DIR || './var/uploads',
    maxUploadMb: numberEnv(env.MAX_UPLOAD_MB, 3072)
  };
}
