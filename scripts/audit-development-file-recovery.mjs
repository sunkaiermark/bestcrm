import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createDevelopmentMaterialFileRepository } from '../src/repositories/developmentMaterialFileRepository.mjs';
import { auditDevelopmentMaterialRecovery } from '../src/services/developmentMaterialRecoveryService.mjs';

const config = loadConfig();
const pool = createPool(config);
try {
  const result = await auditDevelopmentMaterialRecovery({
    repository: createDevelopmentMaterialFileRepository(pool),
    uploadDir: config.uploadDir
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
