import { Router } from 'express';
import multer from 'multer';
import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { requireLogin } from '../middleware/auth.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';
import {
  assignEmailThreadTriage,
  canPurgeEmailThread,
  canPurgeEmailSpam,
  convertEmailThreadToInquiry,
  EmailArchiveError,
  getEmailSpamCleanupSummary,
  getVisibleEmailAttachment,
  getVisibleEmailThread,
  linkEmailThreadToInquiry,
  linkEmailThreadToOpportunity,
  listEmailLinkableInquiries,
  listEmailLinkableOpportunities,
  listEmailTriageAssignees,
  purgeEmailThread,
  purgeEligibleEmailSpam,
  resolveVisibleEmailMailbox,
  setEmailThreadDisposition,
  listVisibleEmailThreads
} from '../services/emailArchiveService.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import { canAccessInquiryInbox } from '../services/inquiryService.mjs';
import {
  CustomerEmailError,
  createCustomerEmailDraft,
  getCustomerEmailComposeContext,
  sendCustomerEmail
} from '../services/customerEmailService.mjs';

function handleError(error, res, next) {
  if (error instanceof EmailArchiveError || error instanceof CustomerEmailError || Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode || 400).send(error.message);
    return;
  }
  next(error);
}

function emailFolder(value) {
  return ['pending', 'inbox', 'sent', 'linked', 'archived', 'spam'].includes(value) ? value : 'pending';
}

function emailFolderFilter(folder, mailboxKey) {
  const base = { mailboxKey };
  if (folder === 'pending') return { ...base, archiveDisposition: 'active', triageStatus: 'pending', direction: 'inbound' };
  if (folder === 'inbox') return { ...base, archiveDisposition: 'active', direction: 'inbound' };
  if (folder === 'sent') return { ...base, archiveDisposition: 'active', direction: 'outbound' };
  if (folder === 'linked') return {
    ...base,
    archiveDisposition: 'active',
    triageStatuses: ['linked_opportunity', 'linked_inquiry', 'converted_inquiry']
  };
  if (folder === 'archived') return { ...base, archiveDisposition: 'archived', triageStatus: 'archived' };
  return { ...base, archiveDisposition: 'spam', triageStatus: 'spam' };
}

function threadRedirect(threadId, body = {}) {
  const query = new URLSearchParams();
  const mailbox = String(body.mailbox || '').trim().toLowerCase();
  if (mailbox) query.set('mailbox', mailbox);
  query.set('from', emailFolder(String(body.from || 'pending')));
  return `/email-center/threads/${threadId}?${query.toString()}`;
}

const emailListDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function formatEmailListDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(
    emailListDateFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function emailCenterRoutes({
  enabled = false,
  emailArchiveRepository,
  inquiryRepository,
  userRepository,
  opportunityRepository,
  opportunityResponsibilityRepository,
  quotationPackageRepository,
  emailArchiveTransaction = null,
  transport = null,
  sendingEnabled = false,
  sharedAddress = 'sales@sunkaier.com',
  uploadDir = './var/uploads',
  maxUploadMb = 25,
  now = () => new Date().toISOString(),
  randomUUID = () => nodeRandomUUID()
}) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 10 }
  });
  const dependencies = {
    emailArchiveRepository,
    inquiryRepository,
    userRepository,
    opportunityRepository,
    opportunityResponsibilityRepository,
    quotationPackageRepository,
    emailArchiveTransaction,
    transport,
    sharedAddress,
    uploadDir,
    maxUploadMb,
    now,
    randomUUID
  };

  router.use('/email-center', (req, res, next) => {
    if (!enabled) {
      res.status(404).send('Email Center is disabled');
      return;
    }
    next();
  });
  router.use('/email-center', requireLogin);

  router.get('/email-center', async (req, res, next) => {
    try {
      const folder = emailFolder(String(req.query.folder || 'pending'));
      const { mailbox, mailboxes } = await resolveVisibleEmailMailbox(
        dependencies,
        req.currentUser,
        req.query.mailbox
      );
      const threads = mailbox
        ? await listVisibleEmailThreads(
            dependencies,
            req.currentUser,
            emailFolderFilter(folder, mailbox.key)
          )
        : [];
      const spamCleanup = folder === 'spam' && mailbox && canPurgeEmailSpam(req.currentUser)
        ? await getEmailSpamCleanupSummary(dependencies, req.currentUser, mailbox.key)
        : null;
      res.render('email-center/index', {
        threads,
        folder,
        mailbox,
        mailboxes,
        spamCleanup,
        spamCleanupResult: {
          purgedThreads: Number(req.query.purgedThreads || 0),
          purgedMessages: Number(req.query.purgedMessages || 0),
          purgedBytes: Number(req.query.purgedBytes || 0),
          fileFailures: Number(req.query.fileFailures || 0)
        },
        formatEmailListDate
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/threads/:threadId', async (req, res, next) => {
    try {
      const thread = await getVisibleEmailThread(dependencies, req.currentUser, req.params.threadId);
      const backFolder = emailFolder(String(req.query.from || 'pending'));
      const backMailbox = String(req.query.mailbox || thread.mailboxKey || '').trim().toLowerCase();
      const canTriage = ['pending', 'outbound_only'].includes(thread.triageStatus || 'pending');
      const linkableOpportunities = thread.opportunityId || !canTriage
        ? []
        : await listEmailLinkableOpportunities(dependencies, req.currentUser);
      const linkableInquiries = thread.inquiryId || !canTriage
        ? []
        : await listEmailLinkableInquiries(dependencies, req.currentUser);
      const triageAssignees = (thread.triageStatus || 'pending') === 'pending'
        ? await listEmailTriageAssignees(dependencies, req.currentUser, thread)
        : [];
      const canDeleteThread = await canPurgeEmailThread(
        dependencies,
        req.currentUser,
        thread.id
      );
      res.render('email-center/detail', {
        thread,
        formatEmailListDate,
        backFolder,
        backMailbox,
        canTriage,
        canDeleteThread,
        canTriageInquiry: canAccessInquiryInbox(req.currentUser),
        linkableOpportunities,
        linkableInquiries,
        triageAssignees
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/threads/:threadId/opportunity', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      await linkEmailThreadToOpportunity(
        dependencies,
        req.currentUser,
        req.params.threadId,
        req.body.opportunityId
      );
      res.redirect(threadRedirect(req.params.threadId, req.body));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/threads/:threadId/inquiry', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      await linkEmailThreadToInquiry(
        dependencies,
        req.currentUser,
        req.params.threadId,
        req.body.inquiryId
      );
      res.redirect(threadRedirect(req.params.threadId, req.body));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/threads/:threadId/convert-inquiry', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      const result = await convertEmailThreadToInquiry(
        dependencies,
        req.currentUser,
        req.params.threadId
      );
      res.redirect(`/inquiries/${result.inquiry.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/threads/:threadId/disposition', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      await setEmailThreadDisposition(
        dependencies,
        req.currentUser,
        req.params.threadId,
        req.body.action,
        req.body.note
      );
      res.redirect(threadRedirect(req.params.threadId, req.body));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/threads/:threadId/assignment', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      await assignEmailThreadTriage(
        dependencies,
        req.currentUser,
        req.params.threadId,
        req.body.assignedUserId
      );
      res.redirect(threadRedirect(req.params.threadId, req.body));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/spam/purge', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      const mailboxKey = String(req.body.mailbox || '').trim().toLowerCase();
      const result = await purgeEligibleEmailSpam(dependencies, req.currentUser, {
        mailboxKey,
        confirmation: req.body.confirmation
      });
      const query = new URLSearchParams({
        mailbox: mailboxKey,
        folder: 'spam',
        purgedThreads: String(result.purgedThreads),
        purgedMessages: String(result.purgedMessages),
        purgedBytes: String(result.purgedBytes),
        fileFailures: String(result.fileFailures.length)
      });
      res.redirect(`/email-center?${query.toString()}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/threads/:threadId/purge', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      await purgeEmailThread(dependencies, req.currentUser, req.params.threadId, {
        confirmation: req.body.confirmation
      });
      const query = new URLSearchParams();
      const mailboxKey = String(req.body.mailbox || '').trim().toLowerCase();
      if (mailboxKey) query.set('mailbox', mailboxKey);
      query.set('folder', emailFolder(String(req.body.from || 'pending')));
      res.redirect(`/email-center?${query.toString()}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/compose', async (req, res, next) => {
    if (!sendingEnabled) return res.status(404).send('Customer email sending is disabled');
    try {
      const context = await getCustomerEmailComposeContext(dependencies, req.currentUser, req.query);
      res.render('email-center/compose', { context, maxUploadMb });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/messages', (req, res, next) => {
    if (!sendingEnabled) return res.status(404).send('Customer email sending is disabled');
    upload.array('attachments', 10)(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).send(`Email attachment exceeds ${maxUploadMb} MB`);
      }
      next(error);
    });
  }, async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      const message = await createCustomerEmailDraft(dependencies, req.currentUser, req.body, req.files || []);
      res.redirect(`/email-center/threads/${message.threadId}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/email-center/messages/:messageId/send', async (req, res, next) => {
    if (!sendingEnabled) return res.status(404).send('Customer email sending is disabled');
    try {
      const message = await sendCustomerEmail(dependencies, req.currentUser, req.params.messageId);
      res.redirect(`/email-center/threads/${message.threadId}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const { attachment } = await getVisibleEmailAttachment(
        dependencies,
        req.currentUser,
        req.params.attachmentId
      );
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!filePath) {
        res.status(404).send('Email attachment file not found');
        return;
      }
      res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.originalName));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Archive-SHA256', attachment.sha256);
      res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
