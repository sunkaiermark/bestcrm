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
    uploadDir: env.UPLOAD_DIR || './var/uploads',
    maxUploadMb: Number(env.MAX_UPLOAD_MB || 25)
  };
}
