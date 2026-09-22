import { ROLES, hasRole } from '../domain/roles.mjs';
import {
  LEAD_ACTIVE_STATUSES,
  LEAD_PROCESSED_STATUSES,
  isInquiryPriority,
  isSalesLeadSourceChannel
} from '../domain/inquiries.mjs';
import { convertInquiryToOpportunity } from './inquiryService.mjs';

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

export function canSubmitNewLead(user) {
  return Number.isInteger(Number(user?.id))
    && Number(user.id) > 0
    && user?.isActive !== false;
}

export function canViewLeadSubmission(user, inquiry) {
  if (!canSubmitNewLead(user) || inquiry?.submissionType !== 'sales_lead') {
    return false;
  }
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.SALES_MANAGER)
    || Number(inquiry.createdBy) === Number(user.id);
}

export function leadSubmissionListFilterFor(user, view = 'active') {
  if (!canSubmitNewLead(user)) {
    forbidden();
  }
  const base = {
    submissionType: 'sales_lead',
    statuses: view === 'processed' ? LEAD_PROCESSED_STATUSES : LEAD_ACTIVE_STATUSES
  };
  return hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)
    ? base
    : { ...base, createdBy: Number(user.id) };
}

export function canReviewLeadSubmission(user, inquiry) {
  return canSubmitNewLead(user)
    && hasRole(user, ROLES.SALES_MANAGER)
    && inquiry?.submissionType === 'sales_lead'
    && inquiry.status === 'new'
    && Number(inquiry.assignedUserId) === Number(user.id);
}

export function canResubmitLeadSubmission(user, inquiry) {
  return canSubmitNewLead(user)
    && inquiry?.submissionType === 'sales_lead'
    && inquiry.status === 'returned'
    && Number(inquiry.createdBy) === Number(user.id);
}

export function canEditLeadSubmission(user, inquiry) {
  return canSubmitNewLead(user)
    && inquiry?.submissionType === 'sales_lead'
    && ['new', 'returned'].includes(inquiry.status)
    && Number(inquiry.createdBy) === Number(user.id);
}

export function canReassignLeadReviewer(user, inquiry) {
  return canSubmitNewLead(user)
    && hasRole(user, ROLES.ADMINISTRATOR)
    && inquiry?.submissionType === 'sales_lead'
    && LEAD_ACTIVE_STATUSES.includes(inquiry.status);
}

export function listEligibleReviewManagers(users = []) {
  return users.filter((user) => user?.isActive !== false && hasRole(user, ROLES.SALES_MANAGER));
}

export function listEligibleSalespeople(users = []) {
  return users.filter((user) => user?.isActive !== false && hasRole(user, ROLES.SALESPERSON));
}

export function normalizeLeadSubmissionInput(input, actor) {
  const sourceChannel = isSalesLeadSourceChannel(input.sourceChannel) ? input.sourceChannel : 'other';
  const submissionToken = text(input.submissionToken);
  const emailThreadId = numberOrNull(input.emailThreadId);
  const recommendedSalespersonId = hasRole(actor, ROLES.SALESPERSON)
    ? Number(actor.id)
    : numberOrNull(input.recommendedSalespersonId);
  return {
    source: 'manual',
    submissionType: 'sales_lead',
    sourceChannel,
    sourceReference: submissionToken ? `sales-lead:${actor.id}:${submissionToken}` : '',
    sourceReceivedAt: null,
    subject: text(input.subject),
    companyName: text(input.companyName),
    contactName: text(input.contactName),
    contactEmail: text(input.contactEmail).toLowerCase(),
    contactPhone: text(input.contactPhone),
    country: text(input.country),
    productInterest: text(input.productInterest),
    opportunityType: text(input.opportunityType),
    requirementText: text(input.requirementText),
    rawPayload: {
      intakeKind: 'sales_lead',
      sourceChannel,
      ...(Number.isInteger(emailThreadId) && emailThreadId > 0 ? { emailThreadId } : {})
    },
    priority: isInquiryPriority(input.priority) ? input.priority : 'normal',
    status: 'new',
    assignedUserId: numberOrNull(input.assignedUserId),
    recommendedSalespersonId,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: Number(actor.id),
    reviewNote: ''
  };
}

function normalizeLeadResubmissionInput(input, actor, current) {
  const normalized = normalizeLeadSubmissionInput({
    ...current,
    ...input,
    submissionToken: '00000000-0000-0000-0000-000000000000',
    emailThreadId: current.rawPayload?.emailThreadId
  }, actor);
  return {
    ...normalized,
    actorUserId: Number(actor.id)
  };
}

