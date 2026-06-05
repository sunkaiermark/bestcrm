import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { ACTIONS, getAllowedActions } from '../domain/workflow.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canViewOpportunity, createOpportunityDraft } from '../services/opportunityService.mjs';
import { WorkflowValidationError, applyWorkflowAction } from '../services/workflowService.mjs';

function ownerFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { salespersonId: user.id };
}

const assignmentRoles = [
  ROLES.QUOTATION_ENGINEER
];

const numericPayloadFields = new Set([
  'salesManagerId',
  'quotationEngineerId',
  'technicalManagerId',
  'commercialManagerId',
  'legalReviewerId',
  'finalDealAmount',
  'quoteQuantity',
  'quoteUnitPrice',
  'totalPrice'
]);

const attachmentCategories = new Set([
  'requirement',
  'technical_solution',
  'commercial_quote',
  'contract',
  'other'
]);

const attachmentRequirementsByAction = new Map([
  [ACTIONS.SUBMIT_TECHNICAL_SOLUTION, {
    category: 'technical_solution',
    message: 'Technical Solution attachment is required before submission'
  }],
  [ACTIONS.SUBMIT_COMMERCIAL_QUOTE, {
    category: 'commercial_quote',
    message: 'Commercial Quote attachment is required before submission'
  }],
  [ACTIONS.SUBMIT_CONTRACT_APPROVAL, {
    category: 'contract',
    message: 'Contract attachment is required before submission'
  }]
]);

async function loadUsersByRole(userRepository) {
  const entries = await Promise.all(assignmentRoles.map(async (role) => {
    if (typeof userRepository?.listUsersByRole !== 'function') {
      return [role, []];
    }
    return [role, await userRepository.listUsersByRole(role)];
  }));
  return Object.fromEntries(entries);
}

function userSelectField(name, label, users) {
  return { type: 'userSelect', name, label, users };
}

function textareaField(name, label, required = true) {
  return { type: 'textarea', name, label, required };
}

function inputField(name, label, inputType = 'text', required = true) {
  return { type: 'input', name, label, inputType, required };
}

