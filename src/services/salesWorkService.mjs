import { ROLES, hasRole } from '../domain/roles.mjs';
import { canViewOpportunity } from './opportunityService.mjs';
import { canViewContact, canViewCustomer } from './customerService.mjs';

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

function dateOrNull(value) {
  return text(value) || null;
}

export function canAccessSalesWork(user) {
  return Number.isSafeInteger(Number(user?.id)) && Number(user.id) > 0;
}

function canReviewAllSalesWork(user) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER);
}

export function canViewSalesWorkRecord(user, record) {
  return canReviewAllSalesWork(user)
    || Number(record.salespersonUserId) === Number(user.id);
}

export function canMaintainSalesWorkRecord(user, record) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || Number(record.salespersonUserId) === Number(user.id);
}

function canCreateSalesWorkFor(user, salespersonUserId) {
  return canAccessSalesWork(user)
    && (hasRole(user, ROLES.ADMINISTRATOR)
      || Number(salespersonUserId) === Number(user.id));
}

function actorSalespersonUserId(actor, input) {
  if (hasRole(actor, ROLES.ADMINISTRATOR) && input.salespersonUserId) {
    return Number(input.salespersonUserId);
  }
  return Number(actor.id);
}

function filterForActor(actor, filter) {
  if (!canAccessSalesWork(actor)) {
    forbidden();
  }
  if (!canReviewAllSalesWork(actor)) {
    return { ...filter, salespersonUserId: Number(actor.id) };
  }
  return { ...filter };
}

export function normalizeSalesWorkPlanInput(input, salespersonUserId) {
  return {
    salespersonUserId,
    planDate: dateOrNull(input.planDate),
    customerId: numberOrNull(input.customerId),
    contactId: numberOrNull(input.contactId),
    opportunityId: numberOrNull(input.opportunityId),
    activityType: text(input.activityType),
    subject: text(input.subject),
    objective: text(input.objective),
    plannedAction: text(input.plannedAction),
    nextStep: text(input.nextStep)
  };
}

export function normalizeSalesWorkLogInput(input, salespersonUserId) {
  return {
    salespersonUserId,
    logDate: dateOrNull(input.logDate),
    customerId: numberOrNull(input.customerId),
    contactId: numberOrNull(input.contactId),
    opportunityId: numberOrNull(input.opportunityId),
    activityType: text(input.activityType),
    subject: text(input.subject),
    content: text(input.content),
    customerFeedback: text(input.customerFeedback),
    result: text(input.result),
    nextStep: text(input.nextStep),
    nextPlanDate: dateOrNull(input.nextPlanDate)
  };
}

async function validateSalesWorkLinks(repositories, actor, normalized) {
  let opportunity = null;
  if (normalized.opportunityId) {
    opportunity = await repositories.opportunityRepository.getOpportunityDetail(normalized.opportunityId);
    if (!opportunity) {
      throw new Error('Opportunity not found');
    }
    if (!canViewOpportunity(actor, opportunity)) {
      forbidden();
    }
  }

  if (normalized.customerId) {
    const customer = await repositories.customerRepository.getCustomerDetail(normalized.customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }
    if (customer.archivedAt) {
      throw new Error('Customer is archived');
    }
    const isLinkedOpportunityCustomer = opportunity
      && Number(opportunity.customerId) === Number(customer.id);
    if (!canViewCustomer(actor, customer) && !isLinkedOpportunityCustomer) {
      forbidden();
    }
  }

  if (normalized.contactId) {
    const contact = await repositories.contactRepository.getContactDetail(normalized.contactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (normalized.customerId && Number(contact.customerId) !== Number(normalized.customerId)) {
      throw new Error('Contact does not belong to customer');
    }
    if (contact.archivedAt) {
      throw new Error('Contact is archived');
    }
    const isLinkedOpportunityContact = opportunity
      && Number(opportunity.primaryContactId) === Number(contact.id);
    if (!canViewContact(actor, contact) && !isLinkedOpportunityContact) {
      forbidden();
    }
  }
}

export async function createSalesWorkPlan(repositories, actor, input) {
  const salespersonUserId = actorSalespersonUserId(actor, input);
  if (!canCreateSalesWorkFor(actor, salespersonUserId)) {
    forbidden();
  }
  const normalized = normalizeSalesWorkPlanInput(input, salespersonUserId);
  await validateSalesWorkLinks(repositories, actor, normalized);
  return repositories.salesWorkRepository.createPlan(normalized);
}

export async function listSalesWorkPlans(salesWorkRepository, actor, filter = {}) {
  return salesWorkRepository.listPlans(filterForActor(actor, filter));
}

export async function updateSalesWorkPlanStatus(salesWorkRepository, actor, plan, input) {
  if (!canMaintainSalesWorkRecord(actor, plan)) {
    forbidden();
  }
  return salesWorkRepository.updatePlanStatus(plan.id, {
    status: text(input.status),
    resultSummary: text(input.resultSummary),
    nextStep: text(input.nextStep)
  });
}

export async function updateSalesWorkPlan(repositories, actor, plan, input) {
  if (!canMaintainSalesWorkRecord(actor, plan)) {
    forbidden();
  }
  const normalized = normalizeSalesWorkPlanInput(input, Number(plan.salespersonUserId));
  await validateSalesWorkLinks(repositories, actor, normalized);
  return repositories.salesWorkRepository.updatePlan(plan.id, normalized);
}

export async function createSalesWorkLog(repositories, actor, input) {
  const salespersonUserId = actorSalespersonUserId(actor, input);
  if (!canCreateSalesWorkFor(actor, salespersonUserId)) {
    forbidden();
  }
  const normalized = normalizeSalesWorkLogInput(input, salespersonUserId);
  await validateSalesWorkLinks(repositories, actor, normalized);
  return repositories.salesWorkRepository.createLog(normalized);
}

export async function listSalesWorkLogs(salesWorkRepository, actor, filter = {}) {
  return salesWorkRepository.listLogs(filterForActor(actor, filter));
}

export async function updateSalesWorkLog(repositories, actor, log, input) {
  if (!canMaintainSalesWorkRecord(actor, log)) {
    forbidden();
  }
  const normalized = normalizeSalesWorkLogInput(input, Number(log.salespersonUserId));
  await validateSalesWorkLinks(repositories, actor, normalized);
  return repositories.salesWorkRepository.updateLog(log.id, normalized);
}

export async function summarizeSalesWork(salesWorkRepository, actor, filter = {}) {
  return salesWorkRepository.summarizeSalesWork(filterForActor(actor, filter));
}
