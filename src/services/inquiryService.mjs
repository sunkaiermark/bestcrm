import {
  INQUIRY_ACTIVE_STATUSES,
  INQUIRY_DISPOSITION_STATUSES,
  INQUIRY_PRIORITIES,
  INQUIRY_SOURCES,
  INQUIRY_STATUSES,
  isActiveInquiryStatus,
  isInquiryPriority,
  isInquirySource,
  isInquiryStatus
} from '../domain/inquiries.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { createContact } from './contactService.mjs';
import { canMaintainCustomer, createCustomer } from './customerService.mjs';
import { removeStoredAttachmentFile, resolveStoredPath } from './attachmentFileService.mjs';
import { copyInquiryAttachmentsToOpportunity } from './emailInquiryAttachmentService.mjs';
import { createOpportunityDraft } from './opportunityService.mjs';

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

function isoTimestampOrNull(value) {
  const normalized = text(value);
  return normalized || null;
}

function textInputOrCurrent(input, field, currentInquiry) {
  return Object.hasOwn(input, field) ? text(input[field]) : text(currentInquiry[field]);
}

function numberInputOrCurrent(input, field, currentValue) {
  return Object.hasOwn(input, field) ? numberOrNull(input[field]) : numberOrNull(currentValue);
}

function assertInquiryActionable(inquiry) {
  if (!isActiveInquiryStatus(inquiry.status)) {
    throw new Error('Inquiry already processed');
  }
}

export function canAccessInquiryInbox(user) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER)
    || hasRole(user, ROLES.SALESPERSON);
}

export function canViewInquiry(user, inquiry) {
  if (hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)) {
    return true;
  }
  return Number(inquiry.assignedUserId) === Number(user.id)
    || Number(inquiry.createdBy) === Number(user.id);
}

export function canDeleteInquiry(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

export function canProcessInquiry(inquiry) {
  return isActiveInquiryStatus(inquiry?.status);
}

export function inquiryListFilterFor(user, query = {}) {
  const filter = {};
  if (isInquiryStatus(query.status)) {
    filter.status = query.status;
  } else {
    filter.excludeStatuses = [...INQUIRY_DISPOSITION_STATUSES, 'duplicate', 'archived'];
  }
  if (isInquirySource(query.source)) {
    filter.source = query.source;
  }
  if (hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)) {
    if (query.assignedUserId) {
      filter.assignedUserId = Number(query.assignedUserId);
    }
    return filter;
  }
  filter.visibleToUserId = user.id;
  return filter;
}

export function normalizeInquiryInput(input, actor) {
  const source = isInquirySource(input.source) ? input.source : 'manual';
  const priority = isInquiryPriority(input.priority) ? input.priority : 'normal';
  const status = isActiveInquiryStatus(input.status) ? input.status : 'new';
  return {
    source,
    sourceReference: text(input.sourceReference),
    sourceReceivedAt: isoTimestampOrNull(input.sourceReceivedAt),
    subject: text(input.subject),
    companyName: text(input.companyName),
    contactName: text(input.contactName),
    contactEmail: text(input.contactEmail).toLowerCase(),
    contactPhone: text(input.contactPhone),
    country: text(input.country),
    productInterest: text(input.productInterest),
    opportunityType: text(input.opportunityType),
    requirementText: text(input.requirementText),
    rawPayload: input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload : {},
    priority,
    status,
    assignedUserId: numberOrNull(input.assignedUserId) || actor.id,
    matchedCustomerId: numberOrNull(input.matchedCustomerId),
    matchedContactId: numberOrNull(input.matchedContactId),
    createdBy: actor.id,
    reviewNote: text(input.reviewNote)
  };
}

export function normalizeInquiryReviewInput(input, actor, currentInquiry = {}) {
  const status = isActiveInquiryStatus(input.status) ? input.status : currentInquiry.status || 'reviewing';
  const priority = isInquiryPriority(input.priority) ? input.priority : currentInquiry.priority || 'normal';
  return {
    status,
    priority,
    assignedUserId: numberOrNull(input.assignedUserId) || currentInquiry.assignedUserId || actor.id,
    matchedCustomerId: numberOrNull(input.matchedCustomerId),
    matchedContactId: numberOrNull(input.matchedContactId),
    subject: textInputOrCurrent(input, 'subject', currentInquiry),
    companyName: textInputOrCurrent(input, 'companyName', currentInquiry),
    contactName: textInputOrCurrent(input, 'contactName', currentInquiry),
    contactEmail: textInputOrCurrent(input, 'contactEmail', currentInquiry).toLowerCase(),
    contactPhone: textInputOrCurrent(input, 'contactPhone', currentInquiry),
    country: textInputOrCurrent(input, 'country', currentInquiry),
    productInterest: textInputOrCurrent(input, 'productInterest', currentInquiry),
    opportunityType: textInputOrCurrent(input, 'opportunityType', currentInquiry),
    requirementText: textInputOrCurrent(input, 'requirementText', currentInquiry),
    reviewNote: text(input.reviewNote),
    reviewedBy: actor.id
  };
}

