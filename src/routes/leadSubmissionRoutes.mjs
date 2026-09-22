import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { SALES_LEAD_SOURCE_CHANNELS } from '../domain/inquiries.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import {
  inspectStoredAttachmentFile,
  resolveStoredPath
} from '../services/attachmentFileService.mjs';
import {
  convertEmailThreadToLead,
  EmailArchiveError,
  getEmailThreadIntakeContext
} from '../services/emailArchiveService.mjs';
import {
  CustomerApprovalRequiredError
} from '../services/inquiryService.mjs';
import { DuplicateContactError } from '../services/contactService.mjs';
import { DuplicateCustomerError } from '../services/customerService.mjs';
import { canViewOpportunity } from '../services/opportunityService.mjs';
import {
  approveSalesLead,
  canReassignLeadReviewer,
  canResubmitLeadSubmission,
  canReviewLeadSubmission,
  canSubmitNewLead,
  canViewLeadSubmission,
  leadSubmissionListFilterFor,
  listEligibleReviewManagers,
  listEligibleSalespeople,
  reassignLeadReviewer,
  rejectSalesLead,
  resubmitSalesLead,
  returnSalesLead,
  submitSalesLead
} from '../services/leadSubmissionService.mjs';
import { attachmentPreviewKind, extractDocxPlainText, renderDxfPreview } from '../utils/attachmentPreview.mjs';
import { attachmentContentDisposition, inlineContentDisposition } from '../utils/contentDisposition.mjs';
import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

const MAX_LEAD_ATTACHMENTS_PER_SUBMISSION = 10;

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
  return multer({
    storage,
    limits: {
      fileSize: maxUploadMb * 1024 * 1024,
      files: MAX_LEAD_ATTACHMENTS_PER_SUBMISSION
    }
  });
}

function storedPathForFile(uploadDir, file) {
  return path.relative(path.resolve(uploadDir), file.path).split(path.sep).join('/');
}

function uploadedFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files || {}).flat();
}

async function removeUploadedFiles(files = []) {
  await Promise.all(files.map(async (file) => {
    if (file?.path) {
      await rm(file.path, { force: true });
    }
  }));
}

async function loadVisibleSubmission(dependencies, actor, id) {
  const inquiry = await dependencies.inquiryRepository.findById(id);
  if (canViewLeadSubmission(actor, inquiry)) return inquiry;
  if (!inquiry?.convertedOpportunityId
      || typeof dependencies.opportunityRepository?.getOpportunityDetail !== 'function') {
    return null;
  }
  const opportunity = await dependencies.opportunityRepository.getOpportunityDetail(
    inquiry.convertedOpportunityId
  );
  if (!opportunity) return null;
  const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
    ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    : [];
  return canViewOpportunity(actor, { ...opportunity, teamMembers }) ? inquiry : null;
}

function leadListView(value) {
  return value === 'processed' ? 'processed' : 'active';
}

function csrfValid(req) {
  return !req.csrfProtectionEnabled || Boolean(req.validateCsrf?.());
}

async function loadLeadFormOptions(dependencies, actor) {
  const users = typeof dependencies.userRepository?.listUsersWithRoles === 'function'
    ? await dependencies.userRepository.listUsersWithRoles()
    : [];
  return {
    users,
    reviewManagers: listEligibleReviewManagers(users),
    salespeople: listEligibleSalespeople(users),
    showSalesOwnerField: !hasRole(actor, ROLES.SALESPERSON)
  };
}

async function renderLeadDetailPage(dependencies, req, res, submission) {
  const [attachments, reviewEvents, formOptions] = await Promise.all([
    dependencies.inquiryAttachmentRepository.listByInquiry(submission.id),
    typeof dependencies.inquiryRepository.listLeadReviewEvents === 'function'
      ? dependencies.inquiryRepository.listLeadReviewEvents(submission.id)
      : [],
    loadLeadFormOptions(dependencies, req.currentUser)
  ]);
  const canReview = canReviewLeadSubmission(req.currentUser, submission);
  const [customers, contacts] = canReview
    ? await Promise.all([
        typeof dependencies.customerRepository?.listCustomers === 'function'
          ? dependencies.customerRepository.listCustomers({})
          : [],
        typeof dependencies.contactRepository?.listContacts === 'function'
          ? dependencies.contactRepository.listContacts({})
          : []
      ])
    : [[], []];
  res.render('lead-submissions/detail', {
    submission,
    attachments,
    reviewEvents,
    customers,
    contacts,
    countryOptions: CUSTOMER_COUNTRIES,
    ...formOptions,
    canReview,
    canResubmit: canResubmitLeadSubmission(req.currentUser, submission),
    canReassign: canReassignLeadReviewer(req.currentUser, submission),
    isEmailLead: submission.sourceChannel === 'email'
      || Number(submission.rawPayload?.emailThreadId) > 0
  });
}

