import { ROLES, hasRole } from '../domain/roles.mjs';
import { ARCHIVED_STATUSES, STATUSES } from '../domain/statuses.mjs';
import { canMaintainCustomer } from './customerService.mjs';

function forbidden() {
  throw new Error('Forbidden');
}

function text(value) {
  return String(value || '').trim();
}

function hasText(value) {
  return text(value) !== '';
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function isoDateOrNull(value) {
  const normalized = text(value);
  return normalized || null;
}

export function canViewOpportunity(user, opportunity) {
  if (hasRole(user, ROLES.ADMINISTRATOR)) {
    return true;
  }
  const userId = Number(user.id);
  const isActiveTeamMember = Array.isArray(opportunity.teamMembers)
    && opportunity.teamMembers.some((member) => Number(member.userId) === userId && member.isActive !== false);
  return [
    opportunity.salespersonId,
    opportunity.salesManagerId,
    opportunity.quotationEngineerId,
    opportunity.technicalManagerId,
    opportunity.commercialManagerId
  ].some((assigneeId) => Number(assigneeId) === userId) || isActiveTeamMember;
}

export function canEditOpportunity(user, opportunity) {
  return !opportunity.archivedAt && (hasRole(user, ROLES.ADMINISTRATOR)
    || Number(opportunity.salespersonId) === Number(user.id));
}

export function canArchiveOpportunity(user, opportunity) {
  return hasRole(user, ROLES.ADMINISTRATOR) && !opportunity.archivedAt;
}

export function canReopenOpportunity(user, opportunity) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    && Boolean(opportunity.archivedAt)
    && !ARCHIVED_STATUSES.includes(opportunity.status);
}

export function canManageOpportunityResponsibility(user, opportunity = null) {
  if (opportunity?.archivedAt) {
    return false;
  }
  return hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER);
}

export function isProjectLeadEngineer(user, opportunity) {
  return hasRole(user, ROLES.QUOTATION_ENGINEER)
    && Number(opportunity.quotationEngineerId) === Number(user.id);
}

export function isSupportingEngineer(user, opportunity) {
  const userId = Number(user.id);
  return hasRole(user, ROLES.QUOTATION_ENGINEER)
    && Array.isArray(opportunity.teamMembers)
    && opportunity.teamMembers.some((member) => (
      Number(member.userId) === userId
      && member.roleCode === ROLES.QUOTATION_ENGINEER
      && member.isActive !== false
    ));
}

export function canManageOpportunityEngineeringTeam(user, opportunity) {
  if (opportunity.archivedAt) {
    return false;
  }
  return canManageOpportunityResponsibility(user, opportunity)
    || isProjectLeadEngineer(user, opportunity);
}

export function canContributeOpportunityEngineering(user, opportunity) {
  return !opportunity.archivedAt && (hasRole(user, ROLES.ADMINISTRATOR)
    || isProjectLeadEngineer(user, opportunity)
    || isSupportingEngineer(user, opportunity));
}

export function normalizeOpportunityInput(input, actor, options = {}) {
  return {
    originInquiryId: numberOrNull(options.originInquiryId),
    opportunityNo: text(input.opportunityNo) || null,
    title: text(input.title),
    customerId: Number(input.customerId),
    primaryContactId: numberOrNull(input.primaryContactId),
    requirement: text(input.requirement),
    estimatedAmount: numberOrNull(input.estimatedAmount),
    productInterest: text(input.productInterest),
    projectType: text(input.projectType),
    deliveryCycle: text(input.deliveryCycle),
    expectedBidDate: isoDateOrNull(input.expectedBidDate),
    status: STATUSES.DRAFT,
    salespersonId: numberOrNull(options.salespersonId) || actor.id
  };
}

function textOrCurrent(inputValue, currentValue) {
  const normalized = text(inputValue);
  return normalized || text(currentValue);
}

function numberOrCurrent(inputValue, currentValue) {
  return hasText(inputValue) ? numberOrNull(inputValue) : (currentValue ?? null);
}

function idOrCurrent(inputValue, currentValue) {
  return hasText(inputValue) ? Number(inputValue) : (currentValue ?? null);
}

function dateOrCurrent(inputValue, currentValue) {
  const normalized = text(inputValue);
  return normalized || currentValue || null;
}

