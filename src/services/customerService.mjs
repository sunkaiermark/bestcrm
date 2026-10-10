import { ROLES, hasRole } from '../domain/roles.mjs';

function forbidden() {
  throw new Error('Forbidden');
}

export class DuplicateCustomerError extends Error {
  constructor(duplicates) {
    super('Duplicate customer');
    this.name = 'DuplicateCustomerError';
    this.duplicates = duplicates;
  }
}

function text(value) {
  return String(value || '').trim();
}

export function normalizeCustomerWebsite(value) {
  const website = text(value);
  if (!website || /^https?:\/\//i.test(website)) {
    return website;
  }
  return `https://${website}`;
}

export function canMaintainCustomer(user, customer) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER)
    || Number(customer.coordinatorUserId ?? customer.ownerUserId) === Number(user?.id);
}

export function canMaintainContact(user, contact) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER)
    || Number(contact.customerCoordinatorUserId ?? contact.customerOwnerUserId) === Number(user?.id);
}

export function canViewCustomer(user, customer) {
  return Boolean(user && customer);
}

export function canArchiveCustomer(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

function lifecycleReason(value, action) {
  const reason = text(value);
  if (!reason) {
    throw new Error(`${action} reason is required`);
  }
  return reason;
}

export function normalizeCustomerInput(input, coordinatorUserId) {
  return {
    name: text(input.name),
    website: normalizeCustomerWebsite(input.website),
    industry: text(input.industry),
    country: text(input.country),
    region: text(input.region),
    parentCompany: text(input.parentCompany),
    enterpriseNature: text(input.enterpriseNature),
    companyHighlights: text(input.companyHighlights),
    address: text(input.address),
    coordinatorUserId,
    ownerUserId: coordinatorUserId,
    notes: text(input.notes)
  };
}

async function assertNoDuplicateCustomer(customerRepository, input, { excludeId } = {}) {
  if (!input.name || typeof customerRepository.findDuplicatesByName !== 'function') {
    return;
  }
  const duplicates = await customerRepository.findDuplicatesByName(input.name, { excludeId });
  if (duplicates.length > 0) {
    throw new DuplicateCustomerError(duplicates);
  }
}

async function persistWithoutDuplicateCustomer(customerRepository, input, operation, options) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code !== '23505' || error?.constraint !== 'customers_normalized_name_unique_idx') {
      throw error;
    }
    const duplicates = typeof customerRepository.findDuplicatesByName === 'function'
      ? await customerRepository.findDuplicatesByName(input.name, options)
      : [];
    throw new DuplicateCustomerError(duplicates);
  }
}

export async function createCustomer(customerRepository, actor, input, options = {}) {
  const managedInquiry = options.managedInquiry === true
    && (hasRole(actor, ROLES.ADMINISTRATOR) || hasRole(actor, ROLES.SALES_MANAGER));
  const canAssignCoordinator = hasRole(actor, ROLES.ADMINISTRATOR)
    || hasRole(actor, ROLES.SALES_MANAGER)
    || managedInquiry;
  const requestedCoordinatorId = input.coordinatorUserId || input.ownerUserId;
  const coordinatorUserId = canAssignCoordinator && requestedCoordinatorId
    ? Number(requestedCoordinatorId)
    : actor.id;
  const normalized = normalizeCustomerInput(input, coordinatorUserId);
  normalized.actorUserId = Number(actor.id);
  await assertNoDuplicateCustomer(customerRepository, normalized);
  return persistWithoutDuplicateCustomer(
    customerRepository,
    normalized,
    () => customerRepository.createCustomer(normalized)
  );
}

export async function updateCustomer(customerRepository, actor, customerId, input) {
  const existing = await customerRepository.getCustomerDetail(customerId);
  if (!existing) {
    throw new Error('Customer not found');
  }
  if (!canMaintainCustomer(actor, existing)) {
    forbidden();
  }
  if (existing.archivedAt) {
    throw new Error('Customer is archived');
  }
  const normalized = normalizeCustomerInput(
    input,
    existing.coordinatorUserId ?? existing.ownerUserId
  );
  const options = { excludeId: Number(customerId) };
  await assertNoDuplicateCustomer(customerRepository, normalized, options);
  return persistWithoutDuplicateCustomer(
    customerRepository,
    normalized,
    () => customerRepository.updateCustomer(customerId, normalized),
    options
  );
}

export async function changeCustomerCoordinator(
  { customerRepository, userRepository },
  actor,
  customerId,
  input = {}
) {
  if (!hasRole(actor, ROLES.ADMINISTRATOR) && !hasRole(actor, ROLES.SALES_MANAGER)) {
    forbidden();
  }
  const customer = await customerRepository.getCustomerDetail(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (customer.archivedAt) {
    throw new Error('Customer is archived');
  }
  const coordinatorUserId = Number(input.coordinatorUserId);
  if (!Number.isSafeInteger(coordinatorUserId) || coordinatorUserId <= 0) {
    throw new Error('Customer coordinator is required');
  }
  const note = text(input.note);
  if (!note) {
    throw new Error('Coordinator change reason is required');
  }
  if (Number(customer.coordinatorUserId ?? customer.ownerUserId) === coordinatorUserId) {
    throw new Error('New coordinator must be different from current coordinator');
  }
  const salespeople = typeof userRepository?.listUsersByRole === 'function'
    ? await userRepository.listUsersByRole(ROLES.SALESPERSON)
    : [];
  if (!salespeople.some((user) => Number(user.id) === coordinatorUserId)) {
    throw new Error('Customer coordinator must be an active salesperson');
  }
  const updated = await customerRepository.updateCoordinator(Number(customerId), {
    coordinatorUserId,
    actorUserId: Number(actor.id),
    note
  });
  if (!updated) {
    throw new Error('Customer not found');
  }
  return updated;
}

export async function archiveCustomer(customerRepository, actor, customerId, reason) {
  if (!canArchiveCustomer(actor)) {
    forbidden();
  }
  const archived = await customerRepository.archiveById(Number(customerId), {
    actorUserId: Number(actor.id),
    reason: lifecycleReason(reason, 'Archive')
  });
  if (!archived) {
    throw new Error('Customer not found or already archived');
  }
}

export async function reopenCustomer(customerRepository, actor, customerId, reason) {
  if (!canArchiveCustomer(actor)) {
    forbidden();
  }
  const reopened = await customerRepository.reopenById(Number(customerId), {
    actorUserId: Number(actor.id),
    reason: lifecycleReason(reason, 'Reopen')
  });
  if (!reopened) {
    throw new Error('Customer not found or not archived');
  }
}
