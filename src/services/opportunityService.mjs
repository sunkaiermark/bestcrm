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
  return [
    opportunity.salespersonId,
    opportunity.salesManagerId,
    opportunity.quotationEngineerId,
    opportunity.technicalManagerId,
    opportunity.commercialManagerId
  ].includes(user.id);
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

export async function createOpportunityDraft(repositories, actor, input) {
  const normalized = normalizeOpportunityInput(input, actor);
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

  return repositories.opportunityRepository.createOpportunity(normalized);
}
