import { createEmailImapClient, validateEmailConnectionConfig } from './emailInquiryPoller.mjs';

function text(value) {
  return String(value || '').trim();
}

export async function previewEmailRawBackfill({
  config,
  queryTarget,
  imapClientFactory = createEmailImapClient
}) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for raw email backfill preview');
  const emailIntake = validateEmailConnectionConfig(config);
  const mailbox = text(emailIntake.mailbox) || 'INBOX';
  const mailboxKey = text(emailIntake.mailboxKey || emailIntake.user || mailbox);
  const client = imapClientFactory(emailIntake);
  await client.connect();
  try {
    const openedMailbox = await client.mailboxOpen(mailbox);
    const mailboxState = client.mailbox || openedMailbox || {};
    const uidValidity = text(mailboxState.uidValidity);
    if (!uidValidity) throw new Error('IMAP mailbox UIDVALIDITY is required for raw email backfill preview');
    const providerUids = (await client.search({ uid: '1:*' }, { uid: true }) || [])
      .map(Number)
      .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
      .sort((left, right) => left - right);
    const indexed = await queryTarget.query(`
      SELECT provider_uid
      FROM email_raw_messages
      WHERE mailbox_key = $1
        AND provider_mailbox = $2
        AND provider_uid_validity = $3
      ORDER BY provider_uid
    `, [mailboxKey, mailbox, uidValidity]);
    const coverage = await queryTarget.query(`
      SELECT
        count(*) FILTER (WHERE direction = 'inbound')::integer AS inbound_messages,
        count(*) FILTER (WHERE direction = 'inbound' AND raw_message_id IS NULL)::integer AS inbound_missing_raw
      FROM email_messages
    `);
    const indexedUids = new Set(indexed.rows.map((row) => Number(row.provider_uid)));
    const missingUids = providerUids.filter((uid) => !indexedUids.has(uid));
    return {
      mode: 'read_only',
      mailbox,
      uidValidity,
      providerMessages: providerUids.length,
      indexedRawMessages: indexedUids.size,
      missingRawMessages: missingUids.length,
      newestMissingUid: missingUids.at(-1) || null,
      oldestMissingUid: missingUids[0] || null,
      inboundMessages: Number(coverage.rows[0]?.inbound_messages || 0),
      inboundMissingRaw: Number(coverage.rows[0]?.inbound_missing_raw || 0)
    };
  } finally {
    await client.logout().catch(() => {});
  }
}
