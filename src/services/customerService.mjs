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

export async function createCustomer(customerRepository, actor, input) {
  const ownerUserId = hasRole(actor, ROLES.ADMINISTRATOR) && input.ownerUserId
    ? Number(input.ownerUserId)
    : actor.id;
  const normalized = normalizeCustomerInput(input, ownerUserId);
  await assertNoDuplicateCustomer(customerRepository, normalized);
  return customerRepository.createCustomer(normalized);
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
  await assertNoDuplicateCustomer(customerRepository, normalized, { excludeId: Number(customerId) });
  return customerRepository.updateCustomer(customerId, normalized);
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
