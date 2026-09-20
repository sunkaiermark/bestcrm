import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createAttachmentIntegrityRepository } from '../src/repositories/attachmentIntegrityRepository.mjs';
import { backfillLegacyAttachmentHashes } from '../src/services/attachmentIntegrityBackfillService.mjs';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
if (apply && args.has('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}
const batchArgument = process.argv.slice(2).find((argument) => argument.startsWith('--batch-size='));
const batchSize = Number(batchArgument?.slice('--batch-size='.length) || 100);
if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > 1000) {
  console.error('--batch-size must be an integer between 1 and 1000.');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);

try {
  const result = await backfillLegacyAttachmentHashes({
    repository: createAttachmentIntegrityRepository(pool),
    uploadDir: config.uploadDir,
    apply,
    batchSize
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.refused > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
