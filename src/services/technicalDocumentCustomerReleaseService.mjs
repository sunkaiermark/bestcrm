import { ROLES, hasRole } from '../domain/roles.mjs';
import { isProjectLeadEngineer } from './opportunityService.mjs';

function failure(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function documentInDraft(draft, value) {
  const documentId = Number(value);
  const document = (draft?.documents || []).find((item) => item.id === documentId);
  if (!document) failure('Technical file not found in this version', 404);
  return document;
}

function requiredReason(value, label) {
  const reason = String(value || '').trim();
  if (!reason || reason.length > 1000) failure(`${label} is required (up to 1000 characters)`, 400);
  return reason;
}

export function canRequestTechnicalDocumentCustomerRelease(actor, opportunity, draft) {
  return !opportunity?.archivedAt
    && draft?.status === 'approved'
    && draft?.selfApprovalTest !== true
    && isProjectLeadEngineer(actor, opportunity);
}

export function canReviewTechnicalDocumentCustomerRelease(actor, opportunity, draft) {
  return !opportunity?.archivedAt
    && draft?.status === 'approved'
    && draft?.selfApprovalTest !== true
    && hasRole(actor, ROLES.TECHNICAL_MANAGER)
    && Number(opportunity.technicalManagerId) === Number(actor?.id);
}

export async function requestTechnicalDocumentCustomerRelease(repository, actor, opportunity, draft, input) {
  if (!canRequestTechnicalDocumentCustomerRelease(actor, opportunity, draft)) failure('Forbidden', 403);
  const document = documentInDraft(draft, input.documentId);
  const purpose = requiredReason(input.purpose, 'Customer-facing purpose');
  const release = await repository.request({
    opportunityId: opportunity.id,
    customerId: opportunity.customerId,
    draftId: draft.id,
    documentId: document.id,
    fileSha256: document.sha256,
    purpose,
    actorUserId: actor.id
  });
  if (!release) failure('This exact file version already has a release decision', 409);
  return release;
}

export async function reviewTechnicalDocumentCustomerRelease(repository, actor, opportunity, draft, input) {
  if (!canReviewTechnicalDocumentCustomerRelease(actor, opportunity, draft)) failure('Forbidden', 403);
  const document = documentInDraft(draft, input.documentId);
  const decision = String(input.decision || '').trim();
  if (!['approved', 'rejected'].includes(decision)) failure('Invalid customer-release decision', 400);
  const comment = decision === 'rejected' ? requiredReason(input.comment, 'Rejection reason')
    : String(input.comment || '').trim();
  if (comment.length > 1000) failure('Review comment is too long', 400);
  const release = await repository.review({
    opportunityId: opportunity.id,
    customerId: opportunity.customerId,
    documentId: document.id,
    fileSha256: document.sha256,
    decision,
    comment,
    actorUserId: actor.id
  });
  if (!release) failure('Release request is no longer pending or cannot be self-reviewed', 409);
  return release;
}

export async function revokeTechnicalDocumentCustomerRelease(repository, actor, opportunity, draft, input) {
  if (!canReviewTechnicalDocumentCustomerRelease(actor, opportunity, draft)) failure('Forbidden', 403);
  const document = documentInDraft(draft, input.documentId);
  const reason = requiredReason(input.reason, 'Revocation reason');
  const release = await repository.revoke({
    opportunityId: opportunity.id,
    customerId: opportunity.customerId,
    documentId: document.id,
    fileSha256: document.sha256,
    reason,
    actorUserId: actor.id
  });
  if (!release) failure('Only an approved customer release can be revoked', 409);
  return release;
}