function formForAction(action, usersByRole) {
  switch (action) {
    case ACTIONS.SUBMIT_INITIATION:
      return {
        action,
        title: 'Submit Initiation',
        button: 'Submit to Sales Manager',
        fields: [
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_INITIATION:
      return {
        action,
        title: 'Withdraw Initiation',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_INITIATION:
      return {
        action,
        title: 'Approve Initiation',
        button: 'Approve and Assign',
        fields: [
          userSelectField('quotationEngineerId', 'Quotation Engineer', usersByRole[ROLES.QUOTATION_ENGINEER] || []),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.REJECT_INITIATION:
      return {
        action,
        title: 'Reject Initiation',
        button: 'Reject',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.SUBMIT_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Submit Technical Solution',
        button: 'Submit to Technical Manager',
        fields: [
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Withdraw Technical Solution',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Approve Technical Solution',
        button: 'Approve',
        fields: [textareaField('comment', 'Comment', false)]
      };
    case ACTIONS.REJECT_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Reject Technical Solution',
        button: 'Reject',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.SUBMIT_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Submit Commercial Quote',
        button: 'Submit to Commercial Manager',
        fields: [
          inputField('quoteItemName', 'Quote Item'),
          inputField('quoteSpecification', 'Specification', 'text', false),
          inputField('quoteUnit', 'Unit', 'text', false),
          inputField('quoteQuantity', 'Quantity', 'number'),
          inputField('quoteUnitPrice', 'Unit Price', 'number'),
          inputField('totalPrice', 'Total Price', 'number'),
          textareaField('paymentTerms', 'Payment Terms'),
          inputField('validityDate', 'Quote Validity Date', 'date'),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Withdraw Commercial Quote',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Approve Commercial Quote',
        button: 'Approve',
        fields: [textareaField('comment', 'Comment', false)]
      };
    case ACTIONS.REJECT_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Reject Commercial Quote',
        button: 'Reject',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.MARK_LOST:
      return {
        action,
        title: 'Record Lost Result',
        button: 'Archive as Lost',
        fields: [textareaField('lostReason', 'Lost Reason')]
      };
    case ACTIONS.MARK_WON:
      return {
        action,
        title: 'Record Won Result',
        button: 'Mark Won',
        fields: [
          textareaField('wonDescription', 'Won Description'),
          inputField('finalDealAmount', 'Final Deal Amount', 'number')
        ]
      };
    case ACTIONS.SUBMIT_CONTRACT_APPROVAL:
      return {
        action,
        title: 'Submit Contract Approval',
        button: 'Submit Contract Approval',
        fields: [
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_CONTRACT_APPROVAL:
      return {
        action,
        title: 'Withdraw Contract Approval',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_CONTRACT:
      return {
        action,
        title: 'Approve Contract',
        button: 'Approve Contract',
        fields: [textareaField('comment', 'Comment', false)]
      };
    case ACTIONS.REJECT_CONTRACT:
      return {
        action,
        title: 'Reject Contract',
        button: 'Reject Contract',
        fields: [textareaField('reason', 'Reason')]
      };
    default:
      return null;
  }
}

function missingMaterialsForAction(action, attachments) {
  const requirement = attachmentRequirementsByAction.get(action);
  if (!requirement) {
    return [];
  }
  const hasAttachment = attachments.some((attachment) => attachment.category === requirement.category);
  return hasAttachment ? [] : [requirement.message];
}

function activeContractApproval(contractApprovals) {
  return contractApprovals.find((approval) => approval.status === 'pending' && approval.stepAction === 'pending') || null;
}

function opportunityWithActiveContractReviewer(opportunity, contractApprovals) {
  const activeApproval = activeContractApproval(contractApprovals);
  if (!activeApproval) {
    return opportunity;
  }
  return {
    ...opportunity,
    legalReviewerId: activeApproval.reviewerUserId
  };
}

function buildWorkflowForms(user, opportunity, usersByRole, attachments = [], contractApprovals = []) {
  const workflowOpportunity = opportunityWithActiveContractReviewer(opportunity, contractApprovals);
  const allowedActions = getAllowedActions({
    userId: user.id,
    roles: user.roles,
    opportunity: workflowOpportunity
  });
  return allowedActions
    .map((action) => formForAction(action, usersByRole))
    .filter(Boolean)
    .map((form) => {
      const missingRequirements = missingMaterialsForAction(form.action, attachments);
      return {
        ...form,
        missingRequirements,
        blocked: missingRequirements.length > 0
      };
    });
}

function parseWorkflowPayload(body) {
  const payload = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'action' || value === undefined || value === null || value === '') {
      continue;
    }
    payload[key] = numericPayloadFields.has(key) ? Number(value) : String(value).trim();
  }
  return payload;
}

async function loadOpportunityActivity({ opportunityId, workflowEventRepository, todoRepository, contractApprovalRepository }) {
  const [timelineEvents, todos, contractApprovals] = await Promise.all([
    typeof workflowEventRepository?.listByOpportunity === 'function'
      ? workflowEventRepository.listByOpportunity(opportunityId)
      : [],
    typeof todoRepository?.listByOpportunity === 'function'
      ? todoRepository.listByOpportunity(opportunityId)
      : [],
    typeof contractApprovalRepository?.listByOpportunity === 'function'
      ? contractApprovalRepository.listByOpportunity(opportunityId)
      : []
  ]);
  return { timelineEvents, todos, contractApprovals };
}

async function canViewOpportunityWithContractApproval(user, opportunity, contractApprovalRepository) {
  if (canViewOpportunity(user, opportunity)) {
    return true;
  }
  if (typeof contractApprovalRepository?.listByOpportunity !== 'function') {
    return false;
  }
  const approvals = await contractApprovalRepository.listByOpportunity(opportunity.id);
  return approvals.some((approval) => approval.reviewerUserId === user.id);
}

async function loadOpportunityOrSend({ req, res, opportunityRepository, contractApprovalRepository }) {
  const opportunity = await opportunityRepository.getOpportunityDetail(req.params.id);
  if (!opportunity) {
    res.status(404).send('Opportunity not found');
    return null;
  }
  if (!await canViewOpportunityWithContractApproval(req.currentUser, opportunity, contractApprovalRepository)) {
    res.status(403).send('Forbidden');
    return null;
  }
  return opportunity;
}

function currentUploadSubdir() {
  const now = new Date();
  return path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
}

function createUploadMiddleware(uploadDir, maxUploadMb) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      const relativeDir = currentUploadSubdir();
      const destination = path.join(resolvedUploadDir, relativeDir);
      mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename(req, file, callback) {
      const extension = path.extname(file.originalname || '');
      callback(null, `${randomUUID()}${extension}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: maxUploadMb * 1024 * 1024 }
  });
}

function normalizeAttachmentCategory(category) {
  return attachmentCategories.has(category) ? category : 'other';
}

function storedPathForFile(uploadDir, file) {
  return path.relative(path.resolve(uploadDir), file.path).split(path.sep).join('/');
}

function resolveStoredPath(uploadDir, storedPath) {
  const uploadRoot = path.resolve(uploadDir);
  const resolved = path.resolve(uploadRoot, storedPath);
  const normalizedRoot = uploadRoot.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function previewMimeType(mimeType) {
  if (mimeType === 'application/pdf' || mimeType === 'text/plain' || mimeType?.startsWith('image/')) {
    return mimeType;
  }
  return 'application/octet-stream';
}

function inlineDisposition(filename) {
  const safeFilename = String(filename || 'attachment').replaceAll('"', "'");
  return `inline; filename="${safeFilename}"`;
}

export function opportunityRoutes({
  customerRepository,
  contactRepository,
  attachmentRepository,
  commercialQuoteRepository,
  contractApprovalRepository,
  approvalSettingRepository,
  opportunityRepository,
  userRepository,
  workflowEventRepository,
  todoRepository,
  uploadDir = './var/uploads',
  maxUploadMb = 25
}) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir, maxUploadMb);

  router.use('/opportunities', requireLogin);
  router.use('/api/opportunities', requireLogin);

  router.get('/opportunities', async (req, res, next) => {
    try {
      const opportunities = await opportunityRepository.listOpportunities(ownerFilter(req.currentUser));
      res.render('opportunities/index', { opportunities });
    } catch (error) {
      next(error);
    }
  });

  router.get('/opportunities/new', async (req, res, next) => {
    try {
      const filter = hasRole(req.currentUser, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: req.currentUser.id };
      const [customers, contacts] = await Promise.all([
        customerRepository.listCustomers(filter),
        contactRepository.listContacts(filter)
      ]);
      res.render('opportunities/form', {
        opportunity: {
          customerId: req.query.customerId,
          primaryContactId: req.query.contactId
        },
        customers,
        contacts,
        action: '/opportunities'
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities', async (req, res, next) => {
    try {
      const opportunity = await createOpportunityDraft({
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, req.body);
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      next(error);
    }
  });

  router.get('/opportunities/:id', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({ req, res, opportunityRepository, contractApprovalRepository });
      if (!opportunity) {
        return;
      }
      const [usersByRole, activity, attachments] = await Promise.all([
        loadUsersByRole(userRepository),
        loadOpportunityActivity({
          opportunityId: opportunity.id,
          workflowEventRepository,
          todoRepository,
          contractApprovalRepository
        }),
        typeof attachmentRepository?.listByOpportunity === 'function'
          ? attachmentRepository.listByOpportunity(opportunity.id)
          : []
      ]);
      const workflowForms = buildWorkflowForms(req.currentUser, opportunity, usersByRole, attachments, activity.contractApprovals);
      res.render('opportunities/detail', {
        opportunity,
        workflowForms,
        timelineEvents: activity.timelineEvents,
        todos: activity.todos,
        attachments,
        contractApprovals: activity.contractApprovals
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id/attachments', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({ req, res, opportunityRepository, contractApprovalRepository });
      if (!opportunity) {
        return;
      }
      req.opportunity = opportunity;
      next();
    } catch (error) {
      next(error);
    }
  }, upload.single('attachment'), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).send('Attachment file is required');
        return;
      }
      await attachmentRepository.createAttachment({
        opportunityId: req.opportunity.id,
        category: normalizeAttachmentCategory(req.body.category),
        originalName: req.file.originalname,
        storedPath: storedPathForFile(uploadDir, req.file),
        mimeType: req.file.mimetype || 'application/octet-stream',
        fileSize: req.file.size,
        uploadedBy: req.currentUser.id
      });
      res.redirect(`/opportunities/${req.opportunity.id}`);
    } catch (error) {
      next(error);
    }
  });

  async function sendAttachment(req, res, next, disposition) {
    try {
      const opportunity = await loadOpportunityOrSend({ req, res, opportunityRepository, contractApprovalRepository });
      if (!opportunity) {
        return;
      }
      const attachment = await attachmentRepository.findById(req.params.attachmentId);
      if (!attachment || attachment.opportunityId !== opportunity.id) {
        res.status(404).send('Attachment not found');
        return;
      }
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!filePath) {
        res.status(404).send('Attachment not found');
        return;
      }
      if (disposition === 'download') {
        res.download(filePath, attachment.originalName);
        return;
      }
      res.type(previewMimeType(attachment.mimeType));
      res.setHeader('Content-Disposition', inlineDisposition(attachment.originalName));
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  router.get('/opportunities/:id/attachments/:attachmentId/download', (req, res, next) => {
    sendAttachment(req, res, next, 'download');
  });

  router.get('/opportunities/:id/attachments/:attachmentId/preview', (req, res, next) => {
    sendAttachment(req, res, next, 'preview');
  });

  router.post('/opportunities/:id/workflow', async (req, res, next) => {
    try {
      await applyWorkflowAction({
        actor: req.currentUser,
        opportunityId: req.params.id,
        action: req.body.action,
        payload: parseWorkflowPayload(req.body),
        repositories: {
          opportunityRepository,
          workflowEventRepository,
          todoRepository,
          attachmentRepository,
          commercialQuoteRepository,
          contractApprovalRepository,
          approvalSettingRepository
        }
      });
      res.redirect(`/opportunities/${req.params.id}`);
    } catch (error) {
      if (error.message === 'Opportunity not found') {
        res.status(404).send('Opportunity not found');
        return;
      }
      if (error.message === 'Action not allowed') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error instanceof WorkflowValidationError) {
        res.status(error.statusCode).send(error.message);
        return;
      }
      next(error);
    }
  });

  router.get('/api/opportunities', async (req, res, next) => {
    try {
      const opportunities = await opportunityRepository.listOpportunities(ownerFilter(req.currentUser));
      res.json({ opportunities });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/opportunities', async (req, res, next) => {
    try {
      const opportunity = await createOpportunityDraft({
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, req.body);
      res.status(201).json(opportunity);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
