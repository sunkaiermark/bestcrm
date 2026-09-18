import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { auditEmailReimportReset } from '../src/services/emailReimportResetAuditService.mjs';

const config = loadConfig();
const pool = createPool(config);
const client = await pool.connect();

try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '5min'");
  const result = await auditEmailReimportReset(client, { uploadDir: config.uploadDir });
  await client.query('ROLLBACK');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original audit error.
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
