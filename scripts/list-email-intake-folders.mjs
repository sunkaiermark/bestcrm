import { loadConfig } from '../src/config.mjs';
import { loadEmailIntakeSources } from '../src/config/emailIntakeAccounts.mjs';
import {
  createEmailImapClient,
  validateEmailConnectionConfig
} from '../src/jobs/emailInquiryPoller.mjs';

const config = loadConfig();
const sources = loadEmailIntakeSources(config);
const accounts = new Map();
for (const source of sources) {
  if (!accounts.has(source.mailboxKey)) accounts.set(source.mailboxKey, source);
}
const results = [];

for (const source of accounts.values()) {
  validateEmailConnectionConfig({ ...config, emailIntake: source });
  const client = createEmailImapClient(source);
  await client.connect();
  try {
    const folders = await client.list();
    results.push({
      mailboxKey: source.mailboxKey,
      readOnly: true,
      folders: folders.map((folder) => ({
        path: folder.path,
        specialUse: folder.specialUse || ''
      }))
    });
  } finally {
    await client.logout().catch(() => {});
  }
}

process.stdout.write(`${JSON.stringify({
  event: 'email_intake_folders_listed',
  accountCount: results.length,
  accounts: results
}, null, 2)}\n`);
