import { Router } from 'express';
import multer from 'multer';
import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { simpleParser } from 'mailparser';
import { requireLogin } from '../middleware/auth.mjs';
import { attachmentContentDisposition, inlineContentDisposition } from '../utils/contentDisposition.mjs';
import { formatPlainEmailForReading, resolveInlineEmailContent } from '../utils/emailPresentation.mjs';
import {
  canPurgeEmailThread,
  canPurgeEmailSpam,
  canReclassifyOrphanedConvertedInquiryAsSpam,
  EmailArchiveError,
  getEmailCleanupSummary,
  getVisibleEmailAttachment,
  getVisibleEmailMessage,
  getVisibleEmailThread,
  linkEmailThreadToOpportunity,
  listEmailLinkableOpportunities,
  purgeEmailThread,
  purgeEligibleEmailFolder,
  resolveVisibleEmailMailbox,
  setEmailThreadDisposition,
  listVisibleEmailThreads
} from '../services/emailArchiveService.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import { canSubmitNewLead } from '../services/leadSubmissionService.mjs';
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
  return ['pending', 'inbox', 'sent', 'spam', 'non_business'].includes(value) ? value : 'pending';
}

function emailSearchTerm(value) {
  return String(value || '').trim().slice(0, 200);
}

function emailFolderFilter(folder, mailboxKey, searchTerm = '') {
  const base = {
    mailboxKey,
    classificationCategory: ''
  };
  if (folder === 'pending') return {
    ...base,
    archiveDisposition: 'active',
    triageStatus: 'pending',
    direction: 'inbound'
  };
  if (folder === 'inbox') return {
    ...base,
    archiveDisposition: 'active',
    triageStatuses: [
      'linked_opportunity',
      'linked_lead',
      'converted_lead',
      'linked_inquiry',
      'converted_inquiry'
    ],
    direction: 'inbound',
    searchTerm: emailSearchTerm(searchTerm)
  };
  if (folder === 'sent') return { ...base, archiveDisposition: 'active', direction: 'outbound' };
  if (folder === 'non_business') return { ...base, archiveDisposition: 'archived', triageStatus: 'archived' };
  return { ...base, archiveDisposition: 'spam', triageStatus: 'spam' };
}

function cleanupFolder(value) {
  return value === 'non_business' ? 'non_business' : 'spam';
}