async function validateLeadRouting(userRepository, normalized, options = {}) {
  const users = typeof userRepository?.listUsersWithRoles === 'function'
    ? await userRepository.listUsersWithRoles()
    : [];
  const manager = listEligibleReviewManagers(users)
    .find((user) => Number(user.id) === Number(normalized.assignedUserId));
  if (!manager) {
    throw new Error('Sales manager is required');
  }
  if (options.requireSalesperson !== false) {
    const salesperson = listEligibleSalespeople(users)
      .find((user) => Number(user.id) === Number(normalized.recommendedSalespersonId));
    if (!salesperson) {
      throw new Error('Sales owner is required');
    }
  }
}

export async function submitSalesLead({ inquiryRepository, userRepository }, actor, input) {
  if (!canSubmitNewLead(actor)) {
    forbidden();
  }
  const normalized = normalizeLeadSubmissionInput(input, actor);
  if (!normalized.requirementText) {
    throw new Error('Requirement is required');
  }
  if (!normalized.companyName && !normalized.contactName && !normalized.contactEmail && !normalized.contactPhone) {
    throw new Error('Company or contact is required');
  }
  if (!normalized.sourceReference || !/^sales-lead:\d+:[0-9a-f-]{36}$/i.test(normalized.sourceReference)) {
    throw new Error('Invalid submission token');
  }
  await validateLeadRouting(userRepository, normalized);
  return inquiryRepository.createInquiry(normalized);
}

function decisionReason(value) {
  const reason = text(value);
  if (!reason) {
    throw new Error('Decision reason is required');
  }
  return reason;
}

function assertLeadReviewable(actor, lead) {
  if (!lead) {
    throw new Error('Lead submission not found');
  }
  if (!canReviewLeadSubmission(actor, lead)) {
    if (lead.status !== 'new') {
      throw new Error('Lead already processed');
    }
    forbidden();
  }
}

async function withLeadTransaction(dependencies, callback) {
  if (typeof dependencies.emailArchiveTransaction === 'function') {
    return dependencies.emailArchiveTransaction((repositories) => callback({
      ...dependencies,
      ...repositories
    }));
  }
  return callback(dependencies);
}

async function lockLead(inquiryRepository, leadId) {
  if (typeof inquiryRepository?.findLeadByIdForUpdate === 'function') {
    return inquiryRepository.findLeadByIdForUpdate(leadId);
  }
  return inquiryRepository.findById(leadId);
}

async function createLeadReviewEvent(repository, input) {
  if (typeof repository?.createLeadReviewEvent !== 'function') {
    return null;
  }
  return repository.createLeadReviewEvent(input);
}

async function sourceEmailThread(emailArchiveRepository, lead) {
  if (!emailArchiveRepository) return null;
  const sourceThreadId = Number(lead?.rawPayload?.emailThreadId || 0);
  if (Number.isInteger(sourceThreadId) && sourceThreadId > 0
      && typeof emailArchiveRepository.findThreadById === 'function') {
    const thread = await emailArchiveRepository.findThreadById(sourceThreadId);
    if (thread && Number(thread.inquiryId) === Number(lead.id)) {
      return thread;
    }
  }
  return typeof emailArchiveRepository.findLatestThreadByInquiry === 'function'
    ? emailArchiveRepository.findLatestThreadByInquiry(lead.id)
    : null;
}

async function transitionLeadEmailToOpportunity(repository, actor, lead, opportunity) {
  const thread = await sourceEmailThread(repository, lead);
  if (!thread) return;
  if (thread.opportunityId && Number(thread.opportunityId) !== Number(opportunity.id)) {
    throw new Error('Source email is already linked to another opportunity');
  }
  if (!thread.opportunityId) {
    const linked = await repository.linkThreadToOpportunity(thread.id, opportunity.id, lead.id);
    if (!linked) {
      throw new Error('Source email link changed; refresh and try again');
    }
  }
  if (thread.triageStatus === 'linked_opportunity') return;
  if (!['converted_lead', 'linked_lead'].includes(thread.triageStatus)) {
    throw new Error('Source email triage changed; refresh and try again');
  }
  const transitioned = await repository.transitionThreadTriage({
    threadId: thread.id,
    expectedStatus: thread.triageStatus,
    triageStatus: 'linked_opportunity',
    archiveDisposition: 'active',
    actorUserId: actor.id,
    triagedAt: new Date().toISOString(),
    note: `Lead #${lead.id} approved as opportunity ${opportunity.opportunityNo || opportunity.id}`
  });
  if (!transitioned) {
    throw new Error('Source email triage changed; refresh and try again');
  }
  if (typeof repository.createTriageEvent === 'function') {
    await repository.createTriageEvent({
      threadId: thread.id,
      eventType: 'linked_opportunity',
      fromStatus: thread.triageStatus,
      toStatus: 'linked_opportunity',
      actorUserId: actor.id,
      inquiryId: lead.id,
      opportunityId: opportunity.id,
      note: `Lead #${lead.id} approved`
    });
  }
}

