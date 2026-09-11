import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../src/config.mjs';
import {
  assertEmailIntakeMailboxAssignments,
  loadEmailIntakeSources
} from '../src/config/emailIntakeAccounts.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createEmailArchiveTransaction } from '../src/db/emailArchiveTransaction.mjs';
import { createEmailArchiveRepository } from '../src/repositories/emailArchiveRepository.mjs';
import { createContactRepository } from '../src/repositories/contactRepository.mjs';
import { createInquiryAttachmentRepository } from '../src/repositories/inquiryAttachmentRepository.mjs';
import { createInquiryRepository } from '../src/repositories/inquiryRepository.mjs';
import { runEmailBackfillLoop } from '../src/jobs/emailBackfillLoop.mjs';
import { pollEmailInquiries } from '../src/jobs/emailInquiryPoller.mjs';
import { createClamAvScanner } from '../src/services/emailMalwareScannerService.mjs';

const once = process.argv.includes('--once');
const continuousBackfill = process.argv.includes('--backfill-continuous');
const backfill = process.argv.includes('--backfill') || continuousBackfill;
const config = loadConfig();

if (!config.emailIntake.enabled) {
  console.error('Email intake is disabled. Set EMAIL_INTAKE_ENABLED=true before running this worker.');
  process.exit(1);
}
if (backfill && !config.emailRawArchive.backfillEnabled) {
  console.error('Raw email backfill is disabled. Set EMAIL_RAW_BACKFILL_ENABLED=true only after backup and restore verification.');
  process.exit(1);
}
const emailIntakeSources = loadEmailIntakeSources(config);

const pool = createPool(config);
const inquiryRepository = createInquiryRepository(pool);
const inquiryAttachmentRepository = createInquiryAttachmentRepository(pool);
const emailArchiveRepository = createEmailArchiveRepository(pool);
const contactRepository = createContactRepository(pool);
const emailArchiveTransaction = createEmailArchiveTransaction(pool);
const malwareScanner = config.emailRawArchive.enabled
  ? createClamAvScanner(config.emailRawArchive.scanner)
  : null;
const stopController = new AbortController();
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    stopController.abort();
  });
}

async function waitForNextPoll(intervalMs) {
  try {
    await delay(intervalMs, undefined, { signal: stopController.signal });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      throw error;
    }
  }
}

async function runOnce() {
  const results = [];
  const failures = [];
  for (const source of emailIntakeSources) {
    try {
      results.push(await pollEmailInquiries({
        config: { ...config, emailIntake: source },
        inquiryRepository,
        inquiryAttachmentRepository,
        emailArchiveRepository,
        contactRepository,
        emailArchiveTransaction,
        malwareScanner,
        syncMode: backfill ? 'raw-backfill' : 'incremental'
      }));
    } catch (error) {
      failures.push({ mailboxKey: source.mailboxKey, mailbox: source.mailbox, error });
      console.error(JSON.stringify({
        event: 'email_inquiry_source_failed',
        mailboxKey: source.mailboxKey,
        mailbox: source.mailbox,
        code: String(error?.code || error?.name || 'sync_failed')
      }));
    }
  }
  const result = {
    mode: backfill ? 'raw-backfill' : 'incremental',
    scanned: results.reduce((sum, item) => sum + Number(item.scanned || 0), 0),
    imported: results.flatMap((item) => item.imported || []),
    filtered: results.flatMap((item) => item.filtered || []),
    skipped: results.flatMap((item) => item.skipped || []),
    backfillComplete: results.length === emailIntakeSources.length
      && results.every((item) => item.backfillComplete === true)
  };
  console.log(JSON.stringify({
    event: 'email_inquiry_poll_complete',
    mode: result.mode,
    scanned: result.scanned,
    imported: result.imported.length,
    filtered: result.filtered.length,
    skipped: result.skipped.length,
    backfillComplete: result.backfillComplete
  }));
  if (failures.length) {
    throw new AggregateError(failures.map((item) => item.error), `${failures.length} email intake source(s) failed`);
  }
  return result;
}

try {
  await assertEmailIntakeMailboxAssignments(emailIntakeSources, emailArchiveRepository, {
    sharedMailboxKey: config.emailIntake.mailboxKey || config.emailIntake.user
  });
  if (continuousBackfill) {
    const summary = await runEmailBackfillLoop({
      runBatch: runOnce,
      wait: waitForNextPoll,
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
        await waitForNextPoll(config.emailIntake.pollIntervalMs);
      }
    }
  }
} finally {
  await pool.end();
}
