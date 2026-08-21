import { ROLES, hasRole } from '../domain/roles.mjs';

function forbidden() {
  throw new Error('Forbidden');
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

export async function createCustomer(customerRepository, actor, input) {
  const ownerUserId = hasRole(actor, ROLES.ADMINISTRATOR) && input.ownerUserId
    ? Number(input.ownerUserId)
    : actor.id;
  return customerRepository.createCustomer(normalizeCustomerInput(input, ownerUserId));
}

export async function updateCustomer(customerRepository, actor, customerId, input) {
  const existing = await customerRepository.getCustomerDetail(customerId);
  if (!existing) {
    throw new Error('Customer not found');
  }
  if (!canMaintainCustomer(actor, existing)) {
    forbidden();
  }
  return customerRepository.updateCustomer(customerId, normalizeCustomerInput(input, existing.ownerUserId));
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