async function validateMatchedRecords({ customerRepository, contactRepository }, actor, input) {
  if (input.matchedCustomerId) {
    const customer = await customerRepository.getCustomerDetail(input.matchedCustomerId);
    if (!customer) {
      throw new Error('Customer not found');
    }
    if (!canMaintainCustomer(actor, customer) && !hasRole(actor, ROLES.SALES_MANAGER)) {
      forbidden();
    }
  }
  if (input.matchedContactId) {
    const contact = await contactRepository.getContactDetail(input.matchedContactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (input.matchedCustomerId && Number(contact.customerId) !== Number(input.matchedCustomerId)) {
      throw new Error('Contact does not belong to customer');
    }
  }
}

export async function createInquiry(inquiryRepository, actor, input) {
  if (!canAccessInquiryInbox(actor)) {
    forbidden();
  }
  const normalized = normalizeInquiryInput(input, actor);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  return inquiryRepository.createInquiry(normalized);
}

export async function updateInquiryReview({ inquiryRepository, customerRepository, contactRepository }, actor, inquiry, input) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  const normalized = normalizeInquiryReviewInput(input, actor, inquiry);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  await validateMatchedRecords({ customerRepository, contactRepository }, actor, normalized);
  const updated = await inquiryRepository.updateReview(inquiry.id, normalized);
  if (!updated) {
    throw new Error('Inquiry already processed');
  }
  return updated;
}

function opportunityTitleForInquiry(inquiry, input) {
  return text(input.title)
    || inquiry.subject
    || inquiry.productInterest
    || inquiry.companyName
    || `Inquiry ${inquiry.id}`;
}

export async function convertInquiryToOpportunity(repositories, actor, inquiry, input = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  let customerId = numberInputOrCurrent(input, 'customerId', inquiry.matchedCustomerId);
  if (!customerId && input.createMissingRecords === '1') {
    const customerName = text(input.newCustomerName) || inquiry.companyName;
    if (!customerName) {
      throw new Error('Customer name is required');
    }
    const customer = await createCustomer(repositories.customerRepository, actor, {
      name: customerName,
      country: text(input.newCustomerCountry) || inquiry.country,
      notes: text(input.newCustomerNotes) || inquiry.requirementText
    });
    customerId = customer.id;
  }
  if (!customerId) {
    throw new Error('Customer is required');
  }
  let primaryContactId = numberInputOrCurrent(input, 'primaryContactId', inquiry.matchedContactId);
  const newContactName = text(input.newContactName) || inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone;
  if (!primaryContactId && input.createMissingRecords === '1' && newContactName) {
    const contact = await createContact({
      customerRepository: repositories.customerRepository,
      contactRepository: repositories.contactRepository
    }, actor, {
      customerId,
      name: newContactName,
      phone: text(input.newContactPhone) || inquiry.contactPhone,
      email: text(input.newContactEmail) || inquiry.contactEmail,
      notes: text(input.newContactNotes) || inquiry.requirementText
    });
    primaryContactId = contact.id;
  }
  const opportunity = await createOpportunityDraft(repositories, actor, {
    opportunityNo: null,
    title: opportunityTitleForInquiry(inquiry, input),
    customerId,
    primaryContactId,
    requirement: text(input.requirement) || inquiry.requirementText,
    estimatedAmount: input.estimatedAmount,
    productInterest: text(input.productInterest) || inquiry.productInterest,
    projectType: text(input.projectType) || inquiry.opportunityType,
    deliveryCycle: input.deliveryCycle,
    expectedBidDate: input.expectedBidDate,
    status: STATUSES.DRAFT
  });
  await copyInquiryAttachmentsToOpportunity({
    inquiryAttachmentRepository: repositories.inquiryAttachmentRepository,
    attachmentRepository: repositories.attachmentRepository,
    inquiryId: inquiry.id,
    opportunityId: opportunity.id,
    actor,
    uploadDir: repositories.uploadDir || './var/uploads'
  });
  const converted = await repositories.inquiryRepository.markConverted(inquiry.id, {
    matchedCustomerId: customerId,
    matchedContactId: primaryContactId,
    convertedOpportunityId: opportunity.id,
    reviewedBy: actor.id
  });
  if (!converted) {
    throw new Error('Inquiry already processed');
  }
  return opportunity;
}

