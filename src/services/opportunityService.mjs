import { ROLES, hasRole } from '../domain/roles.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { canMaintainCustomer } from './customerService.mjs';

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
  return hasRole(user, ROLES.ADMINISTRATOR)
    || Number(opportunity.salespersonId) === Number(user.id);
}

export function canManageOpportunityResponsibility(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER);
}

export function normalizeOpportunityInput(input, actor) {
  return {
    opportunityNo: text(input.opportunityNo) || null,
    title: text(input.title),
    customerId: Number(input.customerId),
    primaryContactId: numberOrNull(input.primaryContactId),
    requirement: text(input.requirement),
    estimatedAmount: numberOrNull(input.estimatedAmount),
    projectType: text(input.projectType),
    deliveryCycle: text(input.deliveryCycle),
    expectedBidDate: isoDateOrNull(input.expectedBidDate),
    status: STATUSES.DRAFT,
    salespersonId: actor.id
  };
}

export function normalizeOpportunityUpdateInput(input) {
  return {
    title: text(input.title),
    customerId: Number(input.customerId),
    primaryContactId: numberOrNull(input.primaryContactId),
    requirement: text(input.requirement),
    estimatedAmount: numberOrNull(input.estimatedAmount),
    projectType: text(input.projectType),
    deliveryCycle: text(input.deliveryCycle),
    expectedBidDate: isoDateOrNull(input.expectedBidDate)
  };
}

async function validateOpportunityReferences(repositories, actor, normalized) {
  const customer = await repositories.customerRepository.getCustomerDetail(normalized.customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (!canMaintainCustomer(actor, customer)) {
    forbidden();
  }

  if (normalized.primaryContactId) {
    const contact = await repositories.contactRepository.getContactDetail(normalized.primaryContactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (contact.customerId !== normalized.customerId) {
      throw new Error('Contact does not belong to customer');
    }
    if (!hasRole(actor, ROLES.ADMINISTRATOR) && contact.customerOwnerUserId !== actor.id) {
      forbidden();
    }
  }
}

export async function createOpportunityDraft(repositories, actor, input) {
  const normalized = normalizeOpportunityInput(input, actor);
  await validateOpportunityReferences(repositories, actor, normalized);

  return repositories.opportunityRepository.createOpportunity(normalized);
}

export async function updateOpportunity(repositories, actor, opportunity, input) {
  if (!canEditOpportunity(actor, opportunity)) {
    forbidden();
  }
  const normalized = normalizeOpportunityUpdateInput(input);
  await validateOpportunityReferences(repositories, actor, normalized);

  return repositories.opportunityRepository.updateOpportunity(opportunity.id, normalized);
}
