import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { auditEmailRawArchive } from '../src/services/emailRawArchiveAuditService.mjs';

const config = loadConfig();
const pool = createPool(config);

try {
  const result = await auditEmailRawArchive({ queryTarget: pool, uploadDir: config.uploadDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.mismatches.length || result.unexpectedFiles.length || result.rawWithoutCleanScan) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