export function normalizeOpportunityUpdateInput(input, currentOpportunity = {}) {
  return {
    title: textOrCurrent(input.title, currentOpportunity.title),
    customerId: idOrCurrent(input.customerId, currentOpportunity.customerId),
    primaryContactId: idOrCurrent(input.primaryContactId, currentOpportunity.primaryContactId),
    requirement: textOrCurrent(input.requirement, currentOpportunity.requirement),
    estimatedAmount: numberOrCurrent(input.estimatedAmount, currentOpportunity.estimatedAmount),
    productInterest: textOrCurrent(input.productInterest, currentOpportunity.productInterest),
    projectType: textOrCurrent(input.projectType, currentOpportunity.projectType),
    deliveryCycle: textOrCurrent(input.deliveryCycle, currentOpportunity.deliveryCycle),
    expectedBidDate: dateOrCurrent(input.expectedBidDate, currentOpportunity.expectedBidDate)
  };
}

async function validateOpportunityReferences(repositories, actor, normalized, options = {}) {
  const customer = options.validatedCustomer
    || await repositories.customerRepository.getCustomerDetail(normalized.customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (Number(customer.id) !== Number(normalized.customerId)) {
    throw new Error('Customer not found');
  }
  if (customer.archivedAt) {
    throw new Error('Archived customer cannot be linked to an opportunity');
  }
  const managedInquiry = options.inquiryConversion === true;
  if (managedInquiry && Number(customer.ownerUserId) !== Number(normalized.salespersonId)) {
    forbidden();
  }
  if (!managedInquiry && !canMaintainCustomer(actor, customer)) {
    forbidden();
  }

  if (normalized.primaryContactId) {
    const contact = await repositories.contactRepository.getContactDetail(normalized.primaryContactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (contact.archivedAt) {
      throw new Error('Archived contact cannot be linked to an opportunity');
    }
    if (contact.customerId !== normalized.customerId) {
      throw new Error('Contact does not belong to customer');
    }
    if (managedInquiry && Number(contact.customerOwnerUserId) !== Number(normalized.salespersonId)) {
      forbidden();
    }
    if (!managedInquiry && !hasRole(actor, ROLES.ADMINISTRATOR) && contact.customerOwnerUserId !== actor.id) {
      forbidden();
    }
  }
}

export async function createOpportunityDraft(repositories, actor, input, options = {}) {
  const authorizedInquiryConversion = options.inquiryConversion === true
    && numberOrNull(options.originInquiryId)
    && numberOrNull(options.salespersonId)
    && (hasRole(actor, ROLES.ADMINISTRATOR) || hasRole(actor, ROLES.SALES_MANAGER));
  if (!authorizedInquiryConversion) {
    forbidden();
  }
  const normalized = normalizeOpportunityInput(input, actor, options);
  await validateOpportunityReferences(repositories, actor, normalized, options);

  return repositories.opportunityRepository.createOpportunity(normalized);
}

export async function updateOpportunity(repositories, actor, opportunity, input) {
  if (!canEditOpportunity(actor, opportunity)) {
    forbidden();
  }
  const normalized = normalizeOpportunityUpdateInput(input, opportunity);
  await validateOpportunityReferences(repositories, actor, normalized);

  return repositories.opportunityRepository.updateOpportunity(opportunity.id, normalized);
}

function lifecycleReason(value, action) {
  const reason = text(value);
  if (!reason) {
    throw new Error(`${action} reason is required`);
  }
  return reason;
}

export async function archiveOpportunity(opportunityRepository, actor, opportunity, reason) {
  if (!canArchiveOpportunity(actor, opportunity)) {
    forbidden();
  }
  const archived = await opportunityRepository.archiveById(Number(opportunity.id), {
    actorUserId: Number(actor.id),
    reason: lifecycleReason(reason, 'Archive')
  });
  if (!archived) {
    throw new Error('Opportunity not found or already archived');
  }
}

export async function reopenOpportunity(opportunityRepository, actor, opportunity, reason) {
  if (!canReopenOpportunity(actor, opportunity)) {
    forbidden();
  }
  const reopened = await opportunityRepository.reopenById(Number(opportunity.id), {
    actorUserId: Number(actor.id),
    reason: lifecycleReason(reason, 'Reopen')
  });
  if (!reopened) {
    throw new Error('Opportunity not found or not archived');
  }
}
