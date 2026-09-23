import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
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
  canEditLeadSubmission,
  canReviewLeadSubmission,
  canSubmitNewLead,
  canViewLeadSubmission,
  leadSubmissionListFilterFor,
  listEligibleQuotationEngineers,
  listEligibleReviewManagers,
  listEligibleSalespeople,
  reassignLeadReviewer,
  rejectSalesLead,
  resubmitSalesLead,
  returnSalesLead,
  submitSalesLead,
  updatePendingSalesLead
} from '../services/leadSubmissionService.mjs';
import {
  attachmentPreviewKind,
  extractDocxPlainText,
  extractXlsxPreview,
  renderDxfPreview
} from '../utils/attachmentPreview.mjs';
import { attachmentContentDisposition, inlineContentDisposition } from '../utils/contentDisposition.mjs';
import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

const MAX_LEAD_ATTACHMENTS_PER_SUBMISSION = 10;
const LEAD_ATTACHMENT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const LEAD_ATTACHMENT_DRAFT_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let lastLeadAttachmentDraftCleanupAt = 0;

function currentUploadSubdir() {
  const now = new Date();
  return path.join('lead-submissions', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
}

function safeUploadExtension(originalName) {
  const extension = path.extname(String(originalName || ''));
  return /^\.[A-Za-z0-9]{1,16}$/.test(extension) ? extension.toLowerCase() : '';
}

function createDraftUploadMiddleware(uploadDir, maxUploadMb) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      const destination = path.join(
        resolvedUploadDir,
        'lead-submissions',
        '.staging',
        String(Number(req.currentUser.id)),
        req.params.draftToken
      );
      mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename(req, file, callback) {
      callback(null, `${randomUUID()}${safeUploadExtension(file.originalname)}`);
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

function draftUploadRoot(uploadDir) {
  return path.join(path.resolve(uploadDir), 'lead-submissions', '.staging');
}

async function cleanupStaleLeadAttachmentDrafts(uploadDir, now = Date.now()) {
  const root = draftUploadRoot(uploadDir);
  let userEntries;
  try {
    userEntries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const cutoff = now - LEAD_ATTACHMENT_DRAFT_TTL_MS;
  for (const userEntry of userEntries) {
    if (!userEntry.isDirectory() || !/^\d+$/.test(userEntry.name)) continue;
    const userDirectory = path.join(root, userEntry.name);
    const draftEntries = await readdir(userDirectory, { withFileTypes: true });
    for (const draftEntry of draftEntries) {
      if (!draftEntry.isDirectory() || !LEAD_ATTACHMENT_DRAFT_TOKEN_PATTERN.test(draftEntry.name)) continue;
      const draftDirectory = path.join(userDirectory, draftEntry.name);
      const draftStat = await stat(draftDirectory);
      if (draftStat.mtimeMs < cutoff) {
        await rm(draftDirectory, { recursive: true, force: true });
      }
    }
  }
}

function scheduleLeadAttachmentDraftCleanup(uploadDir) {
  const now = Date.now();
  if (now - lastLeadAttachmentDraftCleanupAt < 60 * 60 * 1000) return;
  lastLeadAttachmentDraftCleanupAt = now;
  cleanupStaleLeadAttachmentDrafts(uploadDir, now).catch(() => {});
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

function leadAttachmentDrafts(req) {
  if (!req.session.leadAttachmentDrafts || typeof req.session.leadAttachmentDrafts !== 'object') {
    req.session.leadAttachmentDrafts = {};
  }
  return req.session.leadAttachmentDrafts;
}

function leadAttachmentDraft(req, draftToken) {
  if (!LEAD_ATTACHMENT_DRAFT_TOKEN_PATTERN.test(String(draftToken || ''))) return null;
  const draft = req.session?.leadAttachmentDrafts?.[draftToken];
  if (!draft || Number(draft.ownerUserId) !== Number(req.currentUser?.id)) return null;
  return draft;
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function publicDraftAttachment(draftToken, attachment) {
  const baseUrl = `/lead-submissions/attachment-drafts/${draftToken}/${attachment.id}`;
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    previewUrl: `${baseUrl}/preview`,
    downloadUrl: `${baseUrl}/download`,
    removeUrl: `${baseUrl}/remove`
  };
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
    quotationEngineers: listEligibleQuotationEngineers(users),
    reviewManagers: listEligibleReviewManagers(users),
    salespeople: listEligibleSalespeople(users),
    showSalesOwnerField: !hasRole(actor, ROLES.SALESPERSON)
  };
}

async function renderLeadDetailPage(dependencies, req, res, submission, {
  statusCode = 200,
  duplicateCustomers = [],
  approvalInput = {}
} = {}) {
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
  res.status(statusCode).render('lead-submissions/detail', {
    submission,
    attachments,
    reviewEvents,
    customers,
    contacts,
    duplicateCustomers,
    approvalInput,
    countryOptions: CUSTOMER_COUNTRIES,
    ...formOptions,
    canReview,
    canEdit: canEditLeadSubmission(req.currentUser, submission),
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
    'Quotation engineer is required',
    'Quotation engineer is invalid',
    'Lead quotation engineer must be selected',
    'Plan to Submit is required',
    'Plan to Submit must be a valid date',
    'Invalid submission token',
    'Decision reason is required',
    'Email disposition is required',
    'Customer is required',
    'Customer name is required',
    'Contact name is required',
    'Contact does not belong to customer',
    'Attachment upload expired'
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
  attachmentRepository = null,
  opportunityRepository = null,
  opportunityResponsibilityRepository = null,
  workflowEventRepository = null,
  todoRepository = null,
  emailArchiveTransaction = null,
  sharedAddress = 'sales@sunkaier.com',
  uploadDir = './var/uploads',
  maxUploadMb = 3072
}) {
  const router = Router();
  const draftUpload = createDraftUploadMiddleware(uploadDir, maxUploadMb);
  const receiveDraftAttachments = (req, res, next) => {
    draftUpload.array('attachments', MAX_LEAD_ATTACHMENTS_PER_SUBMISSION)(req, res, async (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        await removeUploadedFiles(uploadedFiles(req));
        res.status(413).send(req.language === 'zh'
          ? `单个文件超过 ${maxUploadMb} MB 上传限制`
          : `A file exceeds the ${maxUploadMb} MB upload limit`);
        return;
      }
      if (error instanceof multer.MulterError
          && ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(error.code)) {
        await removeUploadedFiles(uploadedFiles(req));
        res.status(400).send(req.language === 'zh'
          ? `每条线索最多上传 ${MAX_LEAD_ATTACHMENTS_PER_SUBMISSION} 个附件`
          : `Upload no more than ${MAX_LEAD_ATTACHMENTS_PER_SUBMISSION} attachments per lead`);
        return;
      }
      if (error) {
        await removeUploadedFiles(uploadedFiles(req));
      }
      next(error);
    });
  };

  async function issueLeadAttachmentDraft(req) {
    const draftToken = randomUUID();
    leadAttachmentDrafts(req)[draftToken] = {
      ownerUserId: Number(req.currentUser.id),
      createdAt: new Date().toISOString(),
      attachments: []
    };
    await saveSession(req);
    return draftToken;
  }

  async function discardLeadAttachmentDraft(req, draftToken) {
    const draft = leadAttachmentDraft(req, draftToken);
    if (!draft) return;
    delete leadAttachmentDrafts(req)[draftToken];
    await saveSession(req).catch(() => {});
    await rm(path.join(
      draftUploadRoot(uploadDir),
      String(Number(req.currentUser.id)),
      draftToken
    ), { recursive: true, force: true });
  }

  async function finalizeLeadAttachmentDraft(req, inquiryId) {
    const draftToken = String(req.body.attachmentDraftToken || '').trim();
    const draft = leadAttachmentDraft(req, draftToken);
    if (!draft?.attachments?.length) {
      if (draft) await discardLeadAttachmentDraft(req, draftToken);
      return [];
    }
    const sourceFiles = [];
    for (const attachment of draft.attachments) {
      const sourcePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!sourcePath) throw new Error('Attachment upload expired');
      const fileStat = await stat(sourcePath).catch(() => null);
      if (!fileStat?.isFile()) throw new Error('Attachment upload expired');
      sourceFiles.push({ attachment, sourcePath });
    }
    const existing = await inquiryAttachmentRepository.listByInquiry(inquiryId);
    let sourceIndex = existing.reduce(
      (highest, attachment) => Math.max(highest, Number(attachment.sourceIndex) || 0),
      -1
    ) + 1;
    const finalDirectory = path.join(path.resolve(uploadDir), currentUploadSubdir());
    await mkdir(finalDirectory, { recursive: true });
    const movedFiles = [];
    try {
      for (const sourceFile of sourceFiles) {
        const destinationPath = path.join(finalDirectory, path.basename(sourceFile.sourcePath));
        await rename(sourceFile.sourcePath, destinationPath);
        movedFiles.push({ ...sourceFile, destinationPath });
      }
      const inputs = movedFiles.map(({ attachment, destinationPath }) => ({
        inquiryId,
        sourceIndex: sourceIndex++,
        originalName: attachment.originalName,
        storedPath: storedPathForFile(uploadDir, { path: destinationPath }),
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        cid: '',
        sha256: attachment.sha256
      }));
      const created = await inquiryAttachmentRepository.createAttachments(inputs);
      if (created.length !== inputs.length) throw new Error('Attachment could not be recorded');
      delete leadAttachmentDrafts(req)[draftToken];
      await saveSession(req).catch(() => {});
      await rm(path.dirname(sourceFiles[0].sourcePath), { recursive: true, force: true });
      return created;
    } catch (error) {
      await Promise.allSettled(movedFiles.map(async ({ sourcePath, destinationPath }) => {
        await mkdir(path.dirname(sourcePath), { recursive: true });
        await rename(destinationPath, sourcePath);
      }));
      throw error;
    }
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
    attachmentRepository,
    customerRepository,
    contactRepository,
    workflowEventRepository,
    todoRepository,
    uploadDir
  };

  router.use('/lead-submissions', requireLogin);
  router.use('/lead-submissions', (req, res, next) => {
    if (!canSubmitNewLead(req.currentUser)) {
      res.status(403).send('Forbidden');
      return;
    }
    next();
  });

  router.post(
    '/lead-submissions/attachment-drafts/:draftToken',
    (req, res, next) => {
      if (!LEAD_ATTACHMENT_DRAFT_TOKEN_PATTERN.test(req.params.draftToken)) {
        res.status(400).send('Invalid attachment draft token');
        return;
      }
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      if (!leadAttachmentDraft(req, req.params.draftToken)) {
        res.status(404).send('Attachment draft not found');
        return;
      }
      scheduleLeadAttachmentDraftCleanup(uploadDir);
      next();
    },
    receiveDraftAttachments,
    async (req, res, next) => {
      const files = uploadedFiles(req);
      if (!files.length) {
        res.status(400).send(req.language === 'zh' ? '请选择要上传的文件' : 'Select files to upload');
        return;
      }
      const draft = leadAttachmentDraft(req, req.params.draftToken);
      if (draft.attachments.length + files.length > MAX_LEAD_ATTACHMENTS_PER_SUBMISSION) {
        await removeUploadedFiles(files);
        res.status(400).send(req.language === 'zh'
          ? `每条线索最多上传 ${MAX_LEAD_ATTACHMENTS_PER_SUBMISSION} 个附件`
          : `Upload no more than ${MAX_LEAD_ATTACHMENTS_PER_SUBMISSION} attachments per lead`);
        return;
      }
      const newAttachments = [];
      try {
        for (const file of files) {
          const storedPath = storedPathForFile(uploadDir, file);
          const inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
          newAttachments.push({
            id: randomUUID(),
            originalName: normalizeUploadedFilename(file.originalname),
            storedPath,
            mimeType: file.mimetype || 'application/octet-stream',
            fileSize: inspected.fileSize,
            sha256: inspected.sha256,
            uploadedAt: new Date().toISOString()
          });
        }
        draft.attachments.push(...newAttachments);
        draft.updatedAt = new Date().toISOString();
        await saveSession(req);
        res.status(201).json({
          attachments: draft.attachments.map((attachment) => (
            publicDraftAttachment(req.params.draftToken, attachment)
          ))
        });
      } catch (error) {
        draft.attachments.splice(draft.attachments.length - newAttachments.length, newAttachments.length);
        await removeUploadedFiles(files);
        next(error);
      }
    }
  );

  router.post('/lead-submissions/attachment-drafts/:draftToken/:attachmentId/remove', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const draft = leadAttachmentDraft(req, req.params.draftToken);
      const attachmentIndex = draft?.attachments?.findIndex(
        (attachment) => attachment.id === req.params.attachmentId
      ) ?? -1;
      if (!draft || attachmentIndex < 0) {
        res.status(404).send('Attachment not found');
        return;
      }
      const [attachment] = draft.attachments.splice(attachmentIndex, 1);
      draft.updatedAt = new Date().toISOString();
      await saveSession(req);
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (filePath) await rm(filePath, { force: true });
      res.json({
        attachments: draft.attachments.map((item) => publicDraftAttachment(req.params.draftToken, item))
      });
    } catch (error) {
      next(error);
    }
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
          canEdit: canEditLeadSubmission(req.currentUser, submission)
        }))
      });
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.get('/lead-submissions/new', async (req, res, next) => {
    try {
      scheduleLeadAttachmentDraftCleanup(uploadDir);
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
      const attachmentDraftToken = await issueLeadAttachmentDraft(req);
      res.render('lead-submissions/form', {
        submission,
        attachments: [],
        attachmentDraftToken,
        stagedAttachments: [],
        emailThreadId: emailContext?.thread.id || null,
        submissionToken: randomUUID(),
        sourceChannels: SALES_LEAD_SOURCE_CHANNELS,
        countryOptions: CUSTOMER_COUNTRIES,
        reviewManagers,
        salespeople,
        showSalesOwnerField,
        isResubmission: false,
        isPendingEdit: false,
        formAction: '/lead-submissions',
        maxUploadMb,
        maxAttachmentCount: MAX_LEAD_ATTACHMENTS_PER_SUBMISSION
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/lead-submissions', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
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
      if (inquiry.wasDuplicate) {
        await discardLeadAttachmentDraft(req, String(req.body.attachmentDraftToken || ''));
      } else {
        await finalizeLeadAttachmentDraft(req, inquiry.id);
      }
      res.redirect(`/lead-submissions/${inquiry.id}`);
    } catch (error) {
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
      if (!canEditLeadSubmission(req.currentUser, submission)) {
        res.status(403).send('Forbidden');
        return;
      }
      scheduleLeadAttachmentDraftCleanup(uploadDir);
      const { reviewManagers, salespeople, showSalesOwnerField } = await loadLeadFormOptions(
        dependencies,
        req.currentUser
      );
      const attachments = await inquiryAttachmentRepository.listByInquiry(submission.id);
      const attachmentDraftToken = await issueLeadAttachmentDraft(req);
      res.render('lead-submissions/form', {
        submission,
        attachments,
        attachmentDraftToken,
        stagedAttachments: [],
        emailThreadId: null,
        submissionToken: '',
        sourceChannels: SALES_LEAD_SOURCE_CHANNELS,
        countryOptions: CUSTOMER_COUNTRIES,
        reviewManagers,
        salespeople,
        showSalesOwnerField,
        isResubmission: submission.status === 'returned',
        isPendingEdit: submission.status === 'new',
        formAction: submission.status === 'returned'
          ? `/lead-submissions/${submission.id}/resubmit`
          : `/lead-submissions/${submission.id}/update`,
        maxUploadMb,
        maxAttachmentCount: MAX_LEAD_ATTACHMENTS_PER_SUBMISSION
      });
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/update', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const submission = await updatePendingSalesLead(
        dependencies,
        req.currentUser,
        req.params.id,
        req.body
      );
      await finalizeLeadAttachmentDraft(req, submission.id);
      res.redirect(`/lead-submissions/${submission.id}`);
    } catch (error) {
      handleLeadError(error, res, next);
    }
  });

  router.post('/lead-submissions/:id/resubmit', async (req, res, next) => {
    try {
      if (!csrfValid(req)) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      const submission = await resubmitSalesLead(
        dependencies,
        req.currentUser,
        req.params.id,
        req.body
      );
      await finalizeLeadAttachmentDraft(req, submission.id);
      res.redirect(`/lead-submissions/${submission.id}`);
    } catch (error) {
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
      if (error instanceof DuplicateCustomerError) {
        try {
          const submission = await loadVisibleSubmission(
            dependencies,
            req.currentUser,
            req.params.id
          );
          if (!submission) {
            res.status(404).send('Lead submission not found');
            return;
          }
          await renderLeadDetailPage(dependencies, req, res, submission, {
            statusCode: 409,
            duplicateCustomers: error.duplicates,
            approvalInput: req.body
          });
        } catch (renderError) {
          next(renderError);
        }
        return;
      }
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

  async function sendAttachmentContent(res, disposition, attachment, filePath, previewContext) {
    if (disposition === 'download') {
      res.type(attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.originalName));
      res.sendFile(filePath);
      return;
    }
    const kind = attachmentPreviewKind(attachment);
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
    if (kind === 'spreadsheet') {
      const spreadsheetBuffer = await readFile(filePath);
      res.status(200).render('attachments/spreadsheet-preview', {
        ...previewContext,
        preview: extractXlsxPreview(spreadsheetBuffer)
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
  }

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
      const fileStat = filePath ? await stat(filePath).catch(() => null) : null;
      if (!fileStat?.isFile()) {
        res.status(404).send('Attachment not found');
        return;
      }
      const downloadUrl = `/lead-submissions/${submission.id}/attachments/${attachment.id}/download`;
      await sendAttachmentContent(res, disposition, attachment, filePath, {
        activeNav: 'lead-submissions',
        attachment,
        downloadUrl,
        contextLabelKey: 'myLeadSubmissions',
        contextText: submission.subject || submission.companyName
          || `${res.locals.t('leadSubmissionReceipt')} #${submission.id}`,
        backUrl: `/lead-submissions/${submission.id}`,
        backLabelKey: 'backToList'
      });
    } catch (error) {
      next(error);
    }
  }

  async function sendDraftAttachment(req, res, next, disposition) {
    try {
      const draft = leadAttachmentDraft(req, req.params.draftToken);
      const attachment = draft?.attachments?.find((item) => item.id === req.params.attachmentId);
      if (!attachment) {
        res.status(404).send('Attachment not found');
        return;
      }
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      const fileStat = filePath ? await stat(filePath).catch(() => null) : null;
      if (!fileStat?.isFile()) {
        res.status(404).send('Attachment not found');
        return;
      }
      const draftAttachment = publicDraftAttachment(req.params.draftToken, attachment);
      await sendAttachmentContent(res, disposition, attachment, filePath, {
        activeNav: 'lead-submissions',
        attachment,
        downloadUrl: draftAttachment.downloadUrl,
        contextLabelKey: 'myLeadSubmissions',
        contextText: res.locals.t('uploadedSupportingFiles'),
        backUrl: '/lead-submissions',
        backLabelKey: 'backToList'
      });
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

  router.get('/lead-submissions/attachment-drafts/:draftToken/:attachmentId/download', (req, res, next) => {
    sendDraftAttachment(req, res, next, 'download');
  });

  router.get('/lead-submissions/attachment-drafts/:draftToken/:attachmentId/preview', (req, res, next) => {
    sendDraftAttachment(req, res, next, 'preview');
  });

  return router;
}
