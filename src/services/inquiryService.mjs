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
import { confirmedProductCategoriesFromInput, resolveProductCategoryCode } from '../domain/productCategories.mjs';
import { ARCHIVED_STATUSES, STATUSES } from '../domain/statuses.mjs';
import { createContact } from './contactService.mjs';
import { createCustomer } from './customerService.mjs';
import { copyInquiryAttachmentsToOpportunity } from './emailInquiryAttachmentService.mjs';
import { canViewOpportunity, createOpportunityDraft } from './opportunityService.mjs';

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

function dateInputOrEmpty(value) {
  const normalized = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    return '';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? normalized
    : '';
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
    || hasRole(user, ROLES.SALES_MANAGER);
}

export function canViewInquiry(user) {
  return canAccessInquiryInbox(user);
}

export function canDeleteInquiry(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

export function canProcessInquiry(inquiry) {
  return isActiveInquiryStatus(inquiry?.status);
}

function isEligibleInquiryAssignee(user) {
  return user?.isActive !== false
    && hasRole(user, ROLES.SALES_MANAGER);
}

export function inquiryAssignableUsers(actor, users = []) {
  const eligibleUsers = users.filter(isEligibleInquiryAssignee);
  if (canAccessInquiryInbox(actor)) {
    return eligibleUsers;
  }
  return [];
}

function isEligibleSalesperson(user) {
  return user?.isActive !== false
    && hasRole(user, ROLES.SALESPERSON);
}

export function inquirySalespersonUsers(actor, users = []) {
  if (!canAccessInquiryInbox(actor)) {
    return [];
  }
  return users.filter(isEligibleSalesperson);
}

async function assertSalespersonAllowed(userRepository, actor, salespersonId) {
  const users = typeof userRepository?.listUsersWithRoles === 'function'
    ? await userRepository.listUsersWithRoles()
    : [];
  const salesperson = inquirySalespersonUsers(actor, users)
    .find((user) => Number(user.id) === Number(salespersonId));
  if (!salesperson) {
    throw new Error('Sales owner is required');
  }
  return salesperson;
}

async function assertInquiryAssigneeAllowed(userRepository, actor, assignedUserId) {
  const users = typeof userRepository?.listUsersWithRoles === 'function'
    ? await userRepository.listUsersWithRoles()
    : [actor];
  const allowed = inquiryAssignableUsers(actor, users)
    .some((user) => Number(user.id) === Number(assignedUserId));
  if (!allowed) {
    forbidden();
  }
}

export function inquiryListFilterFor(user, query = {}) {
  if (!canAccessInquiryInbox(user)) {
    forbidden();
  }
  const filter = {};
  if (isInquiryStatus(query.status)) {
    filter.status = query.status;
  } else {
    filter.excludeStatuses = [...INQUIRY_DISPOSITION_STATUSES, 'duplicate', 'archived'];
  }
  if (isInquirySource(query.source)) {
    filter.source = query.source;
  }
  const assignedUserId = Number(query.assignedUserId);
  if (Number.isSafeInteger(assignedUserId) && assignedUserId > 0) {
    filter.assignedUserId = assignedUserId;
  }
  const searchTerm = text(query.query).slice(0, 200);
  if (searchTerm) {
    filter.searchTerm = searchTerm;
  }
  const dateFrom = dateInputOrEmpty(query.dateFrom);
  if (dateFrom) {
    filter.dateFrom = dateFrom;
  }
  const dateTo = dateInputOrEmpty(query.dateTo);
  if (dateTo) {
    filter.dateTo = dateTo;
  }
  return filter;
}

export function normalizeInquiryInput(input, actor) {
  const source = isInquirySource(input.source) ? input.source : 'manual';
  const priority = isInquiryPriority(input.priority) ? input.priority : 'normal';
  const status = isActiveInquiryStatus(input.status) ? input.status : 'new';
  return {
    source,
    submissionType: 'standard',
    sourceChannel: source,
    sourceReference: text(input.sourceReference),
    sourceReceivedAt: isoTimestampOrNull(input.sourceReceivedAt),
    subject: text(input.subject),
    companyName: text(input.companyName),
    contactName: text(input.contactName),
    contactEmail: text(input.contactEmail).toLowerCase(),
    contactPhone: text(input.contactPhone),
    country: text(input.country),
    productInterest: text(input.productInterest),
    productCategoryCode: resolveProductCategoryCode(input),
    confirmedProductCategoryCodes: confirmedProductCategoriesFromInput(input),
    productCategoryReviewedBy: Number(actor.id),
    opportunityType: text(input.opportunityType),
    requirementText: text(input.requirementText),
    rawPayload: input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload : {},
    priority,
    status,
    assignedUserId: numberOrNull(input.assignedUserId) || actor.id,
    recommendedSalespersonId: null,
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
    productCategoryCode: resolveProductCategoryCode(input, currentInquiry.productCategoryCode),
    confirmedProductCategoryCodes: confirmedProductCategoriesFromInput(input, currentInquiry.confirmedProductCategoryCodes),
    productCategoryReviewedBy: Number(actor.id),
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
    if (customer.archivedAt) {
      throw new Error('Customer is archived');
    }
  }
  if (input.matchedContactId) {
    const contact = await contactRepository.getContactDetail(input.matchedContactId);
    if (!contact) {
      throw new Error('Contact not found');
    }
    if (contact.archivedAt) {
      throw new Error('Contact is archived');
    }
    if (input.matchedCustomerId && Number(contact.customerId) !== Number(input.matchedCustomerId)) {
      throw new Error('Contact does not belong to customer');
    }
  }
}

async function syncConvertedInquiryEmailThread(repositories, actor, inquiry, opportunity, customerId, contactId) {
  const repository = repositories.emailArchiveRepository;
  if (typeof repository?.findLatestThreadByInquiry !== 'function') return;
  const thread = await repository.findLatestThreadByInquiry(inquiry.id);
  if (!thread) return;
  if (thread.opportunityId) {
    if (Number(thread.opportunityId) !== Number(opportunity.id)) {
      throw new Error('Email thread is already linked to another opportunity');
    }
    if (thread.triageStatus === 'linked_opportunity') return;
  }
  if (thread.triageStatus !== 'converted_inquiry') return;
  const linked = await repository.linkConvertedInquiryThreadToOpportunity({
    threadId: thread.id,
    inquiryId: inquiry.id,
    opportunityId: opportunity.id,
    customerId,
    contactId
  });
  if (!linked) {
    throw new Error('Email thread link changed; refresh and try again');
  }
  const triagedAt = new Date().toISOString();
  const note = `Inquiry #${inquiry.id} linked to ${opportunity.opportunityNo || opportunity.id}`;
  const transitioned = await repository.transitionThreadTriage({
    threadId: thread.id,
    expectedStatus: 'converted_inquiry',
    triageStatus: 'linked_opportunity',
    archiveDisposition: thread.archiveDisposition || 'active',
    actorUserId: actor.id,
    triagedAt,
    note
  });
  if (!transitioned) {
    throw new Error('Email thread triage changed; refresh and try again');
  }
  if (typeof repository.createTriageEvent === 'function') {
    await repository.createTriageEvent({
      threadId: thread.id,
      eventType: 'linked_opportunity',
      fromStatus: 'converted_inquiry',
      toStatus: 'linked_opportunity',
      actorUserId: actor.id,
      assignedUserId: thread.triageAssignedUserId,
      inquiryId: inquiry.id,
      opportunityId: opportunity.id,
      note
    });
  }
}

export async function createInquiry({ inquiryRepository, userRepository }, actor, input) {
  if (!canAccessInquiryInbox(actor)) {
    forbidden();
  }
  const normalized = normalizeInquiryInput(input, actor);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  await assertInquiryAssigneeAllowed(userRepository, actor, normalized.assignedUserId);
  return inquiryRepository.createInquiry(normalized);
}

export async function updateInquiryReview({ inquiryRepository, customerRepository, contactRepository, userRepository }, actor, inquiry, input) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  const normalized = normalizeInquiryReviewInput(input, actor, inquiry);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  await assertInquiryAssigneeAllowed(userRepository, actor, normalized.assignedUserId);
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

export async function convertInquiryToOpportunity(repositories, actor, inquiry, input = {}, options = {}) {
  if (!canViewInquiry(actor, inquiry)) {
    forbidden();
  }
  assertInquiryActionable(inquiry);
  const existingOpportunityId = numberOrNull(input.existingOpportunityId);
  let opportunity = null;
  let salespersonId = numberOrNull(input.salespersonId) || inquiry.recommendedSalespersonId;
  let customerId = numberInputOrCurrent(input, 'customerId', inquiry.matchedCustomerId);
  if (existingOpportunityId) {
    opportunity = await repositories.opportunityRepository.getOpportunityDetail(existingOpportunityId);
    if (!opportunity || opportunity.archivedAt || ARCHIVED_STATUSES.includes(opportunity.status)) {
      throw new Error('Active opportunity not found');
    }
    if (!canViewOpportunity(actor, opportunity)) {
      forbidden();
    }
    if (customerId && Number(customerId) !== Number(opportunity.customerId)) {
      throw new Error('Opportunity does not belong to customer');
    }
    customerId = opportunity.customerId;
    salespersonId = opportunity.salespersonId;
  } else {
    await assertSalespersonAllowed(repositories.userRepository, actor, salespersonId);
  }
  const createMissingRecords = input.createMissingRecords !== '0';
  if (!customerId && createMissingRecords && !existingOpportunityId) {
    const customerName = text(input.newCustomerName) || text(input.companyName) || inquiry.companyName;
    if (!customerName) {
      throw new Error('Customer name is required');
    }
    const customer = await createCustomer(repositories.customerRepository, actor, {
      name: customerName,
      coordinatorUserId: salespersonId,
      website: Object.hasOwn(input, 'companyWebsite')
        ? text(input.companyWebsite)
        : text(inquiry.companyWebsite),
      country: text(input.newCustomerCountry) || text(input.country) || inquiry.country,
      notes: text(input.newCustomerNotes) || inquiry.requirementText
    }, { managedInquiry: true });
    customerId = customer.id;
  }
  if (!customerId) {
    throw new Error('Customer is required');
  }
  const customer = await repositories.customerRepository.getCustomerDetail(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }
  if (customer.archivedAt) {
    throw new Error('Customer is archived');
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
    }, { managedInquiry: true });
    primaryContactId = contact.id;
  }
  if (primaryContactId && existingOpportunityId) {
    const selectedContact = await repositories.contactRepository.getContactDetail(primaryContactId);
    if (!selectedContact) {
      throw new Error('Contact not found');
    }
    if (selectedContact.archivedAt) {
      throw new Error('Contact is archived');
    }
    if (Number(selectedContact.customerId) !== Number(customerId)) {
      throw new Error('Contact does not belong to customer');
    }
  }
  const productCategoryCode = resolveProductCategoryCode(input, inquiry.productCategoryCode);
  if (!opportunity) {
    opportunity = await createOpportunityDraft(repositories, actor, {
      opportunityNo: null,
      title: opportunityTitleForInquiry(inquiry, input),
      customerId,
      primaryContactId,
      requirement: text(input.requirement) || text(input.requirementText) || inquiry.requirementText,
      estimatedAmount: input.estimatedAmount,
      productInterest: text(input.productInterest) || inquiry.productInterest,
      productCategoryCode,
      confirmedProductCategoryCodes: confirmedProductCategoriesFromInput(input, inquiry.confirmedProductCategoryCodes),
      projectType: text(input.projectType) || text(input.opportunityType) || inquiry.opportunityType,
      deliveryCycle: input.deliveryCycle,
      expectedBidDate: input.expectedBidDate,
      status: STATUSES.DRAFT
    }, {
      validatedCustomer: customer,
      inquiryConversion: true,
      originInquiryId: inquiry.id,
      salespersonId
    });
  }
  if (options.copyAttachments !== false) {
    await copyInquiryAttachmentsToOpportunity({
      inquiryAttachmentRepository: repositories.inquiryAttachmentRepository,
      attachmentRepository: repositories.attachmentRepository,
      inquiryId: inquiry.id,
      opportunityId: opportunity.id,
      actor,
      uploadDir: repositories.uploadDir || './var/uploads'
    });
  }
  const converted = await repositories.inquiryRepository.markConverted(inquiry.id, {
    matchedCustomerId: customerId,
    matchedContactId: primaryContactId,
    convertedOpportunityId: opportunity.id,
    productCategoryCode,
    confirmedProductCategoryCodes: confirmedProductCategoriesFromInput(input, inquiry.confirmedProductCategoryCodes),
    reviewedBy: actor.id
  });
  if (!converted) {
    throw new Error('Inquiry already processed');
  }
  if (typeof repositories.inquiryRepository.recordOpportunityLink === 'function') {
    await repositories.inquiryRepository.recordOpportunityLink({
      inquiryId: inquiry.id,
      customerId,
      opportunityId: opportunity.id,
      linkKind: existingOpportunityId ? 'existing' : 'created',
      actorUserId: actor.id,
      source: 'inquiry_conversion',
      note: existingOpportunityId
        ? 'Inquiry classified into an existing opportunity for the same project.'
        : 'Inquiry converted into an independent opportunity under the shared customer.'
    });
  }
  await syncConvertedInquiryEmailThread(
    repositories,
    actor,
    inquiry,
    opportunity,
    customerId,
    primaryContactId
  );
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
    if (customer.archivedAt) {
      throw new Error('Customer is archived');
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
  throw new Error('Customer approval workflow is retired; select the shared customer and continue');
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
    productCategoryCode: resolveProductCategoryCode(payload, inquiry.productCategoryCode),
    confirmedProductCategoryCodes: confirmedProductCategoriesFromInput(payload, inquiry.confirmedProductCategoryCodes),
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

export async function deleteInquiry({ attachmentIntegrityRepository }, actor, inquiry) {
  if (!canDeleteInquiry(actor)) {
    forbidden();
  }
  if (typeof attachmentIntegrityRepository?.planInquiryAttachmentPurge !== 'function') {
    throw new Error('Inquiry attachment purge repository is not configured');
  }
  return attachmentIntegrityRepository.planInquiryAttachmentPurge({
    inquiryId: inquiry.id,
    actorUserId: actor.id,
    reason: 'administrator_deleted_provisional_inquiry',
    deleteInquiry: true
  });
}

export const inquiryFormOptions = {
  sources: INQUIRY_SOURCES,
  statuses: INQUIRY_STATUSES,
  reviewStatuses: INQUIRY_ACTIVE_STATUSES,
  priorities: INQUIRY_PRIORITIES
};
