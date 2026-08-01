import { ImapFlow } from 'imapflow';
import { storeEmailInquiryAttachments } from '../services/emailInquiryAttachmentService.mjs';
import { parseEmailInquirySourceWithAttachments } from '../services/emailInquiryService.mjs';

function requiredText(value) {
  return String(value || '').trim();
}

function shouldStoreAttachmentsForInquiry(inquiry) {
  return !['archived', 'spam'].includes(inquiry?.status);
}

export function validateEmailIntakeConfig(config) {
  const emailIntake = config.emailIntake || {};
  const missing = [];
  for (const field of ['host', 'user', 'password']) {
    if (!requiredText(emailIntake[field])) {
      missing.push(`EMAIL_INTAKE_${field.toUpperCase()}`);
    }
  }
  if (!config.databaseUrl) {
    missing.push('DATABASE_URL');
  }
  if (missing.length) {
    throw new Error(`Missing email intake configuration: ${missing.join(', ')}`);
  }
  return emailIntake;
}

export function createEmailImapClient(emailIntake) {
  return new ImapFlow({
    host: emailIntake.host,
    port: emailIntake.port,
    secure: emailIntake.secure,
    auth: {
      user: emailIntake.user,
      pass: emailIntake.password
    },
    logger: false
  });
}

async function fetchMessage(client, uid) {
  return client.fetchOne(String(uid), {
    uid: true,
    source: true,
    internalDate: true,
    envelope: true
  }, { uid: true });
}

export async function pollEmailInquiries({
  config,
  inquiryRepository,
  inquiryAttachmentRepository,
  imapClientFactory = createEmailImapClient,
  logger = console
}) {
  const emailIntake = validateEmailIntakeConfig(config);
  const client = imapClientFactory(emailIntake);
  const mailbox = requiredText(emailIntake.mailbox) || 'INBOX';
  const maxMessages = Number(emailIntake.maxMessages || 20);
  const markSeen = emailIntake.markSeen !== false;
  const imported = [];
  let scanned = 0;

  await client.connect();
  try {
    await client.mailboxOpen(mailbox);
    const uids = await client.search({ seen: false }, { uid: true }) || [];
    const selectedUids = uids.slice(0, maxMessages);
    scanned = selectedUids.length;

    for (const uid of selectedUids) {
      const message = await fetchMessage(client, uid);
      if (!message?.source) {
        logger.warn?.(`Skipping email UID ${uid}: missing source`);
        continue;
      }
      const parsedEmail = await parseEmailInquirySourceWithAttachments(message.source, {
        uid: message.uid || uid,
        mailbox,
        internalDate: message.internalDate
      });
      const normalized = parsedEmail.inquiry;
      if (!normalized.sourceReference || !normalized.requirementText) {
        logger.warn?.(`Skipping email UID ${uid}: missing required inquiry fields`);
        continue;
      }
      const inquiry = await inquiryRepository.createInquiry(normalized);
      const attachments = shouldStoreAttachmentsForInquiry(inquiry)
        ? await storeEmailInquiryAttachments({
          inquiryAttachmentRepository,
          inquiryId: inquiry.id,
          attachments: parsedEmail.attachments,
          uploadDir: config.uploadDir,
          maxUploadMb: config.maxUploadMb
        })
        : {
          stored: [],
          skipped: parsedEmail.attachments.map((attachment, index) => ({
            sourceIndex: index,
            reason: 'non_inquiry_status',
            status: inquiry.status
          }))
        };
      if (markSeen) {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }
      imported.push({
        uid,
        inquiryId: inquiry.id,
        duplicate: Boolean(inquiry.wasDuplicate),
        attachments: attachments.stored.length,
        skippedAttachments: attachments.skipped.length
      });
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return {
    scanned,
    imported
  };
}
