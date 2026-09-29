import {
  annotateProjectDependencies,
  DevelopmentProjectError,
  ganttPositions,
  normalizeDevelopmentDependency,
  normalizeDevelopmentPlanItem,
  normalizeDevelopmentProject,
  normalizeDevelopmentSubprojectSummary,
  projectDate
} from '../domain/developmentProjects.mjs';

function activeId(actor) {
  const id = Number(actor?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || actor?.isActive !== true) {
    throw new DevelopmentProjectError('Active login required', 403);
  }
  return id;
}

function id(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new DevelopmentProjectError(`${field} is invalid`, 422, [field]);
  }
  return number;
}

function optionalNewItemDependency(input, side) {
  const rawItemId = input?.[`${side}ItemId`];
  if (rawItemId === undefined || rawItemId === null || String(rawItemId).trim() === '') {
    return null;
  }
  const itemId = id(rawItemId, `${side}ItemId`);
  const relationCode = String(input?.[`${side}RelationCode`] || 'FS').trim().toUpperCase();
  if (!['FS', 'SS', 'FF', 'SF'].includes(relationCode)) {
    throw new DevelopmentProjectError('Dependency type is invalid', 422,
      [`${side}RelationCode`]);
  }
  const lagCalendarDays = Number(input?.[`${side}LagCalendarDays`] ?? 0);
  if (!Number.isInteger(lagCalendarDays) || lagCalendarDays < -365 || lagCalendarDays > 365) {
    throw new DevelopmentProjectError('Lag must be -365 to 365 calendar days', 422,
      [`${side}LagCalendarDays`]);
  }
  return { itemId, relationCode, lagCalendarDays };
}

export function canCreateDevelopmentProject(actor) {
  return Number.isSafeInteger(Number(actor?.id)) && Number(actor?.id) > 0
    && actor?.isActive === true;
}

export async function createDevelopmentProject(repository, actor, input) {
  return repository.createProject({
    ...normalizeDevelopmentProject(input), actorUserId: activeId(actor)
  });
}

export async function updateDevelopmentProjectDates(repository, actor, projectId, input) {
  const plannedStartOn = projectDate(input?.plannedStartOn, 'plannedStartOn');
  const plannedEndOn = projectDate(input?.plannedEndOn, 'plannedEndOn');
  if (plannedStartOn > plannedEndOn) {
    throw new DevelopmentProjectError('Planned start must not be after planned end', 422,
      ['plannedStartOn', 'plannedEndOn']);
  }
  return repository.updateProjectDates({
    projectId: id(projectId, 'projectId'), actorUserId: activeId(actor),
    expectedRowVersion: id(input?.expectedRowVersion, 'expectedRowVersion'),
    plannedStartOn, plannedEndOn
  });
}

export async function listDevelopmentProjects(repository, actor, { page = 1 } = {}) {
  const actorUserId = activeId(actor);
  const pageNumber = Number(page);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) {
    throw new DevelopmentProjectError('Page is invalid', 422, ['page']);
  }
  return repository.listVisibleProjects({
    actorUserId, limit: 30, offset: (pageNumber - 1) * 30
  });
}

export async function getDevelopmentProjectPlan(repository, actor, projectId) {
  const actorUserId = activeId(actor);
  const projectNumber = id(projectId, 'projectId');
  const plan = await repository.getVisiblePlan({ projectId: projectNumber, actorUserId });
  const items = ganttPositions(plan.items, plan.project);
  const dependencies = annotateProjectDependencies(items, plan.dependencies);
  const canManage = plan.project.ownerUserId === actorUserId;
  const [inviteCandidates, linkableTopics] = canManage
    ? await Promise.all([
      repository.listInviteCandidates({ projectId: projectNumber, actorUserId }),
      repository.listLinkableTopics({ actorUserId })
    ]) : [[], []];
  return {
    ...plan, items, dependencies, canManage, inviteCandidates, linkableTopics,
    hasDateConflicts: dependencies.some((dependency) => dependency.dateConflict)
  };
}

