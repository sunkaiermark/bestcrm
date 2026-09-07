import { ROLES, hasRole } from '../domain/roles.mjs';
import { canMaintainContact, canMaintainCustomer } from './customerService.mjs';

function forbidden() {
  throw new Error('Forbidden');
}

export class DuplicateContactError extends Error {
  constructor(duplicates) {
    super('Duplicate contact');
    this.name = 'DuplicateContactError';
    this.duplicates = duplicates;
  }
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
    educationBackground: text(input.educationBackground),
    workExperience: text(input.workExperience),
    keyAchievements: text(input.keyAchievements),
    notes: text(input.notes)
  };
}

export function canArchiveContact(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

function lifecycleReason(value, action) {
  const reason = text(value);
  if (!reason) {
    throw new Error(`${action} reason is required`);
  }
  return reason;
}

async function findDuplicateContacts(contactRepository, input, { excludeId } = {}) {
  if (!input.customerId || !input.name || !input.phone
    || typeof contactRepository.findDuplicatesByIdentity !== 'function') {
    return [];
  }
  return contactRepository.findDuplicatesByIdentity({
    customerId: input.customerId,
    name: input.name,
    phone: input.phone
  }, { excludeId });
}

async function assertNoDuplicateContact(contactRepository, input, options) {
  const duplicates = await findDuplicateContacts(contactRepository, input, options);
  if (duplicates.length > 0) {
    throw new DuplicateContactError(duplicates);
  }
}

async function persistWithoutDuplicateContact(contactRepository, input, operation, options) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code !== '23505' || error?.constraint !== 'contacts_customer_name_phone_unique_idx') {
      throw error;
    }
    const duplicates = await findDuplicateContacts(contactRepository, input, options);
    throw new DuplicateContactError(duplicates);
  }
}

export async function createContact({ customerRepository, contactRepository }, actor, input, options = {}) {
  const normalized = normalizeContactInput(input);
  const customer = await customerRepository.getCustomerDetail(normalized.customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (customer.archivedAt) {
    throw new Error('Customer is archived');
  }
  const managedInquiry = options.managedInquiry === true
    && (hasRole(actor, ROLES.ADMINISTRATOR) || hasRole(actor, ROLES.SALES_MANAGER));
  if (!canMaintainCustomer(actor, customer) && !managedInquiry) {
    forbidden();
  }
  await assertNoDuplicateContact(contactRepository, normalized);
  return persistWithoutDuplicateContact(
    contactRepository,
    normalized,
    () => contactRepository.createContact(normalized)
  );
}

export async function updateContact(contactRepository, actor, contactId, input) {
  const existing = await contactRepository.getContactDetail(contactId);
  if (!existing) {
    throw new Error('Contact not found');
  }
  if (!canMaintainContact(actor, existing)) {
    forbidden();
  }
  if (existing.archivedAt) {
    throw new Error('Contact is archived');
  }
  const normalized = {
    ...normalizeContactInput({ ...existing, ...input }),
    customerId: existing.customerId
  };
  const options = { excludeId: Number(contactId) };
  await assertNoDuplicateContact(contactRepository, normalized, options);
  return persistWithoutDuplicateContact(
    contactRepository,
    normalized,
    () => contactRepository.updateContact(contactId, normalized),
    options
  );
}

export async function archiveContact(contactRepository, actor, contactId, reason) {
  if (!canArchiveContact(actor)) {
    forbidden();
  }
  const archived = await contactRepository.archiveById(Number(contactId), {
    actorUserId: Number(actor.id),
    reason: lifecycleReason(reason, 'Archive')
  });
  if (!archived) {
    throw new Error('Contact not found or already archived');
  }
}

export async function reopenContact(contactRepository, actor, contactId, reason) {
  if (!canArchiveContact(actor)) {
    forbidden();
  }
  const reopened = await contactRepository.reopenById(Number(contactId), {
    actorUserId: Number(actor.id),
    reason: lifecycleReason(reason, 'Reopen')
  });
  if (!reopened) {
    throw new Error('Contact not found or not archived');
  }
}
