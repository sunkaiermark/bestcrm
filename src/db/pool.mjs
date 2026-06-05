import pg from 'pg';
import { loadConfig } from '../config.mjs';

export function createPool(config = loadConfig()) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return new pg.Pool({ connectionString: config.databaseUrl });
}
