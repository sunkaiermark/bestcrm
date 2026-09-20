import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createAttachmentIntegrityRepository } from '../src/repositories/attachmentIntegrityRepository.mjs';
import {
  cleanupNonInquiryEmailAttachments,
  nonInquiryEmailAttachmentCleanupStatuses
} from '../src/services/emailInquiryAttachmentCleanupService.mjs';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run') || !apply;
const actorArgument = process.argv.slice(2).find((argument) => argument.startsWith('--actor-user-id='));
const actorUserId = Number(actorArgument?.slice('--actor-user-id='.length) || 0);

if (apply && args.has('--dry-run')) {
  console.error('Use either --dry-run or --apply, not both.');
  process.exit(1);
}
if (apply && (!Number.isSafeInteger(actorUserId) || actorUserId <= 0)) {
  console.error('Apply mode requires --actor-user-id=<administrator user id>.');
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);
const attachmentIntegrityRepository = createAttachmentIntegrityRepository(pool);

try {
  const result = await cleanupNonInquiryEmailAttachments({
    queryTarget: pool,
    attachmentIntegrityRepository,
    actorUserId,
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
