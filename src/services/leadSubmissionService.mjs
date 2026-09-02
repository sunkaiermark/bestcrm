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
  return hasRole(user, ROLES.SALESPERSON);
}

export function canViewOwnLeadSubmission(user, inquiry) {
  return canSubmitNewLead(user)
    && inquiry?.submissionType === 'sales_lead'
    && Number(inquiry.createdBy) === Number(user.id);
}

export function leadSubmissionListFilterFor(user) {
  if (!canSubmitNewLead(user)) {
    forbidden();
  }
  return {
    createdBy: Number(user.id),
    submissionType: 'sales_lead'
  };
}

export function listEligibleReviewManagers(users = []) {
  return users.filter((user) => user?.isActive !== false && hasRole(user, ROLES.SALES_MANAGER));
}

export function normalizeLeadSubmissionInput(input, actor) {
  const sourceChannel = isSalesLeadSourceChannel(input.sourceChannel) ? input.sourceChannel : 'other';
  const submissionToken = text(input.submissionToken);
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
    rawPayload: { intakeKind: 'sales_lead', sourceChannel },
    priority: isInquiryPriority(input.priority) ? input.priority : 'normal',
    status: 'new',
    assignedUserId: numberOrNull(input.assignedUserId),
    recommendedSalespersonId: Number(actor.id),
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
  return inquiryRepository.createInquiry(normalized);
}
