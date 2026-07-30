import 'dotenv/config';

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
    uploadDir: env.UPLOAD_DIR || './var/uploads',
    maxUploadMb: Number(env.MAX_UPLOAD_MB || 25)
  };
}
