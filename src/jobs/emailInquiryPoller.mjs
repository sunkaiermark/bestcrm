import { ImapFlow } from 'imapflow';
import {
  EmailArchiveDuplicateRaceError,
  archiveInboundEmailRecord,
  storeEmailArchiveAttachments
} from '../services/emailArchiveService.mjs';
import { storeEmailInquiryAttachments } from '../services/emailInquiryAttachmentService.mjs';
import {
  parseEmailArchiveSourceWithAttachments,
  parseEmailInquirySourceWithAttachments
} from '../services/emailInquiryService.mjs';

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
  emailArchiveRepository,
  emailArchiveTransaction,
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
    const uidValidity = requiredText(client.mailbox?.uidValidity);
    const uids = await client.search({ seen: false }, { uid: true }) || [];
    const selectedUids = uids.slice(0, maxMessages);
    scanned = selectedUids.length;

    for (const uid of selectedUids) {
      const message = await fetchMessage(client, uid);
      if (!message?.source) {
        logger.warn?.(`Skipping email UID ${uid}: missing source`);
        continue;
      }
      const parseMeta = {
        uid: message.uid || uid,
        mailbox,
        mailboxKey: emailIntake.mailboxKey || emailIntake.user || mailbox,
        uidValidity,
        internalDate: message.internalDate
      };
      const parsedEmail = emailArchiveRepository
        ? await parseEmailArchiveSourceWithAttachments(message.source, parseMeta)
        : await parseEmailInquirySourceWithAttachments(message.source, parseMeta);
      const normalized = parsedEmail.inquiry;
      if (!normalized.sourceReference || !normalized.requirementText) {
        logger.warn?.(`Skipping email UID ${uid}: missing required inquiry fields`);
        continue;
      }
      let inquiry;
      let attachments;
      let archiveResult = null;
      let archiveAttachments = { stored: [], skipped: [] };
      if (emailArchiveRepository) {
        const archiveCallback = (repositories) => archiveInboundEmailRecord(repositories, parsedEmail);
        try {
          archiveResult = emailArchiveTransaction
            ? await emailArchiveTransaction(archiveCallback)
            : await archiveCallback({ emailArchiveRepository, inquiryRepository });
        } catch (error) {
          if (!(error instanceof EmailArchiveDuplicateRaceError)) throw error;
          const existing = await emailArchiveRepository.findMessageIdentity(parsedEmail.message);
          if (!existing) throw error;
          archiveResult = {
            duplicate: true,
            message: existing,
            thread: await emailArchiveRepository.findThreadById(existing.threadId),
            inquiry: null
          };
        }
        archiveAttachments = await storeEmailArchiveAttachments({
          emailArchiveRepository,
          messageId: archiveResult.message.id,
          attachments: parsedEmail.attachments,
          uploadDir: config.uploadDir,
          maxUploadMb: config.maxUploadMb
        });
        inquiry = archiveResult.inquiry;
        attachments = inquiry && shouldStoreAttachmentsForInquiry(inquiry)
          ? await storeEmailInquiryAttachments({
            inquiryAttachmentRepository,
            inquiryId: inquiry.id,
            attachments: parsedEmail.attachments,
            uploadDir: config.uploadDir,
            maxUploadMb: config.maxUploadMb
          })
          : { stored: [], skipped: [] };
      } else {
        inquiry = await inquiryRepository.createInquiry(normalized);
        attachments = shouldStoreAttachmentsForInquiry(inquiry)
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
      }
      if (markSeen) {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }
      imported.push(emailArchiveRepository ? {
        uid,
        threadId: archiveResult.thread.id,
        messageId: archiveResult.message.id,
        inquiryId: archiveResult.thread.inquiryId || inquiry?.id || null,
        opportunityId: archiveResult.thread.opportunityId || null,
        duplicate: archiveResult.duplicate,
        attachments: archiveAttachments.stored.length,
        skippedAttachments: archiveAttachments.skipped.length
      } : {
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