const emailRejectionTargets = Object.freeze({
  pending: { eventType: 'reopened', triageStatus: 'pending', archiveDisposition: 'active' },
  spam: { eventType: 'spam', triageStatus: 'spam', archiveDisposition: 'spam' },
  non_business: { eventType: 'archived', triageStatus: 'archived', archiveDisposition: 'archived' }
});

async function releaseRejectedLeadEmail(repository, actor, lead, disposition, reason) {
  const thread = await sourceEmailThread(repository, lead);
  if (!thread) return;
  const target = emailRejectionTargets[disposition];
  if (!target) {
    throw new Error('Email disposition is required');
  }
  if (!['converted_lead', 'linked_lead'].includes(thread.triageStatus)) {
    throw new Error('Source email triage changed; refresh and try again');
  }
  const transitioned = await repository.transitionThreadTriage({
    threadId: thread.id,
    expectedStatus: thread.triageStatus,
    triageStatus: target.triageStatus,
    archiveDisposition: target.archiveDisposition,
    actorUserId: actor.id,
    triagedAt: new Date().toISOString(),
    note: reason
  });
  if (!transitioned) {
    throw new Error('Source email triage changed; refresh and try again');
  }
  if (typeof repository.createTriageEvent === 'function') {
    await repository.createTriageEvent({
      threadId: thread.id,
      eventType: target.eventType,
      fromStatus: thread.triageStatus,
      toStatus: target.triageStatus,
      actorUserId: actor.id,
      inquiryId: lead.id,
      note: reason
    });
  }
  const released = await repository.releaseThreadFromInquiry(thread.id, lead.id);
  if (!released) {
    throw new Error('Source email link changed; refresh and try again');
  }
}

export async function approveSalesLead(dependencies, actor, leadId, input = {}) {
  return withLeadTransaction(dependencies, async (repositories) => {
    const lead = await lockLead(repositories.inquiryRepository, leadId);
    assertLeadReviewable(actor, lead);
    const opportunity = await convertInquiryToOpportunity(repositories, actor, lead, input, {
      copyAttachments: false
    });
    await transitionLeadEmailToOpportunity(repositories.emailArchiveRepository, actor, lead, opportunity);
    await createLeadReviewEvent(repositories.inquiryRepository, {
      inquiryId: lead.id,
      eventType: 'approved',
      fromStatus: 'new',
      toStatus: 'converted',
      actorUserId: actor.id,
      assignedUserId: lead.assignedUserId,
      opportunityId: opportunity.id,
      reason: text(input.reviewNote),
      details: { attachmentsCopied: false }
    });
    return opportunity;
  });
}

export async function returnSalesLead(dependencies, actor, leadId, reasonValue) {
  const reason = decisionReason(reasonValue);
  return withLeadTransaction(dependencies, async (repositories) => {
    const lead = await lockLead(repositories.inquiryRepository, leadId);
    assertLeadReviewable(actor, lead);
    const returned = await repositories.inquiryRepository.returnLead(lead.id, {
      reason,
      actorUserId: actor.id
    });
    if (!returned) throw new Error('Lead already processed');
    await createLeadReviewEvent(repositories.inquiryRepository, {
      inquiryId: lead.id,
      eventType: 'returned',
      fromStatus: 'new',
      toStatus: 'returned',
      actorUserId: actor.id,
      assignedUserId: lead.assignedUserId,
      reason
    });
    return returned;
  });
}

export async function rejectSalesLead(dependencies, actor, leadId, input = {}) {
  const reason = decisionReason(input.reason);
  return withLeadTransaction(dependencies, async (repositories) => {
    const lead = await lockLead(repositories.inquiryRepository, leadId);
    assertLeadReviewable(actor, lead);
    const isEmailLead = lead.sourceChannel === 'email' || Number(lead.rawPayload?.emailThreadId) > 0;
    const emailDisposition = text(input.emailDisposition);
    if (isEmailLead && !emailRejectionTargets[emailDisposition]) {
      throw new Error('Email disposition is required');
    }
    const rejected = await repositories.inquiryRepository.rejectLead(lead.id, {
      reason,
      actorUserId: actor.id
    });
    if (!rejected) throw new Error('Lead already processed');
    if (isEmailLead) {
      await releaseRejectedLeadEmail(
        repositories.emailArchiveRepository,
        actor,
        lead,
        emailDisposition,
        reason
      );
    }
    await createLeadReviewEvent(repositories.inquiryRepository, {
      inquiryId: lead.id,
      eventType: 'rejected',
      fromStatus: 'new',
      toStatus: 'rejected',
      actorUserId: actor.id,
      assignedUserId: lead.assignedUserId,
      reason,
      details: isEmailLead ? { emailDisposition } : {}
    });
    return rejected;
  });
}

