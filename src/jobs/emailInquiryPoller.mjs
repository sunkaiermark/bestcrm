import { ImapFlow } from 'imapflow';
import {
  EmailArchiveDuplicateRaceError,
  archiveInboundEmailRecord,
  archiveImportedOutboundEmailRecord,
  persistRawEmailCaptureOnly,
  resolveInboundEmailClassification,
  storeEmailArchiveAttachments
} from '../services/emailArchiveService.mjs';
import {
  EmailRawIdentityConflictError,
  EmailRawMalwareError,
  EmailRawScanError,
  prepareEmailRawCapture
} from '../services/emailRawArchiveService.mjs';
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

function missingEmailConnectionFields(config) {
  const emailIntake = config.emailIntake || {};
  const missing = [];
  for (const field of ['host', 'user', 'password']) {
    if (!requiredText(emailIntake[field])) {
      missing.push(`EMAIL_INTAKE_${field.toUpperCase()}`);
    }
  }
  return { emailIntake, missing };
}

export function validateEmailConnectionConfig(config) {
  const { emailIntake, missing } = missingEmailConnectionFields(config);
  if (missing.length) {
    throw new Error(`Missing email intake configuration: ${missing.join(', ')}`);
  }
  return emailIntake;
}

export function validateEmailIntakeConfig(config) {
  const { emailIntake, missing } = missingEmailConnectionFields(config);
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

function uidNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function supportsUidCheckpointing(repository) {
  return Boolean(
    repository
    && typeof repository.initializeImapSyncState === 'function'
    && typeof repository.updateImapIncrementalCheckpoint === 'function'
    && typeof repository.updateImapBackfillCheckpoint === 'function'
  );
}

function normalizeSyncMode(value) {
  if (value === 'raw-backfill') return 'raw-backfill';
  return value === 'backfill' ? 'backfill' : 'incremental';
}

function historicalSearchQuery(uidRange, historicalSince) {
  const query = { uid: uidRange };
  const since = requiredText(historicalSince);
  if (since) query.since = new Date(`${since}T00:00:00Z`);
  return query;
}

function classificationSummary(items) {
  return items.reduce((summary, item) => {
    summary[item.archiveDisposition] = (summary[item.archiveDisposition] || 0) + 1;
    return summary;
  }, { active: 0, archived: 0, spam: 0 });
}

function entryDecisionSummary(items) {
  return items.reduce((summary, item) => {
    const decision = item.entryDecision || 'manual_review';
    summary[decision] = (summary[decision] || 0) + 1;
    return summary;
  }, { accept: 0, manual_review: 0, reject_spam: 0 });
}

async function scanEmailAttachments(scanner, attachments = []) {
  if (!attachments.length) return [];
  if (!scanner || typeof scanner.scanBuffer !== 'function') {
    throw new EmailRawScanError({ verdict: 'error', findingCode: 'attachment_scanner_unavailable' });
  }
  const scans = [];
  for (const attachment of attachments) {
    if (!Buffer.isBuffer(attachment?.content)) {
      throw new EmailRawScanError({ verdict: 'error', findingCode: 'attachment_content_missing' });
    }
    const scan = await scanner.scanBuffer(attachment.content);
    if (scan?.verdict === 'malware') throw new EmailRawMalwareError(scan);
    if (scan?.verdict !== 'clean') throw new EmailRawScanError(scan);
    scans.push(scan);
  }
  return scans;
}

export async function previewEmailClassifications({
  config,
  contactRepository,
  emailArchiveRepository,
  imapClientFactory = createEmailImapClient,
  maxMessages
}) {
  const emailIntake = validateEmailConnectionConfig(config);
  const client = imapClientFactory(emailIntake);
  const mailbox = requiredText(emailIntake.mailbox) || 'INBOX';
  const limit = uidNumber(maxMessages, uidNumber(emailIntake.maxMessages, 20)) || 20;
  const items = [];

  await client.connect();
  try {
    const openedMailbox = await client.mailboxOpen(mailbox);
    const mailboxState = client.mailbox || openedMailbox || {};
    const uidValidity = requiredText(mailboxState.uidValidity);
    const uids = await client.search({ uid: '1:*' }, { uid: true }) || [];
    const selectedUids = uids
      .map((uid) => uidNumber(uid))
      .filter((uid) => uid > 0)
      .sort((left, right) => right - left)
      .slice(0, limit);

    for (const uid of selectedUids) {
      const fetched = await fetchMessage(client, uid);
      if (!fetched?.source) continue;
      const parsed = await parseEmailArchiveSourceWithAttachments(fetched.source, {
        uid: fetched.uid || uid,
        mailbox,
        mailboxKey: emailIntake.mailboxKey || emailIntake.user || mailbox,
        uidValidity,
        internalDate: fetched.internalDate
      });
      const resolved = await resolveInboundEmailClassification({
        contactRepository,
        emailArchiveRepository
      }, parsed);
      items.push({
        uid,
        receivedAt: parsed.message.receivedAt,
        fromAddress: parsed.message.fromAddress,
        subject: parsed.message.subject,
        archiveDisposition: resolved.classification.archiveDisposition,
        classificationCategory: resolved.classification.classificationCategory,
        classificationReason: resolved.classification.classificationReason,
        entryDecision: resolved.classification.entryDecision,
        spamScore: resolved.classification.spamScore,
        spamSignals: resolved.classification.spamSignals,
        protectedReasons: resolved.classification.protectedReasons,
        matchedCustomerId: resolved.inquiry.matchedCustomerId || null,
        matchedContactId: resolved.inquiry.matchedContactId || null
      });
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return {
    scanned: items.length,
    counts: classificationSummary(items),
    entryCounts: entryDecisionSummary(items),
    items
  };
}

async function selectMessagesForSync({
  client,
  repository,
  emailIntake,
  mailbox,
  uidValidity,
  uidNext,
  maxMessages,
  syncMode
}) {
  if (!supportsUidCheckpointing(repository)) {
    const uids = await client.search({ seen: false }, { uid: true }) || [];
    return {
      mode: 'legacy-unseen',
      state: null,
      selectedUids: uids.slice(0, maxMessages),
      batchComplete: false
    };
  }

  if (!uidValidity) {
    throw new Error('IMAP mailbox UIDVALIDITY is required for checkpointed sync');
  }
  if (!uidNext) {
    throw new Error('IMAP mailbox UIDNEXT is required for checkpointed sync');
  }

  const mailboxKey = requiredText(emailIntake.mailboxKey || emailIntake.user || mailbox);
  const state = await repository.initializeImapSyncState({
    mailboxKey,
    mailboxName: mailbox,
    uidValidity,
    incrementalLastUid: uidNext - 1,
    backfillBeforeUid: uidNext,
    rawBackfillBeforeUid: uidNext
  });

  if (syncMode === 'raw-backfill') {
    if (state.rawBackfillComplete) {
      return { mode: syncMode, state, selectedUids: [], batchComplete: true };
    }
    const beforeUid = uidNumber(state.rawBackfillBeforeUid, uidNext);
    const endUid = beforeUid - 1;
    if (endUid < 1) {
      return { mode: syncMode, state, selectedUids: [], batchComplete: true };
    }
    const uids = await client.search(
      historicalSearchQuery(`1:${endUid}`, emailIntake.historicalSince),
      { uid: true }
    ) || [];
    const selectedUids = uids
      .map((uid) => uidNumber(uid))
      .filter((uid) => uid > 0 && uid < beforeUid)
      .sort((left, right) => right - left)
      .slice(0, maxMessages);
    return { mode: syncMode, state, selectedUids, batchComplete: selectedUids.length < maxMessages };
  }

  if (syncMode === 'backfill') {
    if (state.backfillComplete) {
      return { mode: syncMode, state, selectedUids: [], batchComplete: true };
    }
    const beforeUid = uidNumber(state.backfillBeforeUid, uidNext);
    const endUid = beforeUid - 1;
    if (endUid < 1) {
      return { mode: syncMode, state, selectedUids: [], batchComplete: true };
    }
    const uids = await client.search(
      historicalSearchQuery(`1:${endUid}`, emailIntake.historicalSince),
      { uid: true }
    ) || [];
    const selectedUids = uids
      .map((uid) => uidNumber(uid))
      .filter((uid) => uid > 0 && uid < beforeUid)
      .sort((left, right) => right - left)
      .slice(0, maxMessages);
    return {
      mode: syncMode,
      state,
      selectedUids,
      batchComplete: selectedUids.length < maxMessages
    };
  }

  const firstUid = uidNumber(state.incrementalLastUid) + 1;
  const uids = firstUid >= uidNext
    ? []
    : await client.search({ uid: `${firstUid}:*` }, { uid: true }) || [];
  return {
    mode: syncMode,
    state,
    selectedUids: uids
      .map((uid) => uidNumber(uid))
      .filter((uid) => uid >= firstUid)
      .sort((left, right) => left - right)
      .slice(0, maxMessages),
    batchComplete: false
  };
}

export async function pollEmailInquiries({
  config,
  inquiryRepository,
  inquiryAttachmentRepository,
  emailArchiveRepository,
  contactRepository,
  emailArchiveTransaction,
  malwareScanner = null,
  imapClientFactory = createEmailImapClient,
  logger = console,
  syncMode = 'incremental'
}) {
  const emailIntake = validateEmailIntakeConfig(config);
  const client = imapClientFactory(emailIntake);
  const mailbox = requiredText(emailIntake.mailbox) || 'INBOX';
  const maxMessages = Number(emailIntake.maxMessages || 20);
  const markSeen = emailIntake.markSeen !== false;
  const direction = requiredText(emailIntake.direction).toLowerCase() === 'outbound'
    ? 'outbound'
    : 'inbound';
  const rawArchiveConfig = config.emailRawArchive || {};
  const rawArchiveEnabled = rawArchiveConfig.enabled === true;
  if (rawArchiveEnabled && (!emailArchiveRepository || !emailArchiveTransaction || !malwareScanner)) {
    throw new Error('Raw email archiving requires the email archive repository, transaction, and malware scanner');
  }
  const requestedMode = normalizeSyncMode(syncMode);
  if (requestedMode === 'raw-backfill' && !rawArchiveEnabled) {
    throw new Error('Raw email backfill requires raw email archiving to be enabled');
  }
  const imported = [];
  const filtered = [];
  const skipped = [];
  let scanned = 0;
  let selection = null;
  let uidValidity = '';
  let mailboxKey = '';

  await client.connect();
  try {
    const openedMailbox = await client.mailboxOpen(mailbox);
    const mailboxState = client.mailbox || openedMailbox || {};
    uidValidity = requiredText(mailboxState.uidValidity);
    const uidNext = uidNumber(mailboxState.uidNext);
    mailboxKey = requiredText(emailIntake.mailboxKey || emailIntake.user || mailbox);
    selection = await selectMessagesForSync({
      client,
      repository: emailArchiveRepository,
      emailIntake,
      mailbox,
      uidValidity,
      uidNext,
      maxMessages,
      syncMode: requestedMode
    });
    const selectedUids = selection.selectedUids;
    scanned = selectedUids.length;

    const checkpoint = async (uid, complete = false) => {
      if (!selection.state) return;
      if (selection.mode === 'raw-backfill') {
        selection.state = await emailArchiveRepository.updateImapRawBackfillCheckpoint({
          mailboxKey,
          mailboxName: mailbox,
          uidValidity,
          beforeUid: uid,
          complete
        });
      } else if (selection.mode === 'backfill') {
        selection.state = await emailArchiveRepository.updateImapBackfillCheckpoint({
          mailboxKey,
          mailboxName: mailbox,
          uidValidity,
          beforeUid: uid,
          complete
        });
      } else {
        selection.state = await emailArchiveRepository.updateImapIncrementalCheckpoint({
          mailboxKey,
          mailboxName: mailbox,
          uidValidity,
          uid
        });
      }
    };

    for (const uid of selectedUids) {
      const message = await fetchMessage(client, uid);
      if (!message?.source) {
        logger.warn?.(`Skipping email UID ${uid}: missing source`);
        skipped.push({ uid, reason: 'missing_source' });
        await checkpoint(uid);
        continue;
      }
      const parseMeta = {
        uid: message.uid || uid,
        mailbox,
        mailboxKey: emailIntake.mailboxKey || emailIntake.user || mailbox,
        uidValidity,
        internalDate: message.internalDate,
        direction
      };
      let rawCandidate = null;
      if (rawArchiveEnabled) {
        try {
          rawCandidate = await prepareEmailRawCapture({
            source: message.source,
            uploadDir: config.uploadDir,
            mailboxKey,
            providerName: 'imap',
            providerMailbox: mailbox,
            providerUidValidity: uidValidity,
            providerUid: message.uid || uid,
            maxBytes: rawArchiveConfig.maxBytes,
            scanner: malwareScanner
          });
        } catch (error) {
          if (!(error instanceof EmailRawMalwareError)) throw error;
          const capture = error.capture || {};
          const scan = error.scan || {};
          const stored = await emailArchiveTransaction(({ emailArchiveRepository: transactionRepository }) => {
            if (typeof transactionRepository?.createMalwareSecurityEvent !== 'function') {
              throw new Error('Raw malware handling requires the malware security event repository');
            }
            return transactionRepository.createMalwareSecurityEvent({
              mailboxKey: capture.mailboxKey,
              providerMailbox: capture.providerMailbox,
              providerUidValidity: capture.providerUidValidity,
              providerUid: capture.providerUid,
              sha256: capture.sha256,
              engine: scan.engine,
              engineVersion: scan.engineVersion,
              signatureVersion: scan.signatureVersion,
              verdict: scan.verdict,
              findingCode: scan.findingCode,
              safeDetail: scan.safeDetail,
              startedAt: scan.startedAt,
              completedAt: scan.completedAt
            });
          });
          if (!stored?.malwareEvent
            || stored.malwareEvent.sha256 !== capture.sha256
            || stored.malwareEvent.verdict !== 'malware') {
            throw new EmailRawIdentityConflictError(
              'Malware metadata provider identity conflicts with the stored security event'
            );
          }
          logger.error?.(
            `Blocked email UID ${uid}: malware metadata event ${stored.malwareEvent.id}; raw source discarded before parsing`
          );
          skipped.push({
            uid,
            reason: 'raw_malware_blocked',
            malwareEventId: stored.malwareEvent.id
          });
          await checkpoint(uid);
          continue;
        }
      }
      let parsedEmail;
      try {
        parsedEmail = emailArchiveRepository
          ? await parseEmailArchiveSourceWithAttachments(message.source, parseMeta)
          : await parseEmailInquirySourceWithAttachments(message.source, parseMeta);
      } catch (error) {
        if (!rawCandidate) throw error;
        const rawCapture = await rawCandidate.commit();
        rawCandidate = null;
        const rawMessage = await emailArchiveTransaction((repositories) => persistRawEmailCaptureOnly(
          repositories,
          rawCapture,
          {
            stage: 'parse',
            outcome: 'retryable_error',
            safeErrorCode: 'mime_parse_failed',
            safeDetail: String(error?.message || 'Email MIME parsing failed').slice(0, 500)
          }
        ));
        logger.error?.(`Deferred email UID ${uid}: raw evidence ${rawMessage.id} captured before parse retry`);
        skipped.push({ uid, reason: 'parse_deferred', rawMessageId: rawMessage.id });
        await checkpoint(uid);
        continue;
      }
      const normalized = parsedEmail.inquiry;
      if (!normalized.sourceReference || (direction === 'inbound' && !normalized.requirementText)) {
        if (rawCandidate) {
          const rawCapture = await rawCandidate.commit({
            rfcMessageIdHint: parsedEmail.message?.messageId || '',
            sourceReceivedAt: parsedEmail.message?.receivedAt || parsedEmail.message?.sentAt || null
          });
          rawCandidate = null;
          const rawMessage = await emailArchiveTransaction((repositories) => persistRawEmailCaptureOnly(
            repositories,
            rawCapture,
            {
              stage: 'archive',
              outcome: 'retryable_error',
              safeErrorCode: 'missing_required_fields'
            }
          ));
          logger.warn?.(`Deferred email UID ${uid}: raw evidence ${rawMessage.id} is missing parsed CRM fields`);
          skipped.push({ uid, reason: 'missing_required_fields', rawMessageId: rawMessage.id });
        } else {
          logger.warn?.(`Skipping email UID ${uid}: missing required inquiry fields`);
          skipped.push({ uid, reason: 'missing_required_fields' });
        }
        await checkpoint(uid);
        continue;
      }
      if (!emailArchiveRepository && normalized.rawPayload?.emailFilter?.entryDecision === 'reject_spam') {
        filtered.push({
          uid,
          reason: 'reject_spam',
          category: normalized.rawPayload.emailFilter.category,
          spamScore: normalized.rawPayload.emailFilter.spamScore
        });
        if (markSeen) {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        }
        await checkpoint(uid);
        continue;
      }
      let inquiry;
      let attachments;
      let archiveResult = null;
      let archiveAttachments = { stored: [], skipped: [] };
      if (emailArchiveRepository) {
        let resolvedClassification = null;
        let rawCapture = null;
        let attachmentScans = [];
        if (rawCandidate) {
          try {
            const existing = await emailArchiveRepository.findMessageIdentity(parsedEmail.message);
            resolvedClassification = (existing || direction === 'outbound')
              ? null
              : await resolveInboundEmailClassification({
                emailArchiveRepository,
                contactRepository
              }, parsedEmail);
            attachmentScans = await scanEmailAttachments(malwareScanner, parsedEmail.attachments);
            rawCapture = await rawCandidate.commit({
              rfcMessageIdHint: parsedEmail.message.messageId,
              sourceReceivedAt: parsedEmail.message.receivedAt || parsedEmail.message.sentAt
            });
            rawCandidate = null;
          } catch (error) {
            if (rawCandidate) await rawCandidate.discard().catch(() => {});
            throw error;
          }
        }
        const archiveCallback = (repositories) => direction === 'outbound'
          ? archiveImportedOutboundEmailRecord(repositories, parsedEmail, { rawCapture })
          : archiveInboundEmailRecord(repositories, parsedEmail, {
              rawCapture,
              resolvedClassification
            });
        const runArchive = () => emailArchiveTransaction
          ? emailArchiveTransaction(archiveCallback)
          : archiveCallback({ emailArchiveRepository, inquiryRepository, contactRepository });
        try {
          archiveResult = await runArchive();
        } catch (error) {
          if (!(error instanceof EmailArchiveDuplicateRaceError)) throw error;
          archiveResult = await runArchive();
        }
        archiveAttachments = await storeEmailArchiveAttachments({
          emailArchiveRepository,
          messageId: archiveResult.message.id,
          attachments: parsedEmail.attachments,
          attachmentScans,
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
      await checkpoint(uid);
    }

    if (selection.state && selection.mode === 'raw-backfill' && selection.batchComplete) {
      const beforeUid = selectedUids.length
        ? selectedUids[selectedUids.length - 1]
        : selection.state.rawBackfillBeforeUid;
      selection.state = await emailArchiveRepository.updateImapRawBackfillCheckpoint({
        mailboxKey,
        mailboxName: mailbox,
        uidValidity,
        beforeUid,
        complete: true
      });
    } else if (selection.state && selection.mode === 'backfill' && selection.batchComplete) {
      const beforeUid = selectedUids.length
        ? selectedUids[selectedUids.length - 1]
        : selection.state.backfillBeforeUid;
      selection.state = await emailArchiveRepository.updateImapBackfillCheckpoint({
        mailboxKey,
        mailboxName: mailbox,
        uidValidity,
        beforeUid,
        complete: true
      });
    } else if (selection.state && selection.mode === 'incremental' && selectedUids.length === 0) {
      selection.state = await emailArchiveRepository.updateImapIncrementalCheckpoint({
        mailboxKey,
        mailboxName: mailbox,
        uidValidity,
        uid: selection.state.incrementalLastUid
      });
    }
  } catch (error) {
    if (selection?.state && typeof emailArchiveRepository?.recordImapSyncError === 'function') {
      await emailArchiveRepository.recordImapSyncError({
        mailboxKey,
        mailboxName: mailbox,
        uidValidity,
        errorCode: 'sync_failed'
      }).catch(() => {});
    }
    throw error;
  } finally {
    await client.logout().catch(() => {});
  }

  return {
    scanned,
    imported,
    filtered,
    skipped,
    mode: selection?.mode || requestedMode,
    backfillComplete: selection?.mode === 'raw-backfill'
      ? Boolean(selection?.state?.rawBackfillComplete)
      : Boolean(selection?.state?.backfillComplete)
  };
}
