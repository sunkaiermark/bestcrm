import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import {
  cleanupNonInquiryEmailAttachments,
  nonInquiryEmailAttachmentCleanupStatuses
} from '../src/services/emailInquiryAttachmentCleanupService.mjs';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;

if (apply && args.has('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);

try {
  const result = await cleanupNonInquiryEmailAttachments({
    queryTarget: pool,
    uploadDir: config.uploadDir,
    apply: !dryRun
  });
  console.log(JSON.stringify({
    event: 'email_inquiry_attachment_cleanup_complete',
    statuses: nonInquiryEmailAttachmentCleanupStatuses(),
    ...result
  }, null, 2));
} finally {
  await pool.end();
}