export async function resubmitSalesLead(dependencies, actor, leadId, input = {}) {
  return withLeadTransaction(dependencies, async (repositories) => {
    const lead = await lockLead(repositories.inquiryRepository, leadId);
    if (!lead) throw new Error('Lead submission not found');
    if (!canResubmitLeadSubmission(actor, lead)) {
      if (lead.status !== 'returned') throw new Error('Lead already processed');
      forbidden();
    }
    const normalized = normalizeLeadResubmissionInput(input, actor, lead);
    if (!normalized.requirementText) throw new Error('Requirement is required');
    if (!normalized.companyName && !normalized.contactName && !normalized.contactEmail && !normalized.contactPhone) {
      throw new Error('Company or contact is required');
    }
    await validateLeadRouting(repositories.userRepository, normalized);
    const resubmitted = await repositories.inquiryRepository.resubmitLead(lead.id, normalized);
    if (!resubmitted) throw new Error('Lead already processed');
    await createLeadReviewEvent(repositories.inquiryRepository, {
      inquiryId: lead.id,
      eventType: 'resubmitted',
      fromStatus: 'returned',
      toStatus: 'new',
      actorUserId: actor.id,
      assignedUserId: normalized.assignedUserId,
      reason: text(input.resubmissionNote)
    });
    return resubmitted;
  });
}

export async function updatePendingSalesLead(dependencies, actor, leadId, input = {}) {
  return withLeadTransaction(dependencies, async (repositories) => {
    const lead = await lockLead(repositories.inquiryRepository, leadId);
    if (!lead) throw new Error('Lead submission not found');
    if (!canEditLeadSubmission(actor, lead) || lead.status !== 'new') {
      if (lead.status !== 'new') throw new Error('Lead already processed');
      forbidden();
    }
    const normalized = normalizeLeadResubmissionInput(input, actor, lead);
    if (!normalized.requirementText) throw new Error('Requirement is required');
    if (!normalized.companyName && !normalized.contactName && !normalized.contactEmail && !normalized.contactPhone) {
      throw new Error('Company or contact is required');
    }
    await validateLeadRouting(repositories.userRepository, normalized);
    const updated = await repositories.inquiryRepository.updatePendingLead(lead.id, normalized);
    if (!updated) throw new Error('Lead already processed');
    await createLeadReviewEvent(repositories.inquiryRepository, {
      inquiryId: lead.id,
      eventType: 'creator_edited',
      fromStatus: 'new',
      toStatus: 'new',
      actorUserId: actor.id,
      assignedUserId: normalized.assignedUserId,
      reason: ''
    });
    return updated;
  });
}

export async function reassignLeadReviewer(dependencies, actor, leadId, input = {}) {
  if (!hasRole(actor, ROLES.ADMINISTRATOR)) forbidden();
  const reason = decisionReason(input.reason);
  const assignedUserId = numberOrNull(input.assignedUserId);
  return withLeadTransaction(dependencies, async (repositories) => {
    const lead = await lockLead(repositories.inquiryRepository, leadId);
    if (!lead) throw new Error('Lead submission not found');
    if (!canReassignLeadReviewer(actor, lead)) throw new Error('Lead already processed');
    await validateLeadRouting(repositories.userRepository, {
      assignedUserId,
      recommendedSalespersonId: lead.recommendedSalespersonId
    }, { requireSalesperson: false });
    const reassigned = await repositories.inquiryRepository.reassignLeadReviewer(lead.id, {
      assignedUserId
    });
    if (!reassigned) throw new Error('Lead already processed');
    await createLeadReviewEvent(repositories.inquiryRepository, {
      inquiryId: lead.id,
      eventType: 'reviewer_reassigned',
      fromStatus: lead.status,
      toStatus: lead.status,
      actorUserId: actor.id,
      assignedUserId,
      reason,
      details: { previousAssignedUserId: lead.assignedUserId }
    });
    return reassigned;
  });
}
