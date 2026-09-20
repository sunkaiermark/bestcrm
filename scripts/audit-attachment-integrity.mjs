import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createAttachmentIntegrityRepository } from '../src/repositories/attachmentIntegrityRepository.mjs';
import { auditAttachmentIntegrity } from '../src/services/attachmentIntegrityAuditService.mjs';

const config = loadConfig();
const pool = createPool(config);

try {
  const result = await auditAttachmentIntegrity({
    repository: createAttachmentIntegrityRepository(pool),
    uploadDir: config.uploadDir
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await pool.end();
}
