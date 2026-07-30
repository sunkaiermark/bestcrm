import { INQUIRY_PRIORITIES, INQUIRY_SOURCES, INQUIRY_STATUSES, isInquiryPriority, isInquirySource, isInquiryStatus } from '../domain/inquiries.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { canMaintainCustomer } from './customerService.mjs';
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

export function inquiryListFilterFor(user, query = {}) {
  const filter = {};
  if (isInquiryStatus(query.status)) {
    filter.status = query.status;
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
  const status = isInquiryStatus(input.status) ? input.status : 'new';
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
  const status = isInquiryStatus(input.status) ? input.status : currentInquiry.status || 'reviewing';
  const priority = isInquiryPriority(input.priority) ? input.priority : currentInquiry.priority || 'normal';
  return {
    status,
    priority,
    assignedUserId: numberOrNull(input.assignedUserId) || currentInquiry.assignedUserId || actor.id,
    matchedCustomerId: numberOrNull(input.matchedCustomerId),
    matchedContactId: numberOrNull(input.matchedContactId),
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
  const normalized = normalizeInquiryReviewInput(input, actor, inquiry);
  await validateMatchedRecords({ customerRepository, contactRepository }, actor, normalized);
  return inquiryRepository.updateReview(inquiry.id, normalized);
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
  if (inquiry.status === 'converted' && inquiry.convertedOpportunityId) {
    throw new Error('Inquiry already converted');
  }
  const customerId = numberOrNull(input.customerId) || inquiry.matchedCustomerId;
  const primaryContactId = numberOrNull(input.primaryContactId) || inquiry.matchedContactId;
  if (!customerId) {
    throw new Error('Customer is required');
  }
  const opportunity = await createOpportunityDraft(repositories, actor, {
    opportunityNo: null,
    title: opportunityTitleForInquiry(inquiry, input),
    customerId,
    primaryContactId,
    requirement: text(input.requirement) || inquiry.requirementText,
    estimatedAmount: input.estimatedAmount,
    projectType: text(input.projectType) || inquiry.productInterest,
    deliveryCycle: input.deliveryCycle,
    expectedBidDate: input.expectedBidDate,
    status: STATUSES.DRAFT
  });
  await repositories.inquiryRepository.markConverted(inquiry.id, {
    matchedCustomerId: customerId,
    matchedContactId: primaryContactId,
    convertedOpportunityId: opportunity.id,
    reviewedBy: actor.id
  });
  return opportunity;
}

export const inquiryFormOptions = {
  sources: INQUIRY_SOURCES,
  statuses: INQUIRY_STATUSES,
  priorities: INQUIRY_PRIORITIES
};
