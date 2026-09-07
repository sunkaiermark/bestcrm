import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { previewEmailRawBackfill } from '../src/jobs/emailRawBackfillPreview.mjs';

const config = loadConfig();
const pool = createPool(config);

try {
  const result = await previewEmailRawBackfill({ config, queryTarget: pool });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await pool.end();
}