function handleLeadError(error, res, next) {
  if (error instanceof EmailArchiveError || Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode || 400).send(error.message);
    return;
  }
  if (error.message === 'Forbidden') {
    res.status(403).send('Forbidden');
    return;
  }
  if ([
    'Requirement is required',
    'Company or contact is required',
    'Sales manager is required',
    'Sales owner is required',
    'Invalid submission token',
    'Decision reason is required',
    'Email disposition is required',
    'Customer is required',
    'Customer name is required',
    'Contact name is required',
    'Contact does not belong to customer'
  ].includes(error.message)) {
    res.status(400).send(error.message);
    return;
  }
  if (['Lead submission not found', 'Customer not found', 'Contact not found'].includes(error.message)) {
    res.status(404).send(error.message);
    return;
  }
  if (error instanceof DuplicateCustomerError
      || error instanceof DuplicateContactError
      || error instanceof CustomerApprovalRequiredError
      || [
        'Lead already processed',
        'Source email is already linked to another opportunity',
        'Source email link changed; refresh and try again',
        'Source email triage changed; refresh and try again'
      ].includes(error.message)) {
    res.status(409).send(error.message);
    return;
  }
  next(error);
}

export function leadSubmissionRoutes({
  inquiryRepository,
  inquiryAttachmentRepository,
  userRepository,
  customerRepository = null,
  contactRepository = null,
  emailArchiveRepository = null,
  opportunityRepository = null,
  opportunityResponsibilityRepository = null,
  emailArchiveTransaction = null,
  sharedAddress = 'sales@sunkaier.com',
  uploadDir = './var/uploads',
  maxUploadMb = 3072
}) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir, maxUploadMb);
  const receiveLeadAttachments = (req, res, next) => {
    upload.fields([
      { name: 'attachments', maxCount: MAX_LEAD_ATTACHMENTS_PER_SUBMISSION },
      { name: 'attachment', maxCount: 1 }
    ])(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).send(req.language === 'zh'
          ? `单个文件超过 ${maxUploadMb} MB 上传限制`
          : `A file exceeds the ${maxUploadMb} MB upload limit`);
        return;
      }
      if (error instanceof multer.MulterError
          && ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code)) {
        res.status(400).send(req.language === 'zh'
          ? `每次最多上传 ${MAX_LEAD_ATTACHMENTS_PER_SUBMISSION} 个附件`
          : `Upload no more than ${MAX_LEAD_ATTACHMENTS_PER_SUBMISSION} attachments at a time`);
        return;
      }
      next(error);
    });
  };

  async function persistLeadAttachments(inquiryId, files, retainedPaths) {
    if (!files.length) return [];
    const existing = await inquiryAttachmentRepository.listByInquiry(inquiryId);
    let sourceIndex = existing.reduce(
      (highest, attachment) => Math.max(highest, Number(attachment.sourceIndex) || 0),
      -1
    ) + 1;
    const created = [];
    for (const file of files) {
      const storedPath = storedPathForFile(uploadDir, file);
      const inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
      const attachment = await inquiryAttachmentRepository.createAttachment({
        inquiryId,
        sourceIndex,
        originalName: normalizeUploadedFilename(file.originalname),
        storedPath,
        mimeType: file.mimetype || 'application/octet-stream',
        fileSize: inspected.fileSize,
        cid: '',
        sha256: inspected.sha256
      });
      if (!attachment) {
        throw new Error('Attachment could not be recorded');
      }
      retainedPaths.add(file.path);
      created.push(attachment);
      sourceIndex += 1;
    }
    return created;
  }
  const emailDependencies = {
    emailArchiveRepository,
    inquiryRepository,
    userRepository,
    opportunityRepository,
    opportunityResponsibilityRepository,
    emailArchiveTransaction,
    sharedAddress
  };
  const dependencies = {
    ...emailDependencies,
    inquiryAttachmentRepository,
    customerRepository,
    contactRepository
  };

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
      const view = leadListView(req.query.view);
      const submissions = await inquiryRepository.listInquiries(
        leadSubmissionListFilterFor(req.currentUser, view)
      );
      res.render('lead-submissions/index', {
        view,
        submissions: submissions.map((submission) => ({
          ...submission,
          canReview: canReviewLeadSubmission(req.currentUser, submission),
          canResubmit: canResubmitLeadSubmission(req.currentUser, submission)
        }))
      });
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.get('/lead-submissions/new', async (req, res, next) => {
    try {
      const { reviewManagers, salespeople, showSalesOwnerField } = await loadLeadFormOptions(
        dependencies,
        req.currentUser
      );
      const emailThreadId = Number(req.query.emailThreadId || 0);
      const emailContext = Number.isInteger(emailThreadId) && emailThreadId > 0
        ? await getEmailThreadIntakeContext(emailDependencies, req.currentUser, emailThreadId)
        : null;
      const submission = emailContext
        ? {
            ...emailContext.draft,
            priority: 'normal',
            recommendedSalespersonId: emailContext.draft.salespersonId || null
          }
        : { priority: 'normal', sourceChannel: 'other' };
      res.render('lead-submissions/form', {
        submission,
        attachments: [],
        emailThreadId: emailContext?.thread.id || null,
        submissionToken: randomUUID(),
        sourceChannels: SALES_LEAD_SOURCE_CHANNELS,
        countryOptions: CUSTOMER_COUNTRIES,
        reviewManagers,
        salespeople,
        showSalesOwnerField,
        isResubmission: false,
        formAction: '/lead-submissions',
        maxUploadMb,
        maxAttachmentCount: MAX_LEAD_ATTACHMENTS_PER_SUBMISSION
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/lead-submissions', receiveLeadAttachments, async (req, res, next) => {
    const files = uploadedFiles(req);
    const retainedPaths = new Set();
    try {
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        await removeUploadedFiles(files);
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const emailThreadId = Number(req.body.emailThreadId || 0);
      const inquiry = Number.isInteger(emailThreadId) && emailThreadId > 0
        ? (await convertEmailThreadToLead(
            emailDependencies,
            req.currentUser,
            emailThreadId,
            req.body
          )).lead
        : await submitSalesLead({ inquiryRepository, userRepository }, req.currentUser, req.body);
      if (files.length && !inquiry.wasDuplicate) {
        await persistLeadAttachments(inquiry.id, files, retainedPaths);
      } else if (files.length) {
        await removeUploadedFiles(files);
      }
      res.redirect(`/lead-submissions/${inquiry.id}`);
    } catch (error) {
      await removeUploadedFiles(files.filter((file) => !retainedPaths.has(file.path)));
      handleLeadError(error, res, next);
    }
  });

  router.get('/lead-submissions/:id', async (req, res, next) => {
    try {
      const submission = await loadVisibleSubmission(dependencies, req.currentUser, req.params.id);
      if (!submission) {
        res.status(404).send('Lead submission not found');
        return;
      }
      await renderLeadDetailPage(dependencies, req, res, submission);
    } catch (error) {
      next(error);
    }
  });

  router.get('/lead-submissions/:id/edit', async (req, res, next) => {
    try {
      const submission = await loadVisibleSubmission(dependencies, req.currentUser, req.params.id);
      if (!submission) {
        res.status(404).send('Lead submission not found');
        return;
      }
      if (!canResubmitLeadSubmission(req.currentUser, submission)) {
        res.status(403).send('Forbidden');
        return;
      }
      const { reviewManagers, salespeople, showSalesOwnerField } = await loadLeadFormOptions(
        dependencies,
        req.currentUser
      );
      const attachments = await inquiryAttachmentRepository.listByInquiry(submission.id);
      res.render('lead-submissions/form', {
        submission,
        attachments,
        emailThreadId: null,
        submissionToken: '',
        sourceChannels: SALES_LEAD_SOURCE_CHANNELS,
        countryOptions: CUSTOMER_COUNTRIES,
        reviewManagers,
        salespeople,
        showSalesOwnerField,
        isResubmission: true,
        formAction: `/lead-submissions/${submission.id}/resubmit`,
        maxUploadMb,
        maxAttachmentCount: MAX_LEAD_ATTACHMENTS_PER_SUBMISSION
      });
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/resubmit', receiveLeadAttachments, async (req, res, next) => {
    const files = uploadedFiles(req);
    const retainedPaths = new Set();
    try {
      if (!csrfValid(req)) {
        await removeUploadedFiles(files);
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const submission = await resubmitSalesLead(
        dependencies,
        req.currentUser,
        req.params.id,
        req.body
      );
      await persistLeadAttachments(submission.id, files, retainedPaths);
      res.redirect(`/lead-submissions/${submission.id}`);
    } catch (error) {
      await removeUploadedFiles(files.filter((file) => !retainedPaths.has(file.path)));
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/approve', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const opportunity = await approveSalesLead(
        dependencies,
        req.currentUser,
        req.params.id,
        req.body
      );
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/return', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      await returnSalesLead(dependencies, req.currentUser, req.params.id, req.body.reason);
      res.redirect(`/lead-submissions/${req.params.id}`);
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/reject', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      await rejectSalesLead(dependencies, req.currentUser, req.params.id, req.body);
      res.redirect('/lead-submissions?view=processed');
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/reassign', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      await reassignLeadReviewer(dependencies, req.currentUser, req.params.id, req.body);
      res.redirect(`/lead-submissions/${req.params.id}`);
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  async function sendLeadAttachment(req, res, next, disposition) {
    try {
      const submission = await loadVisibleSubmission(dependencies, req.currentUser, req.params.id);
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
        res.status(404).send('Attachment not found');
        return;
      }
      if (disposition === 'download') {
        res.type(attachment.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.originalName));
        res.sendFile(filePath);
        return;
      }
      const kind = attachmentPreviewKind(attachment);
      const downloadUrl = `/lead-submissions/${submission.id}/attachments/${attachment.id}/download`;
      const previewContext = {
        activeNav: 'lead-submissions',
        attachment,
        downloadUrl,
        contextLabelKey: 'myLeadSubmissions',
        contextText: submission.subject || submission.companyName
          || `${res.locals.t('leadSubmissionReceipt')} #${submission.id}`,
        backUrl: `/lead-submissions/${submission.id}`,
        backLabelKey: 'backToList'
      };
      if (kind === 'unsupported-dwg') {
        res.status(200).render('attachments/unsupported-preview', {
          ...previewContext,
          messageKey: 'dwgPreviewRequiresDxfOrPdf'
        });
        return;
      }
      if (kind === 'unsupported-doc') {
        res.status(200).render('attachments/unsupported-preview', {
          ...previewContext,
          messageKey: 'docPreviewRequiresDocx'
        });
        return;
      }
      if (kind === 'dxf') {
        const dxfText = await readFile(filePath, 'utf8');
        res.status(200).render('attachments/dxf-preview', {
          ...previewContext,
          preview: renderDxfPreview(dxfText)
        });
        return;
      }
      if (kind === 'docx') {
        const docxBuffer = await readFile(filePath);
        res.status(200).render('attachments/docx-preview', {
          ...previewContext,
          paragraphs: extractDocxPlainText(docxBuffer)
        });
        return;
      }
      if (kind === 'download-only') {
        res.status(200).render('attachments/unsupported-preview', {
          ...previewContext,
          messageKey: 'previewNotAvailableDownload'
        });
        return;
      }
      res.type(attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', inlineContentDisposition(attachment.originalName));
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  router.get('/lead-submissions/:id/attachments/:attachmentId/download', (req, res, next) => {
    sendLeadAttachment(req, res, next, 'download');
  });

  router.get('/lead-submissions/:id/attachments/:attachmentId/preview', (req, res, next) => {
    sendLeadAttachment(req, res, next, 'preview');
  });

  return router;
}
