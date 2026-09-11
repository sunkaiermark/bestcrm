import { loadConfig } from '../src/config.mjs';
import {
  assertEmailIntakeMailboxAssignments,
  loadEmailIntakeSources
} from '../src/config/emailIntakeAccounts.mjs';
import { createPool } from '../src/db/pool.mjs';
import {
  createEmailImapClient,
  validateEmailConnectionConfig
} from '../src/jobs/emailInquiryPoller.mjs';
import { createEmailArchiveRepository } from '../src/repositories/emailArchiveRepository.mjs';

const config = loadConfig();
const sources = loadEmailIntakeSources(config);
const pool = createPool(config);

try {
  const emailArchiveRepository = createEmailArchiveRepository(pool);
  await assertEmailIntakeMailboxAssignments(sources, emailArchiveRepository, {
    sharedMailboxKey: config.emailIntake.mailboxKey || config.emailIntake.user
  });
  const verified = [];
  for (const source of sources) {
    validateEmailConnectionConfig({ ...config, emailIntake: source });
    const client = createEmailImapClient(source);
    await client.connect();
    try {
      const opened = await client.mailboxOpen(source.mailbox, { readOnly: true });
      const mailbox = client.mailbox || opened || {};
      verified.push({
        mailboxKey: source.mailboxKey,
        mailbox: source.mailbox,
        direction: source.direction,
        readOnly: true,
        exists: Number(mailbox.exists || 0)
      });
    } finally {
      await client.logout().catch(() => {});
    }
  }
  process.stdout.write(`${JSON.stringify({
    event: 'email_intake_accounts_verified',
    sourceCount: verified.length,
    sources: verified
  }, null, 2)}\n`);
} finally {
  await pool.end();
}
