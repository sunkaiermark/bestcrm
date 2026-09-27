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

function text(value, field, limit, required = true) {
  if (typeof value !== 'string') fail(`${field} must be text`, 422, [field]);
  const normalized = value.trim();
  if (normalized.length > limit || (required && !normalized)) {
    fail(`${field} is required and must be concise`, 422, [field]);
  }
  return normalized;
}

function managerId(actor) {
  const id = actorId(actor);
  if (!hasRole(actor, ROLES.TECHNICAL_MANAGER)) {
    fail('Only an active technical manager may decide customer use', 403);
  }
  return id;
}

export async function getDevelopmentBusiness(repository, actor, topicId, options = {}) {
  const id = positiveId(topicId, 'topicId');
  const actorUserId = actorId(actor);
  const business = await repository.listTopicBusiness({ topicId: id, actorUserId });
  const search = options.search == null ? '' : text(options.search, 'search', 100, false);
  const opportunities = search
    ? await repository.searchVisibleOpportunities({ topicId: id, actorUserId, search }) : [];
  const sentCustomerFiles = await repository.listSentCustomerFiles({ topicId: id, actorUserId });
  return { ...business, opportunities, sentCustomerFiles, search };
}

export async function linkDevelopmentOpportunity(repository, actor, topicId, input) {
  return repository.linkOpportunity({
    topicId: positiveId(topicId, 'topicId'), actorUserId: actorId(actor),
    opportunityId: positiveId(input?.opportunityId, 'opportunityId'),
    reason: text(input?.reason, 'reason', 2000)
  });
}

export async function unlinkDevelopmentOpportunity(repository, actor, topicId, linkId) {
  return repository.unlinkOpportunity({ topicId: positiveId(topicId, 'topicId'),
    linkId: positiveId(linkId, 'linkId'), actorUserId: actorId(actor) });
}

export async function requestDevelopmentCustomerUse(repository, actor, topicId, linkId, input) {
  return repository.requestCustomerUse({ topicId: positiveId(topicId, 'topicId'),
    linkId: positiveId(linkId, 'linkId'), actorUserId: actorId(actor),
    assetId: positiveId(input?.assetId, 'assetId'),
    purpose: text(input?.purpose, 'purpose', 2000) });
}

export async function decideDevelopmentCustomerUse(repository, actor, topicId, requestId, input) {
  const decisionCode = input?.decisionCode;
  if (!['approved', 'rejected'].includes(decisionCode)) {
    fail('Decision is invalid', 422, ['decisionCode']);
  }
  return repository.decideCustomerUse({ topicId: positiveId(topicId, 'topicId'),
    requestId: positiveId(requestId, 'requestId'), actorUserId: managerId(actor),
    decisionCode, reason: text(input?.reason, 'reason', 4000) });
}

export async function revokeDevelopmentCustomerUse(repository, actor, topicId, requestId, input) {
  return repository.revokeCustomerUse({ topicId: positiveId(topicId, 'topicId'),
    requestId: positiveId(requestId, 'requestId'), actorUserId: managerId(actor),
    reason: text(input?.reason, 'reason', 4000) });
}

export async function recordDevelopmentCustomerFileUse(repository, actor, topicId, requestId, input) {
  if (![true, 'true', 'on', '1'].includes(input?.contentConfirmed)) {
    fail('Confirm that the approved result appears in the selected customer file',
      422, ['contentConfirmed']);
  }
  const evidenceKey = text(input?.evidenceKey, 'evidenceKey', 100);
  const match = /^(technical_solution|quotation_package):([1-9]\d*):([1-9]\d*)$/.exec(evidenceKey);
  if (!match) fail('Archived customer file evidence is invalid', 422, ['evidenceKey']);
  return repository.recordCustomerFileUse({
    topicId: positiveId(topicId, 'topicId'),
    requestId: positiveId(requestId, 'requestId'),
    actorUserId: actorId(actor), fileKind: match[1],
    fileId: positiveId(match[2], 'fileId'),
    emailAttachmentId: positiveId(match[3], 'emailAttachmentId'),
    usageLocation: text(input?.usageLocation, 'usageLocation', 1000)
  });
}

export async function listOpportunityDevelopmentLinks(repository, actor, opportunityId) {
  return repository.listOpportunityBusiness({ opportunityId: positiveId(opportunityId, 'opportunityId'),
    actorUserId: actorId(actor) });
}