function dispositionReviewNote(inquiry, input) {
  return text(input.reviewNote) || inquiry.reviewNote || '';
}

async function markDisposition(inquiryRepository, actor, inquiry, input) {
  const updated = await inquiryRepository.markDisposition(inquiry.id, {
    ...input,
    reviewNote: dispositionReviewNote(inquiry, input),
    reviewedBy: actor.id
  });
  if (!updated) {
    throw new Error('Inquiry already processed');
  }
  return updated;
}

export async function saveInquiryAsCustomer(repositories, actor, inquiry, input = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  let customerId = numberInputOrCurrent(input, 'customerId', inquiry.matchedCustomerId);
  if (customerId) {
    await validateMatchedRecords(repositories, actor, { matchedCustomerId: customerId, matchedContactId: null });
  } else {
    const name = text(input.name) || inquiry.companyName;
    if (!name) {
      throw new Error('Customer name is required');
    }
    const customer = await createCustomer(repositories.customerRepository, actor, {
      name,
      website: input.website,
      industry: input.industry,
      country: text(input.country) || inquiry.country,
      region: input.region,
      notes: text(input.notes) || inquiry.requirementText
    });
    customerId = customer.id;
  }
  return markDisposition(repositories.inquiryRepository, actor, inquiry, {
    status: 'customer_saved',
    matchedCustomerId: customerId,
    matchedContactId: null,
    reviewNote: input.reviewNote
  });
}

export async function saveInquiryAsContact(repositories, actor, inquiry, input = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  let customerId = numberInputOrCurrent(input, 'customerId', inquiry.matchedCustomerId);
  let contactId = numberInputOrCurrent(input, 'contactId', inquiry.matchedContactId);
  if (contactId) {
    const contact = await repositories.contactRepository.getContactDetail(contactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    customerId = customerId || contact.customerId;
    await validateMatchedRecords(repositories, actor, {
      matchedCustomerId: customerId,
      matchedContactId: contactId
    });
  } else {
    if (!customerId) {
      const customerName = text(input.newCustomerName) || inquiry.companyName;
      if (!customerName) {
        throw new Error('Customer is required');
      }
      const customer = await createCustomer(repositories.customerRepository, actor, {
        name: customerName,
        country: text(input.newCustomerCountry) || inquiry.country,
        notes: text(input.newCustomerNotes) || inquiry.requirementText
      });
      customerId = customer.id;
    }
    const name = text(input.name) || inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone;
    if (!name) {
      throw new Error('Contact name is required');
    }
    const contact = await createContact({
      customerRepository: repositories.customerRepository,
      contactRepository: repositories.contactRepository
    }, actor, {
      customerId,
      name,
      title: input.title,
      phone: text(input.phone) || inquiry.contactPhone,
      email: text(input.email) || inquiry.contactEmail,
      wechat: input.wechat,
      notes: text(input.notes) || inquiry.requirementText
    });
    contactId = contact.id;
  }
  return markDisposition(repositories.inquiryRepository, actor, inquiry, {
    status: 'contact_saved',
    matchedCustomerId: customerId,
    matchedContactId: contactId,
    reviewNote: input.reviewNote
  });
}

export async function markInquiryAsSpam(inquiryRepository, actor, inquiry, input = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  return markDisposition(inquiryRepository, actor, inquiry, {
    status: 'spam',
    matchedCustomerId: inquiry.matchedCustomerId,
    matchedContactId: inquiry.matchedContactId,
    reviewNote: input.reviewNote
  });
}

export async function deleteInquiry({ inquiryRepository, inquiryAttachmentRepository, uploadDir }, actor, inquiry) {
  if (!canDeleteInquiry(actor)) {
    forbidden();
  }
  const attachments = typeof inquiryAttachmentRepository?.listByInquiry === 'function'
    ? await inquiryAttachmentRepository.listByInquiry(inquiry.id)
    : [];
  const deleted = await inquiryRepository.deleteById(inquiry.id);
  if (!deleted) {
    throw new Error('Inquiry not found');
  }
  for (const attachment of attachments) {
    const filePath = resolveStoredPath(uploadDir || './var/uploads', attachment.storedPath);
    if (filePath) {
      await removeStoredAttachmentFile(filePath);
    }
  }
}

export const inquiryFormOptions = {
  sources: INQUIRY_SOURCES,
  statuses: INQUIRY_STATUSES,
  reviewStatuses: INQUIRY_ACTIVE_STATUSES,
  priorities: INQUIRY_PRIORITIES
};
