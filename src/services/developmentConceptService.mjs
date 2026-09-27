import { hasRole, ROLES } from '../domain/roles.mjs';
import {
  conceptSnapshotSha256,
  DevelopmentConceptError,
  normalizeConceptSnapshot
} from '../domain/developmentConcepts.mjs';

function activeActor(actor) {
  const id = Number(actor?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || actor?.isActive !== true) {
    throw new DevelopmentConceptError('Active login required', 403);
  }
  return id;
}

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new DevelopmentConceptError(`${field} is invalid`, 422, [field]);
  }
  return id;
}

function writeVersion(value) {
  return positiveId(value, 'expectedRowVersion');
}

function key(value) {
  const result = String(value || '').trim();
  if (!result || result.length > 128) {
    throw new DevelopmentConceptError('Idempotency key is required', 422, ['idempotencyKey']);
  }
  return result;
}

export async function createConceptRevision(repository, actor, topicId, input) {
  const actorUserId = activeActor(actor);
  const snapshot = normalizeConceptSnapshot(input?.snapshot);
  return repository.createConceptRevision({
    topicId: positiveId(topicId, 'topicId'),
    actorUserId,
    expectedRowVersion: writeVersion(input?.expectedRowVersion),
    snapshot,
    snapshotSha256: conceptSnapshotSha256(snapshot)
  });
}

export async function submitConceptRevision(repository, actor, topicId, revisionId, input) {
  return repository.submitConceptRevision({
    topicId: positiveId(topicId, 'topicId'),
    revisionId: positiveId(revisionId, 'revisionId'),
    actorUserId: activeActor(actor),
    expectedRowVersion: writeVersion(input?.expectedRowVersion)
  });
}

export async function decideConceptRevision(repository, actor, topicId, revisionId, input) {
  const actorUserId = activeActor(actor);
  if (!hasRole(actor, ROLES.TECHNICAL_MANAGER)) {
    throw new DevelopmentConceptError('Only a technical manager may decide a concept', 403);
  }
  const decisionCode = String(input?.decisionCode || '').trim();
  if (!['approved', 'revise_required'].includes(decisionCode)) {
    // Pause, stop and resume use the separate administrator lifecycle workflow.
    throw new DevelopmentConceptError('Decision is not enabled', 422, ['decisionCode']);
  }
  const reason = String(input?.reason || '').trim();
  const selfReviewReason = String(input?.selfReviewReason || '').trim();
  if (!reason || reason.length > 4000 || selfReviewReason.length > 4000) {
    throw new DevelopmentConceptError('Decision reason is required and must be concise', 422, ['reason']);
  }
  return repository.decideConceptRevision({
    topicId: positiveId(topicId, 'topicId'),
    revisionId: positiveId(revisionId, 'revisionId'),
    actorUserId,
    expectedRowVersion: writeVersion(input?.expectedRowVersion),
    decisionCode,
    reason,
    selfReviewReason,
    idempotencyKey: key(input?.idempotencyKey)
  });
}

export async function getConceptGate(repository, actor, topicId) {
  return repository.getConceptGate({
    topicId: positiveId(topicId, 'topicId'), actorUserId: activeActor(actor)
  });
}

export async function getConceptRevisionPreview(repository, actor, topicId, revisionId) {
  return repository.getConceptRevision({
    topicId: positiveId(topicId, 'topicId'),
    revisionId: positiveId(revisionId, 'revisionId'),
    actorUserId: activeActor(actor)
  });
}

export async function requestFormalDesignHandoff(repository, actor, topicId, input) {
  return repository.requestFormalDesignHandoff({
    topicId: positiveId(topicId, 'topicId'),
    revisionId: positiveId(input?.revisionId, 'revisionId'),
    actorUserId: activeActor(actor),
    expectedRowVersion: writeVersion(input?.expectedRowVersion),
    idempotencyKey: key(input?.idempotencyKey)
  });
}