export async function inviteDevelopmentProjectMember(repository, actor, projectId, input) {
  return repository.addMember({
    projectId: id(projectId, 'projectId'), userId: id(input?.userId, 'userId'),
    actorUserId: activeId(actor)
  });
}

export async function endDevelopmentProjectMember(repository, actor, projectId, userId) {
  return repository.endMember({
    projectId: id(projectId, 'projectId'), userId: id(userId, 'userId'),
    actorUserId: activeId(actor)
  });
}

export async function addDevelopmentPlanItem(repository, actor, projectId, input) {
  const item = normalizeDevelopmentPlanItem(input);
  const upstream = optionalNewItemDependency(input, 'upstream');
  const downstream = optionalNewItemDependency(input, 'downstream');
  if (item.itemKind !== 'subproject' && (upstream || downstream)) {
    throw new DevelopmentProjectError('Only a subproject can use inline dependencies', 422,
      ['itemKind']);
  }
  if (upstream || downstream) {
    return repository.addSubprojectWithDependencies({
      projectId: id(projectId, 'projectId'), actorUserId: activeId(actor),
      item, upstream, downstream
    });
  }
  return repository.addItem({
    projectId: id(projectId, 'projectId'), actorUserId: activeId(actor),
    item
  });
}

export async function updateDevelopmentPlanItemDates(repository, actor, projectId, itemId, input) {
  const plannedStartOn = projectDate(input?.plannedStartOn, 'plannedStartOn');
  const plannedEndOn = projectDate(input?.plannedEndOn, 'plannedEndOn');
  if (plannedStartOn > plannedEndOn) {
    throw new DevelopmentProjectError('Planned start must not be after planned end', 422,
      ['plannedStartOn', 'plannedEndOn']);
  }
  return repository.updateItemDates({
    projectId: id(projectId, 'projectId'), itemId: id(itemId, 'itemId'),
    expectedRowVersion: id(input?.expectedRowVersion, 'expectedRowVersion'),
    actorUserId: activeId(actor), plannedStartOn, plannedEndOn
  });
}

export async function updateDevelopmentSubprojectResponsible(repository, actor, projectId,
  itemId, input) {
  return repository.updateItemResponsible({
    projectId: id(projectId, 'projectId'), itemId: id(itemId, 'itemId'),
    responsibleUserId: id(input?.responsibleUserId, 'responsibleUserId'),
    expectedRowVersion: id(input?.expectedRowVersion, 'expectedRowVersion'),
    actorUserId: activeId(actor)
  });
}

export async function updateDevelopmentSubprojectSummary(repository, actor, projectId,
  itemId, input) {
  return repository.updateItemSummary({
    projectId: id(projectId, 'projectId'), itemId: id(itemId, 'itemId'),
    summary: normalizeDevelopmentSubprojectSummary(input?.summary),
    expectedRowVersion: id(input?.expectedRowVersion, 'expectedRowVersion'),
    actorUserId: activeId(actor)
  });
}

export async function linkDevelopmentTopicToSubproject(repository, actor, projectId, itemId, input) {
  return repository.linkTopic({
    projectId: id(projectId, 'projectId'), itemId: id(itemId, 'itemId'),
    topicId: id(input?.topicId, 'topicId'), actorUserId: activeId(actor)
  });
}

export async function addDevelopmentDependency(repository, actor, projectId, input) {
  return repository.addDependency({
    projectId: id(projectId, 'projectId'), actorUserId: activeId(actor),
    dependency: normalizeDevelopmentDependency(input)
  });
}

export async function endDevelopmentDependency(repository, actor, projectId, dependencyId) {
  return repository.endDependency({
    projectId: id(projectId, 'projectId'), dependencyId: id(dependencyId, 'dependencyId'),
    actorUserId: activeId(actor)
  });
}
