import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';
import {
  EmailArchiveError,
  getVisibleEmailAttachment,
  getVisibleEmailThread,
  listVisibleEmailThreads
} from '../services/emailArchiveService.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';

function handleError(error, res, next) {
  if (error instanceof EmailArchiveError || Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode || 400).send(error.message);
    return;
  }
  next(error);
}

export function emailCenterRoutes({
  enabled = false,
  emailArchiveRepository,
  opportunityRepository,
  opportunityResponsibilityRepository,
  uploadDir = './var/uploads'
}) {
  const router = Router();
  const dependencies = {
    emailArchiveRepository,
    opportunityRepository,
    opportunityResponsibilityRepository
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
      const threads = await listVisibleEmailThreads(dependencies, req.currentUser);
      res.render('email-center/index', { threads });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/email-center/threads/:threadId', async (req, res, next) => {
    try {
      const thread = await getVisibleEmailThread(dependencies, req.currentUser, req.params.threadId);
      res.render('email-center/detail', { thread });
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
