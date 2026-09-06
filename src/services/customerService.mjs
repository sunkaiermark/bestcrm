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
  return hasRole(user, ROLES.ADMINISTRATOR) || customer.ownerUserId === user.id;
}

export function canMaintainContact(user, contact) {
  return hasRole(user, ROLES.ADMINISTRATOR) || contact.customerOwnerUserId === user.id;
}

export function canDeleteCustomer(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

export function normalizeCustomerInput(input, ownerUserId) {
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
    ownerUserId,
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
  const ownerUserId = (hasRole(actor, ROLES.ADMINISTRATOR) || managedInquiry) && input.ownerUserId
    ? Number(input.ownerUserId)
    : actor.id;
  const normalized = normalizeCustomerInput(input, ownerUserId);
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
  const normalized = normalizeCustomerInput(input, existing.ownerUserId);
  const options = { excludeId: Number(customerId) };
  await assertNoDuplicateCustomer(customerRepository, normalized, options);
  return persistWithoutDuplicateCustomer(
    customerRepository,
    normalized,
    () => customerRepository.updateCustomer(customerId, normalized),
    options
  );
}

export async function deleteCustomer(customerRepository, actor, customerId) {
  if (!canDeleteCustomer(actor)) {
    forbidden();
  }
  const deleted = await customerRepository.deleteById(Number(customerId));
  if (!deleted) {
    throw new Error('Customer not found');
  }
}
