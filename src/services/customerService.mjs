import { ROLES, hasRole } from '../domain/roles.mjs';

function forbidden() {
  throw new Error('Forbidden');
}

function text(value) {
  return String(value || '').trim();
}

export function canMaintainCustomer(user, customer) {
  return hasRole(user, ROLES.ADMINISTRATOR) || customer.ownerUserId === user.id;
}

export function canMaintainContact(user, contact) {
  return hasRole(user, ROLES.ADMINISTRATOR) || contact.customerOwnerUserId === user.id;
}

export function normalizeCustomerInput(input, ownerUserId) {
  return {
    name: text(input.name),
    industry: text(input.industry),
    region: text(input.region),
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
