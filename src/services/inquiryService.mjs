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

function inputValue(input, fields) {
  for (const field of fields) {
    if (Object.hasOwn(input, field)) {
      return input[field];
    }
  }
  return undefined;
}

function numberInputFromAliasesOrCurrent(input, fields, currentValue) {
  const value = inputValue(input, fields);
  return value === undefined ? numberOrNull(currentValue) : numberOrNull(value);
}

export class CustomerApprovalRequiredError extends Error {
  constructor(customer) {
    super('Customer approval required');
    this.name = 'CustomerApprovalRequiredError';
    this.customer = customer;
  }
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
    matchedCustomerId: numberInputFromAliasesOrCurrent(input, ['matchedCustomerId', 'customerId'], currentInquiry.matchedCustomerId),
    matchedContactId: numberInputFromAliasesOrCurrent(input, ['matchedContactId', 'primaryContactId'], currentInquiry.matchedContactId),
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
  const createMissingRecords = input.createMissingRecords !== '0';
  if (!customerId && createMissingRecords) {
    const customerName = text(input.newCustomerName) || text(input.companyName) || inquiry.companyName;
    if (!customerName) {
      throw new Error('Customer name is required');
    }
    const customer = await createCustomer(repositories.customerRepository, actor, {
      name: customerName,
      country: text(input.newCustomerCountry) || text(input.country) || inquiry.country,
      notes: text(input.newCustomerNotes) || inquiry.requirementText
    });
    customerId = customer.id;
  }
  if (!customerId) {
    throw new Error('Customer is required');
  }
  const customer = await repositories.customerRepository.getCustomerDetail(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (!canMaintainCustomer(actor, customer)) {
    throw new CustomerApprovalRequiredError(customer);
  }
  let primaryContactId = numberInputOrCurrent(input, 'primaryContactId', inquiry.matchedContactId);
  const newContactName = text(input.newContactName) || text(input.contactName) || inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone;
  if (!primaryContactId && createMissingRecords && newContactName) {
    const contact = await createContact({
      customerRepository: repositories.customerRepository,
      contactRepository: repositories.contactRepository
    }, actor, {
      customerId,
      name: newContactName,
      phone: text(input.newContactPhone) || text(input.contactPhone) || inquiry.contactPhone,
      email: text(input.newContactEmail) || text(input.contactEmail) || inquiry.contactEmail,
      notes: text(input.newContactNotes) || inquiry.requirementText
    });
    primaryContactId = contact.id;
  }
  const opportunity = await createOpportunityDraft(repositories, actor, {
    opportunityNo: null,
    title: opportunityTitleForInquiry(inquiry, input),
    customerId,
    primaryContactId,
    requirement: text(input.requirement) || text(input.requirementText) || inquiry.requirementText,
    estimatedAmount: input.estimatedAmount,
    productInterest: text(input.productInterest) || inquiry.productInterest,
    projectType: text(input.projectType) || text(input.opportunityType) || inquiry.opportunityType,
    deliveryCycle: input.deliveryCycle,
    expectedBidDate: input.expectedBidDate,
    status: STATUSES.DRAFT
  }, { validatedCustomer: customer });
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

export async function saveInquiryRecords(repositories, actor, inquiry, input = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  let customerId = numberInputOrCurrent(input, 'customerId', inquiry.matchedCustomerId);
  if (customerId) {
    const customer = await repositories.customerRepository.getCustomerDetail(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }
    if (!canMaintainCustomer(actor, customer)) {
      throw new CustomerApprovalRequiredError(customer);
    }
  } else {
    const customerName = text(input.companyName) || inquiry.companyName;
    if (!customerName) {
      throw new Error('Customer name is required');
    }
    const customer = await createCustomer(repositories.customerRepository, actor, {
      name: customerName,
      country: text(input.country) || inquiry.country,
      notes: text(input.requirementText) || inquiry.requirementText
    });
    customerId = customer.id;
  }

  let contactId = numberInputOrCurrent(input, 'primaryContactId', inquiry.matchedContactId);
  if (contactId) {
    const contact = await repositories.contactRepository.getContactDetail(contactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (Number(contact.customerId) !== Number(customerId)) {
      throw new Error('Contact does not belong to customer');
    }
  } else {
    const contactName = text(input.contactName) || inquiry.contactName || inquiry.contactEmail || inquiry.contactPhone;
    if (contactName) {
      const contact = await createContact({
        customerRepository: repositories.customerRepository,
        contactRepository: repositories.contactRepository
      }, actor, {
        customerId,
        name: contactName,
        phone: text(input.contactPhone) || inquiry.contactPhone,
        email: text(input.contactEmail) || inquiry.contactEmail,
        notes: text(input.requirementText) || inquiry.requirementText
      });
      contactId = contact.id;
    }
  }

  return markDisposition(repositories.inquiryRepository, actor, inquiry, {
    status: contactId ? 'contact_saved' : 'customer_saved',
    matchedCustomerId: customerId,
    matchedContactId: contactId,
    reviewNote: input.reviewNote
  });
}

function customerApprovalPayload(inquiry, input) {
  return {
    primaryContactId: numberInputOrCurrent(input, 'primaryContactId', inquiry.matchedContactId),
    newContactName: text(input.contactName) || text(inquiry.contactName) || text(inquiry.contactEmail) || text(inquiry.contactPhone),
    newContactTitle: text(input.contactTitle),
    newContactPhone: text(input.contactPhone) || text(inquiry.contactPhone),
    newContactEmail: text(input.contactEmail) || text(inquiry.contactEmail),
    newContactNotes: text(input.requirementText) || inquiry.requirementText,
    title: opportunityTitleForInquiry(inquiry, input),
    requirement: text(input.requirementText) || text(input.requirement) || inquiry.requirementText,
    estimatedAmount: numberOrNull(input.estimatedAmount),
    productInterest: text(input.productInterest) || inquiry.productInterest,
    projectType: text(input.opportunityType) || text(input.projectType) || inquiry.opportunityType,
    deliveryCycle: text(input.deliveryCycle),
    expectedBidDate: text(input.expectedBidDate) || null
  };
}

async function customerApprovalReviewer(repositories, actor) {
  if (typeof repositories.approvalSettingRepository?.findActiveByKey === 'function') {
    const setting = await repositories.approvalSettingRepository.findActiveByKey('inquiry_customer_access');
    if (setting?.roleCode === ROLES.SALES_MANAGER && Number(setting.userId) !== Number(actor.id)) {
      return { id: Number(setting.userId), displayName: setting.userDisplayName || setting.username || '' };
    }
  }
  if (typeof repositories.userRepository?.listUsersWithRoles === 'function') {
    const users = await repositories.userRepository.listUsersWithRoles();
    const reviewer = users.find((user) => user.isActive !== false
      && Number(user.id) !== Number(actor.id)
      && hasRole(user, ROLES.SALES_MANAGER));
    if (reviewer) {
      return reviewer;
    }
  }
  throw new Error('Sales manager is not configured');
}

export function canDecideInquiryCustomerApproval(user, approval) {
  if (!approval) {
    return false;
  }
  return hasRole(user, ROLES.ADMINISTRATOR)
    || (hasRole(user, ROLES.SALES_MANAGER) && Number(approval.reviewerUserId) === Number(user.id));
}

export async function requestInquiryCustomerApproval(repositories, actor, inquiry, input = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  const customerId = numberOrNull(input.approvalCustomerId || input.customerId);
  if (!customerId) {
    throw new Error('Customer is required');
  }
  const customer = await repositories.customerRepository.getCustomerDetail(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (canMaintainCustomer(actor, customer)) {
    throw new Error('Customer approval is not required');
  }
  const selectedCustomerId = numberOrNull(input.customerId);
  const approvalInput = selectedCustomerId && selectedCustomerId !== Number(customer.id)
    ? { ...input, primaryContactId: '' }
    : input;
  const payload = customerApprovalPayload(inquiry, approvalInput);
  if (payload.primaryContactId) {
    const contact = await repositories.contactRepository.getContactDetail(payload.primaryContactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (Number(contact.customerId) !== Number(customer.id)) {
      throw new Error('Contact does not belong to customer');
    }
  }
  const reviewer = await customerApprovalReviewer(repositories, actor);
  try {
    const approval = await repositories.inquiryCustomerApprovalRepository.createPending({
      inquiryId: inquiry.id,
      customerId: customer.id,
      requestedBy: actor.id,
      customerOwnerUserId: customer.ownerUserId,
      reviewerUserId: reviewer.id,
      matchedContactId: payload.primaryContactId,
      requestPayload: payload
    });
    if (!approval) {
      throw new Error('Inquiry already processed');
    }
    return approval;
  } catch (error) {
    if (error?.code === '23505') {
      throw new Error('Customer approval already pending');
    }
    throw error;
  }
}

function canReviewCustomerApproval(actor) {
  return hasRole(actor, ROLES.ADMINISTRATOR) || hasRole(actor, ROLES.SALES_MANAGER);
}

export async function approveInquiryCustomerApproval(repositories, actor, inquiry, requestId, input = {}) {
  if (!canReviewCustomerApproval(actor)) {
    forbidden();
  }
  const allowAnyReviewer = hasRole(actor, ROLES.ADMINISTRATOR);
  const approval = await repositories.inquiryCustomerApprovalRepository.findById(requestId);
  if (!approval
    || approval.status !== 'pending'
    || Number(approval.inquiryId) !== Number(inquiry.id)
    || (!allowAnyReviewer && Number(approval.reviewerUserId) !== Number(actor.id))) {
    throw new Error('Customer approval is not pending');
  }
  const payload = approval.requestPayload || {};
  if (payload.primaryContactId) {
    const contact = await repositories.contactRepository.getContactDetail(payload.primaryContactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (Number(contact.customerId) !== Number(approval.customerId)) {
      throw new Error('Contact does not belong to customer');
    }
  }

  const opportunity = await repositories.inquiryCustomerApprovalRepository.completeApproval(approval.id, {
    ...payload,
    decidedBy: actor.id,
    decisionNote: text(input.decisionNote),
    allowAnyReviewer,
    inquiryId: inquiry.id
  });
  if (!opportunity) {
    throw new Error('Customer approval could not be completed');
  }

  await copyInquiryAttachmentsToOpportunity({
    inquiryAttachmentRepository: repositories.inquiryAttachmentRepository,
    attachmentRepository: repositories.attachmentRepository,
    inquiryId: inquiry.id,
    opportunityId: opportunity.id,
    actor: { id: approval.requestedBy },
    uploadDir: repositories.uploadDir || './var/uploads'
  });
  return opportunity;
}

export async function rejectInquiryCustomerApproval(repositories, actor, inquiry, requestId, input = {}) {
  if (!canReviewCustomerApproval(actor)) {
    forbidden();
  }
  const decisionNote = text(input.decisionNote);
  if (!decisionNote) {
    throw new Error('Decision note is required');
  }
  const rejected = await repositories.inquiryCustomerApprovalRepository.rejectAndReturnInquiry(requestId, {
    decidedBy: actor.id,
    decisionNote,
    allowAnyReviewer: hasRole(actor, ROLES.ADMINISTRATOR),
    inquiryId: inquiry.id
  });
  if (!rejected) {
    throw new Error('Customer approval is not pending');
  }
  return inquiry;
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
