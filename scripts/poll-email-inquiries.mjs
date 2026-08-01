import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { createInquiryRepository } from '../src/repositories/inquiryRepository.mjs';
import { pollEmailInquiries } from '../src/jobs/emailInquiryPoller.mjs';

const once = process.argv.includes('--once');
const config = loadConfig();

if (!config.emailIntake.enabled) {
  console.error('Email intake is disabled. Set EMAIL_INTAKE_ENABLED=true before running this worker.');
  process.exit(1);
}

const pool = createPool(config);
const inquiryRepository = createInquiryRepository(pool);
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function runOnce() {
  const result = await pollEmailInquiries({
    config,
    inquiryRepository
  });
  console.log(JSON.stringify({
    event: 'email_inquiry_poll_complete',
    scanned: result.scanned,
    imported: result.imported
  }));
}

try {
  if (once) {
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
