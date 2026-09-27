import { DevelopmentTopicError, normalizeDevelopmentTopicDraft } from '../domain/developmentTopics.mjs';

function activeActorId(actor) {
  const actorUserId = Number(actor?.id);
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0 || actor?.isActive !== true) {
    throw new DevelopmentTopicError('An active user is required to create a development topic', 403);
  }
  return actorUserId;
}

function positiveId(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new DevelopmentTopicError(`${field} is invalid`, 422, [field]);
  }
  return number;
}

export function canCreateDevelopmentTopic(actor) {
  return Number.isSafeInteger(Number(actor?.id)) && Number(actor?.id) > 0
    && actor?.isActive === true;
}

export async function createDevelopmentTopicDraft(repository, actor, input) {
  const actorUserId = activeActorId(actor);
  const draft = normalizeDevelopmentTopicDraft(input);
  return repository.createTopic({ ...draft, actorUserId });
}

export async function listDevelopmentTopics(repository, actor, { page = 1 } = {}) {
  const actorUserId = activeActorId(actor);
  const pageNumber = Number(page);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) {
    throw new DevelopmentTopicError('Page is invalid', 422, ['page']);
  }
  return repository.listVisibleTopics({ actorUserId, limit: 30, offset: (pageNumber - 1) * 30 });
}

export async function getDevelopmentTopicWorkspace(repository, actor, topicId) {
  const actorUserId = activeActorId(actor);
  const id = positiveId(topicId, 'topicId');
  const topic = await repository.findVisibleTopicById({ topicId: id, actorUserId });
  if (!topic) throw new DevelopmentTopicError('Development topic not found', 404);
  const members = await repository.listVisibleCurrentMembers({ topicId: id, actorUserId });
  const canManageMembers = topic.ownerUserId === actorUserId;
  const inviteCandidates = canManageMembers
    ? await repository.listInviteCandidates({ topicId: id, actorUserId }) : [];
  return { topic, members, canManageMembers, inviteCandidates };
}

export async function listDevelopmentDiscussion(repository, actor, topicId, { beforeId } = {}) {
  const actorUserId = activeActorId(actor);
  const id = positiveId(topicId, 'topicId');
  const cursor = beforeId === undefined ? null : positiveId(beforeId, 'beforeId');
  return repository.listVisibleDiscussion({ topicId: id, actorUserId, beforeId: cursor, limit: 30 });
}

export async function appendDevelopmentDiscussion(repository, actor, topicId, input) {
  const actorUserId = activeActorId(actor);
  const id = positiveId(topicId, 'topicId');
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body || Array.from(body).length > 4000) {
    throw new DevelopmentTopicError('Discussion must be 1–4000 characters', 422, ['body']);
  }
  return repository.appendVisibleDiscussion({ topicId: id, actorUserId, body });
}

export async function inviteDevelopmentMember(repository, actor, topicId, input) {
  return repository.addVisibleMember({
    topicId: positiveId(topicId, 'topicId'),
    userId: positiveId(input?.userId, 'userId'),
    actorUserId: activeActorId(actor)
  });
}

export async function endDevelopmentMembership(repository, actor, topicId, userId) {
  return repository.endVisibleMember({
    topicId: positiveId(topicId, 'topicId'),
    userId: positiveId(userId, 'userId'),
    actorUserId: activeActorId(actor)
  });
}
