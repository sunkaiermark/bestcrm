import { hasRole, ROLES } from '../domain/roles.mjs';
import { DevelopmentConceptError } from '../domain/developmentConcepts.mjs';

function fail(message, statusCode = 422, fields = []) {
  throw new DevelopmentConceptError(message, statusCode, fields);
}

function actorId(actor) {
  const id = Number(actor?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || actor?.isActive !== true) {
    fail('Active login required', 403);
  }
  return id;
}

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) fail(`${field} is invalid`, 422, [field]);
  return id;
}

function requiredText(value, field, limit) {
  if (typeof value !== 'string') fail(`${field} must be text`, 422, [field]);
  const text = value.trim();
  if (!text || text.length > limit) fail(`${field} is required and must be concise`, 422, [field]);
  return text;
}

function evidenceList(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    fail('Evidence references must be a short list', 422, ['evidenceReferences']);
  }
  return value.map((item) => requiredText(item, 'evidenceReferences', 500));
}

export async function listDevelopmentOutcomes(repository, actor, topicId) {
  return repository.listTopicOutcomes({
    topicId: positiveId(topicId, 'topicId'), actorUserId: actorId(actor)
  });
}

export async function createDevelopmentOutcomeRevision(repository, actor, topicId, input) {
  const outcomeKind = input?.outcomeKind;
  if (!['technical_result', 'lesson_learned'].includes(outcomeKind)) {
    fail('Outcome kind is invalid', 422, ['outcomeKind']);
  }
  return repository.createOutcomeRevision({
    topicId: positiveId(topicId, 'topicId'), actorUserId: actorId(actor), outcomeKind,
    title: requiredText(input?.title, 'title', 200),
    finding: requiredText(input?.finding, 'finding', 20000),
    applicability: requiredText(input?.applicability, 'applicability', 10000),
    limitations: requiredText(input?.limitations, 'limitations', 10000),
    evidenceReferences: evidenceList(input?.evidenceReferences)
  });
}

export async function proposeDevelopmentAssetCandidate(repository, actor, topicId, revisionId, input) {
  return repository.proposeAssetCandidate({
    topicId: positiveId(topicId, 'topicId'),
    revisionId: positiveId(revisionId, 'revisionId'), actorUserId: actorId(actor),
    rationale: requiredText(input?.rationale, 'rationale', 4000)
  });
}

export async function reviewDevelopmentAssetCandidate(repository, actor, topicId, candidateId, input) {
  const reviewerUserId = actorId(actor);
  if (!hasRole(actor, ROLES.TECHNICAL_MANAGER)) {
    fail('Only a technical manager may review a development asset candidate', 403);
  }
  if (!['endorsed', 'revision_required'].includes(input?.decisionCode)) {
    fail('Review decision is invalid', 422, ['decisionCode']);
  }
  return repository.reviewAssetCandidate({
    topicId: positiveId(topicId, 'topicId'),
    candidateId: positiveId(candidateId, 'candidateId'), reviewerUserId,
    decisionCode: input.decisionCode,
    reason: requiredText(input?.reason, 'reason', 4000)
  });
}

export async function publishDevelopmentAsset(repository, actor, topicId, candidateId, input) {
  const publisherUserId = actorId(actor);
  if (!hasRole(actor, ROLES.TECHNICAL_MANAGER)) {
    fail('Only a technical manager may publish a development asset', 403);
  }
  return repository.publishAsset({
    topicId: positiveId(topicId, 'topicId'),
    candidateId: positiveId(candidateId, 'candidateId'), publisherUserId,
    reason: requiredText(input?.reason, 'reason', 4000)
  });
}

export async function withdrawDevelopmentAsset(repository, actor, topicId, assetId, input) {
  const actorUserId = actorId(actor);
  if (!hasRole(actor, ROLES.TECHNICAL_MANAGER)) {
    fail('Only a technical manager may withdraw a development asset', 403);
  }
  return repository.withdrawAsset({
    topicId: positiveId(topicId, 'topicId'),
    assetId: positiveId(assetId, 'assetId'), actorUserId,
    reason: requiredText(input?.reason, 'reason', 4000)
  });
}

export async function listVisibleDevelopmentAssets(repository, actor, options = {}) {
  const actorUserId = actorId(actor);
  const page = Number(options.page || 1);
  if (!Number.isSafeInteger(page) || page <= 0 || page > 10000) {
    fail('Page is invalid', 422, ['page']);
  }
  return repository.listVisibleAssets({ actorUserId, limit: 50, offset: (page - 1) * 50 });
}
