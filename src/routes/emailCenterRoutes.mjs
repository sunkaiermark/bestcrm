import { Router } from 'express';
import multer from 'multer';
import { randomUUID as nodeRandomUUID } from 'node:crypto';
import { requireLogin } from '../middleware/auth.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';
import {
  EmailArchiveError,
  getVisibleEmailAttachment,
  getVisibleEmailThread,
  listVisibleEmailThreads
} from '../services/emailArchiveService.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
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

function archiveFolder(value) {
  return ['active', 'archived', 'spam', 'all'].includes(value) ? value : 'active';
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
      const folder = archiveFolder(String(req.query.folder || 'active'));
      const threads = await listVisibleEmailThreads(
        dependencies,
        req.currentUser,
        folder === 'all' ? {} : { archiveDisposition: folder }
      );
      res.render('email-center/index', {
        threads,
        folder,
        formatEmailListDate
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/threads/:threadId', async (req, res, next) => {
    try {
      const thread = await getVisibleEmailThread(dependencies, req.currentUser, req.params.threadId);
      const backFolder = archiveFolder(String(req.query.from || 'active'));
      res.render('email-center/detail', { thread, formatEmailListDate, backFolder });
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
