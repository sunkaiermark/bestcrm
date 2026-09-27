import { hasRole, ROLES } from '../domain/roles.mjs';
import { DevelopmentConceptError } from '../domain/developmentConcepts.mjs';

function fail(message, statusCode = 422, fields = []) {
  throw new DevelopmentConceptError(message, statusCode, fields);
}

function activeActor(actor) {
  const id = Number(actor?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || actor?.isActive !== true) {
    fail('Active login required', 403);
  }
  return id;
}

function adminActor(actor) {
  const id = activeActor(actor);
  if (!hasRole(actor, ROLES.ADMINISTRATOR)) fail('Administrator required', 403);
  return id;
}

function id(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) fail(`${field} is invalid`, 422, [field]);
  return result;
}

function text(value, field, limit = 4000) {
  if (value != null && typeof value !== 'string') fail(`${field} must be text`, 422, [field]);
  const result = String(value ?? '').trim();
  if (!result || result.length > limit) fail(`${field} is required`, 422, [field]);
  return result;
}

function optionalText(value, field, limit = 4000) {
  if (value != null && typeof value !== 'string') fail(`${field} must be text`, 422, [field]);
  const result = String(value ?? '').trim();
  if (result.length > limit) fail(`${field} is too long`, 422, [field]);
  return result;
}

function key(value) { return text(value, 'idempotencyKey', 128); }

function choice(value, field, allowed) {
  if (!allowed.includes(value)) fail(`${field} is invalid`, 422, [field]);
  return value;
}

function date(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} is required`, 422, [field]);
  const result = new Date(value);
  if (Number.isNaN(result.valueOf())) fail(`${field} is invalid`, 422, [field]);
  return result.toISOString();
}

export async function getLifecycle(repository, actor, topicId) {
  return repository.getLifecycle({ actorUserId: activeActor(actor),
    isAdmin: hasRole(actor, ROLES.ADMINISTRATOR), topicId: id(topicId, 'topicId') });
}

export async function requestLifecycle(repository, actor, topicId, input) {
  return repository.requestLifecycle({
    actorUserId: activeActor(actor), topicId: id(topicId, 'topicId'),
    actionCode: choice(input?.actionCode, 'actionCode', ['pause', 'stop', 'resume']),
    reason: text(input?.reason, 'reason'),
    expectedRowVersion: id(input?.expectedRowVersion, 'expectedRowVersion'),
    idempotencyKey: key(input?.idempotencyKey)
  });
}

export async function decideLifecycle(repository, actor, topicId, requestId, input) {
  const actorUserId = adminActor(actor);
  const selfApprovalReason = optionalText(input?.selfApprovalReason, 'selfApprovalReason');
  return repository.decideLifecycle({
    actorUserId, topicId: id(topicId, 'topicId'), requestId: id(requestId, 'requestId'),
    decisionCode: choice(input?.decisionCode, 'decisionCode', ['approved', 'rejected']),
    reason: text(input?.reason, 'reason'), selfApprovalReason,
    idempotencyKey: key(input?.idempotencyKey)
  });
}

export async function listReviewerDelegations(repository, actor, topicId) {
  return repository.listReviewerDelegations({ actorUserId: adminActor(actor),
    topicId: id(topicId, 'topicId') });
}

export async function appointReviewerProxy(repository, actor, topicId, input) {
  const actorUserId = adminActor(actor);
  const validFrom = date(input?.validFrom, 'validFrom');
  const validUntil = date(input?.validUntil, 'validUntil');
  if (new Date(validUntil) <= new Date(validFrom) || new Date(validUntil) <= new Date()) {
    fail('Proxy term must end after it starts and remain in the future', 422,
      ['validFrom', 'validUntil']);
  }
  return repository.appointReviewerProxy({
    actorUserId, topicId: id(topicId, 'topicId'),
    absentManagerUserId: id(input?.absentManagerUserId, 'absentManagerUserId'),
    proxyManagerUserId: id(input?.proxyManagerUserId, 'proxyManagerUserId'),
    validFrom, validUntil, reason: text(input?.reason, 'reason'),
    idempotencyKey: key(input?.idempotencyKey)
  });
}

export async function revokeReviewerProxy(repository, actor, topicId, delegationId, input) {
  return repository.revokeReviewerProxy({
    actorUserId: adminActor(actor), topicId: id(topicId, 'topicId'),
    delegationId: id(delegationId, 'delegationId'),
    reason: text(input?.reason, 'reason'), idempotencyKey: key(input?.idempotencyKey)
  });
}
