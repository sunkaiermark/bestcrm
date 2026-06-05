import 'dotenv/config';

export function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    baseUrl: env.BASE_URL || 'http://127.0.0.1:3000',
    databaseUrl: env.DATABASE_URL || '',
    sessionSecret: env.SESSION_SECRET || 'dev-session-secret',
    uploadDir: env.UPLOAD_DIR || './var/uploads',
    maxUploadMb: Number(env.MAX_UPLOAD_MB || 25)
  };
}
