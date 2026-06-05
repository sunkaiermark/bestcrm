import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PgSessionStore = connectPgSimple(session);

export function createSessionStore(pool) {
  if (!pool) {
    return undefined;
  }
  return new PgSessionStore({
    pool,
    tableName: 'session',
    createTableIfMissing: false
  });
}
