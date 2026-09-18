import { ROLES, hasRole } from '../domain/roles.mjs';
import { isInquiryPriority, isSalesLeadSourceChannel } from '../domain/inquiries.mjs';

function forbidden() {
  throw new Error('Forbidden');
}

function text(value) {
  return String(value || '').trim();
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

export function canSubmitNewLead(user) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER)
    || hasRole(user, ROLES.SALESPERSON);
}

export function canViewLeadSubmission(user, inquiry) {
  if (!canSubmitNewLead(user) || inquiry?.submissionType !== 'sales_lead') {
    return false;
  }
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER)
    || Number(inquiry.createdBy) === Number(user.id);
}

export function leadSubmissionListFilterFor(user) {
  if (!canSubmitNewLead(user)) {
    forbidden();
  }
  return hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)
    ? { submissionType: 'sales_lead' }
    : { createdBy: Number(user.id), submissionType: 'sales_lead' };
}

export function listEligibleReviewManagers(users = []) {
  return users.filter((user) => user?.isActive !== false && hasRole(user, ROLES.SALES_MANAGER));
}

export function listEligibleSalespeople(users = []) {
  return users.filter((user) => user?.isActive !== false && hasRole(user, ROLES.SALESPERSON));
}

export function normalizeLeadSubmissionInput(input, actor) {
  const sourceChannel = isSalesLeadSourceChannel(input.sourceChannel) ? input.sourceChannel : 'other';
  const submissionToken = text(input.submissionToken);
  const emailThreadId = numberOrNull(input.emailThreadId);
  const recommendedSalespersonId = hasRole(actor, ROLES.SALESPERSON)
    ? Number(actor.id)
    : numberOrNull(input.recommendedSalespersonId);
  return {
    source: 'manual',
    submissionType: 'sales_lead',
    sourceChannel,
    sourceReference: submissionToken ? `sales-lead:${actor.id}:${submissionToken}` : '',
    sourceReceivedAt: null,
    subject: text(input.subject),
    companyName: text(input.companyName),
    contactName: text(input.contactName),
    contactEmail: text(input.contactEmail).toLowerCase(),
    contactPhone: text(input.contactPhone),
    country: text(input.country),
    productInterest: text(input.productInterest),
    opportunityType: text(input.opportunityType),
    requirementText: text(input.requirementText),
    rawPayload: {
      intakeKind: 'sales_lead',
      sourceChannel,
      ...(Number.isInteger(emailThreadId) && emailThreadId > 0 ? { emailThreadId } : {})
    },
    priority: isInquiryPriority(input.priority) ? input.priority : 'normal',
    status: 'new',
    assignedUserId: numberOrNull(input.assignedUserId),
    recommendedSalespersonId,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: Number(actor.id),
    reviewNote: ''
  };
}

export async function submitSalesLead({ inquiryRepository, userRepository }, actor, input) {
  if (!canSubmitNewLead(actor)) {
    forbidden();
  }
  const normalized = normalizeLeadSubmissionInput(input, actor);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  if (!normalized.companyName && !normalized.contactName && !normalized.contactEmail && !normalized.contactPhone) {
    throw new Error('Company or contact is required');
  }
  if (!normalized.sourceReference || !/^sales-lead:\d+:[0-9a-f-]{36}$/i.test(normalized.sourceReference)) {
    throw new Error('Invalid submission token');
  }
  const users = typeof userRepository?.listUsersWithRoles === 'function'
    ? await userRepository.listUsersWithRoles()
    : [];
  const manager = listEligibleReviewManagers(users)
    .find((user) => Number(user.id) === Number(normalized.assignedUserId));
  if (!manager) {
    throw new Error('Sales manager is required');
  }
  const salesperson = listEligibleSalespeople(users)
    .find((user) => Number(user.id) === Number(normalized.recommendedSalespersonId));
  if (!salesperson) {
    throw new Error('Sales owner is required');
  }
  return inquiryRepository.createInquiry(normalized);
}
