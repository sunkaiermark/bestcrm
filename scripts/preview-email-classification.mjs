import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { previewEmailClassifications } from '../src/jobs/emailInquiryPoller.mjs';
import { createContactRepository } from '../src/repositories/contactRepository.mjs';
import { createEmailArchiveRepository } from '../src/repositories/emailArchiveRepository.mjs';

const config = loadConfig();
const pool = createPool(config);
const limitArgument = process.argv.find((value) => value.startsWith('--limit='));
const maxMessages = limitArgument ? Number(limitArgument.split('=')[1]) : config.emailIntake.maxMessages;

try {
  const result = await previewEmailClassifications({
    config,
    contactRepository: createContactRepository(pool),
    emailArchiveRepository: createEmailArchiveRepository(pool),
    maxMessages
  });
  console.log(JSON.stringify({
    event: 'email_classification_preview',
    readOnly: true,
    mailboxReadStateChanged: false,
    ...result
  }, null, 2));
} finally {
  await pool.end();
}
