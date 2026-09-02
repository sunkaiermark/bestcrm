import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { SALES_LEAD_SOURCE_CHANNELS } from '../domain/inquiries.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import {
  canSubmitNewLead,
  canViewOwnLeadSubmission,
  leadSubmissionListFilterFor,
  listEligibleReviewManagers,
  submitSalesLead
} from '../services/leadSubmissionService.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';
import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

function currentUploadSubdir() {
  const now = new Date();
  return path.join('lead-submissions', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
}

function createUploadMiddleware(uploadDir, maxUploadMb) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      const destination = path.join(resolvedUploadDir, currentUploadSubdir());
      mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename(req, file, callback) {
      callback(null, `${randomUUID()}${path.extname(file.originalname || '')}`);
    }
  });
  return multer({ storage, limits: { fileSize: maxUploadMb * 1024 * 1024 } });
}

function storedPathForFile(uploadDir, file) {
  return path.relative(path.resolve(uploadDir), file.path).split(path.sep).join('/');
}

async function removeUploadedFile(file) {
  if (file?.path) {
    await rm(file.path, { force: true });
  }
}

async function loadOwnSubmission(inquiryRepository, actor, id) {
  const inquiry = await inquiryRepository.findById(id);
  return canViewOwnLeadSubmission(actor, inquiry) ? inquiry : null;
}

function handleLeadError(error, res, next) {
  if (error.message === 'Forbidden') {
    res.status(403).send('Forbidden');
    return;
  }
  if (['Requirement is required', 'Company or contact is required', 'Sales manager is required', 'Invalid submission token'].includes(error.message)) {
    res.status(400).send(error.message);
    return;
  }
  next(error);
}

export function leadSubmissionRoutes({
  inquiryRepository,
  inquiryAttachmentRepository,
  userRepository,
  uploadDir = './var/uploads',
  maxUploadMb = 3072
}) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir, maxUploadMb);

  router.use('/lead-submissions', requireLogin);
  router.use('/lead-submissions', (req, res, next) => {
    if (!canSubmitNewLead(req.currentUser)) {
      res.status(403).send('Forbidden');
      return;
    }
    next();
  });

  router.get('/lead-submissions', async (req, res, next) => {
    try {
      const submissions = await inquiryRepository.listInquiries(leadSubmissionListFilterFor(req.currentUser));
      res.render('lead-submissions/index', { submissions });
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.get('/lead-submissions/new', async (req, res, next) => {
    try {
      const users = await userRepository.listUsersWithRoles();
      const reviewManagers = listEligibleReviewManagers(users);
      res.render('lead-submissions/form', {
        submission: { priority: 'normal', sourceChannel: 'other' },
        submissionToken: randomUUID(),
        sourceChannels: SALES_LEAD_SOURCE_CHANNELS,
        countryOptions: CUSTOMER_COUNTRIES,
        reviewManagers,
        maxUploadMb
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/lead-submissions', (req, res, next) => {
    upload.single('attachment')(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).send(req.language === 'zh'
          ? `文件超过 ${maxUploadMb} MB 上传限制`
          : `File exceeds the ${maxUploadMb} MB upload limit`);
        return;
      }
      next(error);
    });
  }, async (req, res, next) => {
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        await removeUploadedFile(req.file);
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const inquiry = await submitSalesLead({ inquiryRepository, userRepository }, req.currentUser, req.body);
      if (req.file && !inquiry.wasDuplicate) {
        await inquiryAttachmentRepository.createAttachment({
          inquiryId: inquiry.id,
          sourceIndex: 0,
          originalName: normalizeUploadedFilename(req.file.originalname),
          storedPath: storedPathForFile(uploadDir, req.file),
          mimeType: req.file.mimetype || 'application/octet-stream',
          fileSize: req.file.size,
          cid: ''
        });
      } else if (req.file) {
        await removeUploadedFile(req.file);
      }
      res.redirect(`/lead-submissions/${inquiry.id}`);
    } catch (error) {
      await removeUploadedFile(req.file);
      handleLeadError(error, res, next);
    }
  });

  router.get('/lead-submissions/:id', async (req, res, next) => {
    try {
      const submission = await loadOwnSubmission(inquiryRepository, req.currentUser, req.params.id);
      if (!submission) {
        res.status(404).send('Lead submission not found');
        return;
      }
      const attachments = await inquiryAttachmentRepository.listByInquiry(submission.id);
      res.render('lead-submissions/detail', { submission, attachments });
    } catch (error) {
      next(error);
    }
  });

  router.get('/lead-submissions/:id/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const submission = await loadOwnSubmission(inquiryRepository, req.currentUser, req.params.id);
      if (!submission) {
        res.status(404).send('Lead submission not found');
        return;
      }
      const attachment = await inquiryAttachmentRepository.findById(req.params.attachmentId);
      if (!attachment || Number(attachment.inquiryId) !== Number(submission.id)) {
        res.status(404).send('Attachment not found');
        return;
      }
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!filePath) {
        res.status(400).send('Invalid attachment path');
        return;
      }
      const content = await readFile(filePath);
      res.type(attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.originalName));
      res.send(content);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
