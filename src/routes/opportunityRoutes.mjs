import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { CUSTOMER_INDUSTRIES } from '../domain/customerIndustries.mjs';
import { CUSTOMER_REGIONS } from '../domain/customerRegions.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { ACTIONS, getAllowedActions } from '../domain/workflow.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { createContact } from '../services/contactService.mjs';
import { createCustomer } from '../services/customerService.mjs';
import {
  canManageOpportunityResponsibility,
  canEditOpportunity,
  canViewOpportunity,
  createOpportunityDraft,
  updateOpportunity
} from '../services/opportunityService.mjs';
import { createSupplementalRequirementUpdate } from '../services/requirementUpdateService.mjs';
import { WorkflowValidationError, applyWorkflowAction } from '../services/workflowService.mjs';

function opportunityVisibilityFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { visibleToUserId: user.id };
}

function newContactUrl(selectedCustomerId) {
  const params = new URLSearchParams();
  if (selectedCustomerId) {
    params.set('customerId', String(selectedCustomerId));
  }
  params.set('returnTo', 'opportunity-initiation');
  return `/contacts/new?${params.toString()}`;
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

const requirementMaterialCategories = new Set([
  'requirement',
  'other'
]);

const requirementMaterialDeleteStatuses = new Set([
  STATUSES.DRAFT,
  STATUSES.INITIATION_REJECTED
]);

const technicalSolutionDeleteStatuses = new Set([
  STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
  STATUSES.TECHNICAL_SOLUTION_REJECTED
]);

const preSubmissionRequirementUpdateStatuses = new Set([
  STATUSES.DRAFT,
  STATUSES.INITIATION_REJECTED
]);

const responsibilityPermissionLevels = new Set(['view', 'edit']);
const responsibilityRoleCodes = new Set(ROLE_DETAILS.map((role) => role.code));

const supplementalRequirementStatuses = new Set([
  STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
  STATUSES.TECHNICAL_SOLUTION_PENDING,
  STATUSES.TECHNICAL_SOLUTION_REJECTED,
  STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
  STATUSES.COMMERCIAL_QUOTE_PENDING,
  STATUSES.COMMERCIAL_QUOTE_REJECTED,
  STATUSES.CUSTOMER_NEGOTIATION,
  STATUSES.WON_CONTRACT_PENDING,
  STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
  STATUSES.CONTRACT_REJECTED
]);

const attachmentRequirementsByAction = new Map([
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
          textareaField('solutionSummary', 'Solution Summary'),
          textareaField('solutionParameters', 'Technical Parameters', false),
          textareaField('implementationPlan', 'Implementation Plan', false),
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

async function loadOpportunityActivity({ opportunityId, workflowEventRepository, contractApprovalRepository }) {
  const [timelineEvents, contractApprovals] = await Promise.all([
    typeof workflowEventRepository?.listByOpportunity === 'function'
      ? workflowEventRepository.listByOpportunity(opportunityId)
      : [],
    typeof contractApprovalRepository?.listByOpportunity === 'function'
      ? contractApprovalRepository.listByOpportunity(opportunityId)
      : []
  ]);
  return { timelineEvents, contractApprovals };
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

async function loadOpportunityOrSend({
  req,
  res,
  opportunityRepository,
  contractApprovalRepository,
  opportunityResponsibilityRepository
}) {
  const opportunity = await opportunityRepository.getOpportunityDetail(req.params.id);
  if (!opportunity) {
    res.status(404).send('Opportunity not found');
    return null;
  }
  let opportunityForAccess = opportunity;
  if (!canViewOpportunity(req.currentUser, opportunity)
    && typeof opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function') {
    opportunityForAccess = {
      ...opportunity,
      teamMembers: await opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    };
  }
  if (!await canViewOpportunityWithContractApproval(req.currentUser, opportunityForAccess, contractApprovalRepository)) {
    res.status(403).send('Forbidden');
    return null;
  }
  return opportunityForAccess;
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

function canDeleteAttachment(opportunity, attachment) {
  if (requirementMaterialCategories.has(attachment.category)) {
    return requirementMaterialDeleteStatuses.has(opportunity.status);
  }
  if (attachment.category === 'technical_solution') {
    return technicalSolutionDeleteStatuses.has(opportunity.status);
  }
  return false;
}

function canCreateRequirementUpdate(user, opportunity) {
  const canAdd = hasRole(user, ROLES.ADMINISTRATOR) || Number(opportunity.salespersonId) === Number(user.id);
  if (!canAdd) {
    return false;
  }
  if (preSubmissionRequirementUpdateStatuses.has(opportunity.status)) {
    return true;
  }
  return supplementalRequirementStatuses.has(opportunity.status) && Boolean(opportunity.quotationEngineerId);
}

function canUploadAttachment(user, opportunity, category) {
  if (hasRole(user, ROLES.ADMINISTRATOR)) {
    return true;
  }
  const isSalesOwner = hasRole(user, ROLES.SALESPERSON)
    && Number(opportunity.salespersonId) === Number(user.id);
  const isQuotationEngineer = hasRole(user, ROLES.QUOTATION_ENGINEER)
    && Number(opportunity.quotationEngineerId) === Number(user.id);

  switch (category) {
    case 'requirement':
    case 'other':
      return isSalesOwner;
    case 'technical_solution':
      return isQuotationEngineer;
    case 'commercial_quote':
      return isSalesOwner || isQuotationEngineer;
    case 'contract':
      return isSalesOwner;
    default:
      return false;
  }
}

function uploadPermissionsFor(user, opportunity) {
  return Object.fromEntries([...attachmentCategories].map((category) => [
    category,
    canUploadAttachment(user, opportunity, category)
  ]));
}

function canDeleteOpportunity(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

function requiredText(value) {
  return String(value || '').trim();
}

function requiredPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function listResponsibilityUsers(userRepository) {
  if (typeof userRepository?.listUsersWithRoles !== 'function') {
    return [];
  }
  const users = await userRepository.listUsersWithRoles();
  return users.filter((user) => user.isActive);
}

async function findActiveResponsibilityUser(userRepository, userId) {
  const users = await listResponsibilityUsers(userRepository);
  return users.find((user) => Number(user.id) === Number(userId)) || null;
}

function userHasRole(user, roleCode) {
  return Array.isArray(user?.roles) && user.roles.includes(roleCode);
}

function redirectToOpportunity(opportunityId) {
  return `/opportunities/${opportunityId}`;
}

export function opportunityRoutes({
  customerRepository,
  contactRepository,
  attachmentRepository,
  commercialQuoteRepository,
  technicalSolutionRepository,
  requirementUpdateRepository,
  contractApprovalRepository,
  opportunityResponsibilityRepository,
  approvalSettingRepository,
  opportunityRepository,
  userRepository,
  workflowEventRepository,
  todoRepository,
  workflowTransaction,
  uploadDir = './var/uploads',
  maxUploadMb = 25
}) {
  const router = Router();
  const upload = createUploadMiddleware(uploadDir, maxUploadMb);

  router.use('/opportunities', requireLogin);
  router.use('/api/opportunities', requireLogin);

  router.get('/opportunities', async (req, res, next) => {
    try {
      const opportunities = await opportunityRepository.listOpportunities(opportunityVisibilityFilter(req.currentUser));
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
      const selectedCustomerId = req.query.customerId || customers[0]?.id || '';
      res.render('opportunities/form', {
        opportunity: {
          customerId: selectedCustomerId,
          primaryContactId: req.query.contactId
        },
        customers,
        contacts,
        countryOptions: CUSTOMER_COUNTRIES,
        industryOptions: CUSTOMER_INDUSTRIES,
        regionOptions: CUSTOMER_REGIONS,
        newContactUrl: newContactUrl(selectedCustomerId),
        action: '/opportunities'
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/customers', async (req, res, next) => {
    try {
      const customer = await createCustomer(customerRepository, req.currentUser, req.body);
      const params = new URLSearchParams({ customerId: String(customer.id) });
      res.redirect(`/opportunities/new?${params.toString()}`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/contacts', async (req, res, next) => {
    try {
      const contact = await createContact({ customerRepository, contactRepository }, req.currentUser, req.body);
      const params = new URLSearchParams({
        customerId: String(contact.customerId),
        contactId: String(contact.id)
      });
      res.redirect(`/opportunities/new?${params.toString()}`);
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

  router.get('/opportunities/:id/edit', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canEditOpportunity(req.currentUser, opportunity)) {
        res.status(403).send('Forbidden');
        return;
      }
      const filter = hasRole(req.currentUser, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: req.currentUser.id };
      const [customers, contacts] = await Promise.all([
        customerRepository.listCustomers(filter),
        contactRepository.listContacts(filter)
      ]);
      res.render('opportunities/form', {
        pageTitle: 'Edit Opportunity',
        submitLabel: 'Save changes',
        allowInlineCreate: false,
        opportunity,
        customers,
        contacts,
        countryOptions: CUSTOMER_COUNTRIES,
        regionOptions: CUSTOMER_REGIONS,
        action: `/opportunities/${opportunity.id}`
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canEditOpportunity(req.currentUser, opportunity)) {
        res.status(403).send('Forbidden');
        return;
      }
      const updated = await updateOpportunity({
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, opportunity, req.body);
      res.redirect(`/opportunities/${updated?.id || opportunity.id}`);
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      next(error);
    }
  });

  router.post('/opportunities/:id/delete', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canDeleteOpportunity(req.currentUser)) {
        res.status(403).send('Forbidden');
        return;
      }
      const attachments = typeof attachmentRepository?.listByOpportunity === 'function'
        ? await attachmentRepository.listByOpportunity(opportunity.id)
        : [];
      await opportunityRepository.deleteById(opportunity.id);
      await Promise.all(attachments.map(async (attachment) => {
        const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
        if (filePath) {
          await rm(filePath, { force: true });
        }
      }));
      res.redirect('/opportunities');
    } catch (error) {
      next(error);
    }
  });

  router.get('/opportunities/:id', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      const canManageResponsibility = canManageOpportunityResponsibility(req.currentUser);
      const [
        usersByRole,
        activity,
        attachments,
        requirementUpdates,
        technicalSolutions,
        commercialQuotes,
        teamMembers,
        ownerTransfers,
        responsibilityUsers
      ] = await Promise.all([
        loadUsersByRole(userRepository),
        loadOpportunityActivity({
          opportunityId: opportunity.id,
          workflowEventRepository,
          contractApprovalRepository
        }),
        typeof attachmentRepository?.listByOpportunity === 'function'
          ? attachmentRepository.listByOpportunity(opportunity.id)
          : [],
        typeof requirementUpdateRepository?.listByOpportunity === 'function'
          ? requirementUpdateRepository.listByOpportunity(opportunity.id)
          : [],
        typeof technicalSolutionRepository?.listByOpportunity === 'function'
          ? technicalSolutionRepository.listByOpportunity(opportunity.id)
          : [],
        typeof commercialQuoteRepository?.listByOpportunity === 'function'
          ? commercialQuoteRepository.listByOpportunity(opportunity.id)
          : [],
        Array.isArray(opportunity.teamMembers)
          ? opportunity.teamMembers
          : typeof opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
          ? opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
          : [],
        typeof opportunityResponsibilityRepository?.listOwnerTransfersByOpportunity === 'function'
          ? opportunityResponsibilityRepository.listOwnerTransfersByOpportunity(opportunity.id)
          : [],
        canManageResponsibility ? listResponsibilityUsers(userRepository) : []
      ]);
      const workflowForms = buildWorkflowForms(req.currentUser, opportunity, usersByRole, attachments, activity.contractApprovals);
      res.render('opportunities/detail', {
        opportunity,
        workflowForms,
        timelineEvents: activity.timelineEvents,
        attachments,
        contractApprovals: activity.contractApprovals,
        teamMembers,
        ownerTransfers,
        requirementUpdates,
        technicalSolutions,
        commercialQuotes,
        canManageResponsibility,
        responsibilityUsers,
        salesOwnerOptions: responsibilityUsers.filter((user) => userHasRole(user, ROLES.SALESPERSON)),
        responsibilityRoleOptions: ROLE_DETAILS,
        canCreateRequirementUpdate: canCreateRequirementUpdate(req.currentUser, opportunity),
        canUploadAttachments: uploadPermissionsFor(req.currentUser, opportunity),
        canEditOpportunity: canEditOpportunity(req.currentUser, opportunity),
        canDeleteOpportunity: canDeleteOpportunity(req.currentUser)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id/team-members', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canManageOpportunityResponsibility(req.currentUser)) {
        res.status(403).send('Forbidden');
        return;
      }
      const userId = requiredPositiveInteger(req.body.userId);
      const roleCode = requiredText(req.body.roleCode);
      const permissionLevel = responsibilityPermissionLevels.has(req.body.permissionLevel)
        ? req.body.permissionLevel
        : 'view';
      if (!userId || !responsibilityRoleCodes.has(roleCode)) {
        res.status(400).send('Team member and role are required');
        return;
      }
      const teamUser = await findActiveResponsibilityUser(userRepository, userId);
      if (!teamUser || !userHasRole(teamUser, roleCode)) {
        res.status(400).send('Selected user does not have the selected active role');
        return;
      }
      await opportunityResponsibilityRepository.addTeamMember({
        opportunityId: opportunity.id,
        userId,
        roleCode,
        permissionLevel,
        addedBy: req.currentUser.id
      });
      res.redirect(redirectToOpportunity(opportunity.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id/team-members/:memberId/remove', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canManageOpportunityResponsibility(req.currentUser)) {
        res.status(403).send('Forbidden');
        return;
      }
      const memberId = requiredPositiveInteger(req.params.memberId);
      if (!memberId) {
        res.status(400).send('Team member is required');
        return;
      }
      await opportunityResponsibilityRepository.removeTeamMember({
        opportunityId: opportunity.id,
        memberId,
        removedBy: req.currentUser.id
      });
      res.redirect(redirectToOpportunity(opportunity.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id/owner-transfer', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canManageOpportunityResponsibility(req.currentUser)) {
        res.status(403).send('Forbidden');
        return;
      }
      const toOwnerUserId = requiredPositiveInteger(req.body.toOwnerUserId);
      const reason = requiredText(req.body.reason);
      if (!toOwnerUserId || !reason) {
        res.status(400).send('New owner and reason are required');
        return;
      }
      if (Number(opportunity.salespersonId) === Number(toOwnerUserId)) {
        res.status(400).send('New owner must be different from current owner');
        return;
      }
      const newOwner = await findActiveResponsibilityUser(userRepository, toOwnerUserId);
      if (!newOwner || !userHasRole(newOwner, ROLES.SALESPERSON)) {
        res.status(400).send('New owner must be an active Sales user');
        return;
      }
      await opportunityResponsibilityRepository.transferOwner({
        opportunityId: opportunity.id,
        fromOwnerUserId: opportunity.salespersonId,
        toOwnerUserId,
        changedBy: req.currentUser.id,
        reason,
        keepPreviousOwnerAsMember: req.body.keepPreviousOwnerAsMember === 'on'
      });
      res.redirect(redirectToOpportunity(opportunity.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id/requirement-updates', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      if (!canCreateRequirementUpdate(req.currentUser, opportunity)) {
        res.status(403).send('Supplemental requirement can only be added after initiation approval');
        return;
      }
      const requirementText = requiredText(req.body.requirementText);
      const reason = requiredText(req.body.reason);
      if (!requirementText || !reason) {
        res.status(400).send('Requirement update and reason are required');
        return;
      }
      if (preSubmissionRequirementUpdateStatuses.has(opportunity.status)) {
        await requirementUpdateRepository.create({
          opportunityId: opportunity.id,
          requirementText,
          reason,
          createdBy: req.currentUser.id
        });
      } else {
        await createSupplementalRequirementUpdate({
          actor: req.currentUser,
          opportunity,
          input: { requirementText, reason },
          repositories: {
            requirementUpdateRepository,
            opportunityRepository,
            workflowEventRepository,
            todoRepository
          }
        });
      }
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      if (error instanceof WorkflowValidationError) {
        res.status(error.statusCode).send(error.message);
        return;
      }
      next(error);
    }
  });

  router.post('/opportunities/:id/attachments', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
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
      const category = normalizeAttachmentCategory(req.body.category);
      if (!canUploadAttachment(req.currentUser, req.opportunity, category)) {
        await rm(req.file.path, { force: true });
        res.status(403).send('Attachment upload is not allowed for this section');
        return;
      }
      await attachmentRepository.createAttachment({
        opportunityId: req.opportunity.id,
        category,
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

  router.post('/opportunities/:id/attachments/:attachmentId/delete', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
      if (!opportunity) {
        return;
      }
      const attachment = await attachmentRepository.findById(req.params.attachmentId);
      if (!attachment || attachment.opportunityId !== opportunity.id) {
        res.status(404).send('Attachment not found');
        return;
      }
      if (!canDeleteAttachment(opportunity, attachment)) {
        res.status(403).send('Attachment cannot be deleted after submission');
        return;
      }
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!filePath) {
        res.status(404).send('Attachment not found');
        return;
      }
      await attachmentRepository.deleteById(attachment.id);
      await rm(filePath, { force: true });
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      next(error);
    }
  });

  async function sendAttachment(req, res, next, disposition) {
    try {
      const opportunity = await loadOpportunityOrSend({
        req,
        res,
        opportunityRepository,
        contractApprovalRepository,
        opportunityResponsibilityRepository
      });
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
          technicalSolutionRepository,
          contractApprovalRepository,
          approvalSettingRepository,
          workflowTransaction
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
      const opportunities = await opportunityRepository.listOpportunities(opportunityVisibilityFilter(req.currentUser));
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