function threadRedirect(threadId, body = {}) {
  const query = new URLSearchParams();
  const mailbox = String(body.mailbox || '').trim().toLowerCase();
  if (mailbox) query.set('mailbox', mailbox);
  const from = emailFolder(String(body.from || 'pending'));
  query.set('from', from);
  const searchTerm = from === 'inbox' ? emailSearchTerm(body.q) : '';
  if (searchTerm) query.set('q', searchTerm);
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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function archivedBodyWasTruncated(message) {
  return String(message?.htmlBody || '').includes('<!-- truncated -->')
    || String(message?.textBody || '').endsWith('\n[truncated]');
}

async function completeArchivedBody(message, uploadDir) {
  const fallback = {
    htmlBody: String(message.htmlBody || ''),
    textBody: String(message.textBody || ''),
    source: 'parsed-archive'
  };
  if (!archivedBodyWasTruncated(message) || !message.rawEmlStoredPath) return fallback;
  const rawPath = resolveStoredPath(uploadDir, message.rawEmlStoredPath);
  if (!rawPath) return fallback;
  try {
    const raw = await readFile(rawPath);
    if (message.rawEmlSha256
        && createHash('sha256').update(raw).digest('hex') !== message.rawEmlSha256) {
      return fallback;
    }
    const parsed = await simpleParser(raw);
    return {
      htmlBody: typeof parsed.html === 'string' ? parsed.html : '',
      textBody: typeof parsed.text === 'string' ? parsed.text : fallback.textBody,
      source: 'raw-archive'
    };
  } catch {
    return fallback;
  }
}

function emailHtmlDocument(htmlBody, textBody) {
  const safeBody = htmlBody
    ? String(htmlBody)
      .replace(/<base\b[^>]*>/gi, '')
      .replace(/<meta\b[^>]*http-equiv\s*=\s*(["']?)refresh\1[^>]*>/gi, '')
    : `<pre class="email-text-only">${escapeHtml(textBody)}</pre>`;
  const style = `<style>
    html{color:#172333;background:#fff;font:16px/1.55 Arial,sans-serif}
    body{box-sizing:border-box;margin:0;padding:18px;overflow-wrap:anywhere;overflow-x:auto}
    img{height:auto;max-width:100%}
    img[alt="SUNKAIER"]{height:auto!important;max-height:36px;max-width:245px;width:245px}
    img[data-email-inline-missing="true"]{display:none!important}
    table{max-width:100%}
    pre{white-space:pre-wrap}
    pre.email-text-only{font:inherit;margin:0}
    blockquote{border-left:3px solid #d7e0e8;margin-left:0;padding-left:12px}
  </style>`;
  if (/<head(?:\s[^>]*)?>/i.test(safeBody)) {
    return safeBody.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${style}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(safeBody)) {
    return safeBody.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${style}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${safeBody}</body></html>`;
}

export function emailCenterRoutes({
  enabled = false,
  emailArchiveRepository,
  customerRepository,
  contactRepository,
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
    customerRepository,
    contactRepository,
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
      const searchTerm = folder === 'inbox' ? emailSearchTerm(req.query.q) : '';
      const { mailbox, mailboxes } = await resolveVisibleEmailMailbox(
        dependencies,
        req.currentUser,
        req.query.mailbox
      );
      const threads = mailbox
        ? await listVisibleEmailThreads(
            dependencies,
            req.currentUser,
            emailFolderFilter(folder, mailbox.key, searchTerm)
          )
        : [];
      const cleanup = ['spam', 'non_business'].includes(folder) && mailbox && canPurgeEmailSpam(req.currentUser)
        ? await getEmailCleanupSummary(dependencies, req.currentUser, mailbox.key, folder)
        : null;
      const canManageEmailCleanup = canPurgeEmailSpam(req.currentUser);
      res.render('email-center/index', {
        threads,
        folder,
        searchTerm,
        mailbox,
        mailboxes,
        cleanup,
        canManageEmailCleanup,
        cleanupResult: {
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
      const backSearchTerm = backFolder === 'inbox' ? emailSearchTerm(req.query.q) : '';
      const canTriage = ['pending', 'outbound_only'].includes(thread.triageStatus || 'pending');
      const canReclassifyAsSpam = await canReclassifyOrphanedConvertedInquiryAsSpam(
        dependencies,
        req.currentUser,
        thread
      );
      const linkableOpportunities = thread.opportunityId || !canTriage
        ? []
        : await listEmailLinkableOpportunities(dependencies, req.currentUser);
      const canManageEmailCleanup = canPurgeEmailSpam(req.currentUser);
      const canDeleteThread = await canPurgeEmailThread(
        dependencies,
        req.currentUser,
        thread.id
      );
      res.render('email-center/detail', {
        thread,
        formatEmailListDate,
        formatPlainEmailForReading,
        backFolder,
        backMailbox,
        backSearchTerm,
        canTriage,
        canReclassifyAsSpam,
        canManageEmailCleanup,
        canDeleteThread,
        canCreateLead: canSubmitNewLead(req.currentUser),
        linkableOpportunities
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

  router.post('/email-center/:cleanupFolder(spam|non_business)/purge', async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        return res.status(403).send('Invalid CSRF token');
      }
      const mailboxKey = String(req.body.mailbox || '').trim().toLowerCase();
      const folder = cleanupFolder(req.params.cleanupFolder);
      const result = await purgeEligibleEmailFolder(dependencies, req.currentUser, {
        mailboxKey,
        folder,
        confirmation: req.body.confirmation
      });
      const query = new URLSearchParams({
        mailbox: mailboxKey,
        folder,
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
      const folder = emailFolder(String(req.body.from || 'pending'));
      query.set('folder', folder);
      const searchTerm = folder === 'inbox' ? emailSearchTerm(req.body.q) : '';
      if (searchTerm) query.set('q', searchTerm);
      res.redirect(`/email-center?${query.toString()}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/compose', async (req, res, next) => {
    if (!sendingEnabled) return res.status(404).send('Customer email sending is disabled');
    try {
      const context = await getCustomerEmailComposeContext(dependencies, req.currentUser, req.query);
      res.render('email-center/compose', { context, maxUploadMb, formatPlainEmailForReading });
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

  router.get('/email-center/attachments/:attachmentId/inline', async (req, res, next) => {
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
      res.setHeader('Content-Disposition', inlineContentDisposition(attachment.originalName));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('X-Archive-SHA256', attachment.sha256);
      res.sendFile(filePath, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/messages/:messageId/content', async (req, res, next) => {
    try {
      const message = await getVisibleEmailMessage(dependencies, req.currentUser, req.params.messageId);
      const completeBody = await completeArchivedBody(message, uploadDir);
      if (!completeBody.htmlBody && !completeBody.textBody) {
        res.status(404).send('Email content not found');
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Email-Content-Source', completeBody.source);
      res.setHeader(
        'Content-Security-Policy',
        "sandbox allow-same-origin; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
      );
      const htmlBody = resolveInlineEmailContent(completeBody.htmlBody, message.attachments);
      res.send(emailHtmlDocument(htmlBody, completeBody.textBody));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
