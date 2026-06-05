import { canMaintainContact, canMaintainCustomer } from './customerService.mjs';

function forbidden() {
  throw new Error('Forbidden');
}

function text(value) {
  return String(value || '').trim();
}

export function normalizeContactInput(input) {
  return {
    customerId: Number(input.customerId),
    name: text(input.name),
    title: text(input.title),
    phone: text(input.phone),
    email: text(input.email),
    wechat: text(input.wechat),
    notes: text(input.notes)
  };
}

export async function createContact({ customerRepository, contactRepository }, actor, input) {
  const normalized = normalizeContactInput(input);
  const customer = await customerRepository.getCustomerDetail(normalized.customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (!canMaintainCustomer(actor, customer)) {
    forbidden();
  }
  return contactRepository.createContact(normalized);
}

export async function updateContact(contactRepository, actor, contactId, input) {
  const existing = await contactRepository.getContactDetail(contactId);
  if (!existing) {
    throw new Error('Contact not found');
  }
  if (!canMaintainContact(actor, existing)) {
    forbidden();
  }
  return contactRepository.updateContact(contactId, {
    ...normalizeContactInput({ ...existing, ...input }),
    customerId: existing.customerId
  });
}
