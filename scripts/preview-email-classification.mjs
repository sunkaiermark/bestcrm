import { loadConfig } from '../src/config.mjs';
import {
  assertEmailIntakeMailboxAssignments,
  loadEmailIntakeSources
} from '../src/config/emailIntakeAccounts.mjs';
import { createPool } from '../src/db/pool.mjs';
import { previewEmailClassifications } from '../src/jobs/emailInquiryPoller.mjs';
import { createContactRepository } from '../src/repositories/contactRepository.mjs';
import { createEmailArchiveRepository } from '../src/repositories/emailArchiveRepository.mjs';

const config = loadConfig();
const pool = createPool(config);
const limitArgument = process.argv.find((value) => value.startsWith('--limit='));
const maxMessages = limitArgument ? Number(limitArgument.split('=')[1]) : config.emailIntake.maxMessages;

try {
  const contactRepository = createContactRepository(pool);
  const emailArchiveRepository = createEmailArchiveRepository(pool);
  const sources = loadEmailIntakeSources(config);
  await assertEmailIntakeMailboxAssignments(sources, emailArchiveRepository, {
    sharedMailboxKey: config.emailIntake.mailboxKey || config.emailIntake.user
  });
  const sourceResults = [];
  for (const source of sources.filter((item) => item.direction !== 'outbound')) {
    sourceResults.push({
      mailboxKey: source.mailboxKey,
      mailbox: source.mailbox,
      ...await previewEmailClassifications({
        config: { ...config, emailIntake: source },
        contactRepository,
        emailArchiveRepository,
        maxMessages
      })
    });
  }
  console.log(JSON.stringify({
    event: 'email_classification_preview',
    readOnly: true,
    mailboxReadStateChanged: false,
    sourceCount: sourceResults.length,
    scanned: sourceResults.reduce((sum, item) => sum + Number(item.scanned || 0), 0),
    sources: sourceResults
  }, null, 2));
} finally {
  await pool.end();
}
