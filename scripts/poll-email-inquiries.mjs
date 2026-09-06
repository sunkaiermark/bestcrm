import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createEmailArchiveTransaction } from '../src/db/emailArchiveTransaction.mjs';
import { createEmailArchiveRepository } from '../src/repositories/emailArchiveRepository.mjs';
import { createContactRepository } from '../src/repositories/contactRepository.mjs';
import { createInquiryAttachmentRepository } from '../src/repositories/inquiryAttachmentRepository.mjs';
import { createInquiryRepository } from '../src/repositories/inquiryRepository.mjs';
import { runEmailBackfillLoop } from '../src/jobs/emailBackfillLoop.mjs';
import { pollEmailInquiries } from '../src/jobs/emailInquiryPoller.mjs';

const once = process.argv.includes('--once');
const continuousBackfill = process.argv.includes('--backfill-continuous');
const backfill = process.argv.includes('--backfill') || continuousBackfill;
const config = loadConfig();

if (!config.emailIntake.enabled) {
  console.error('Email intake is disabled. Set EMAIL_INTAKE_ENABLED=true before running this worker.');
  process.exit(1);
}

const pool = createPool(config);
const inquiryRepository = createInquiryRepository(pool);
const inquiryAttachmentRepository = createInquiryAttachmentRepository(pool);
const emailArchiveRepository = createEmailArchiveRepository(pool);
const contactRepository = createContactRepository(pool);
const emailArchiveTransaction = createEmailArchiveTransaction(pool);
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function runOnce() {
  const result = await pollEmailInquiries({
    config,
    inquiryRepository,
    inquiryAttachmentRepository,
    emailArchiveRepository,
    contactRepository,
    emailArchiveTransaction,
    syncMode: backfill ? 'backfill' : 'incremental'
  });
  console.log(JSON.stringify({
    event: 'email_inquiry_poll_complete',
    mode: result.mode,
    scanned: result.scanned,
    imported: result.imported.length,
    skipped: result.skipped.length,
    backfillComplete: result.backfillComplete
  }));
  return result;
}

try {
  if (continuousBackfill) {
    const summary = await runEmailBackfillLoop({
      runBatch: runOnce,
      wait: delay,
      intervalMs: config.emailIntake.pollIntervalMs,
      isStopping: () => stopping
    });
    console.log(JSON.stringify({
      event: 'email_inquiry_backfill_stopped',
      ...summary
    }));
  } else if (once || backfill) {
    await runOnce();
  } else {
    while (!stopping) {
      await runOnce();
      if (!stopping) {
        await delay(config.emailIntake.pollIntervalMs);
      }
    }
  }
} finally {
  await pool.end();
}
