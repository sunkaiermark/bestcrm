export class DevelopmentProjectError extends Error {
  constructor(message, statusCode = 422, fields = []) {
    super(message);
    this.name = 'DevelopmentProjectError';
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

export function projectDate(value, field) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)
      || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))
      || new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text) {
    throw new DevelopmentProjectError(`${field} must be a valid date`, 422, [field]);
  }
  return text;
}

function textField(value, field, max, required = true) {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((required && !text) || Array.from(text).length > max) {
    throw new DevelopmentProjectError(`${field} is invalid`, 422, [field]);
  }
  return text;
}

export function normalizeDevelopmentSubprojectSummary(value) {
  return textField(value, 'summary', 2000, false);
}

function dateRange(start, end) {
  if (start > end) {
    throw new DevelopmentProjectError('Planned start must not be after planned end', 422,
      ['plannedStartOn', 'plannedEndOn']);
  }
}

export function normalizeDevelopmentProject(input) {
  const plannedStartOn = projectDate(input?.plannedStartOn, 'plannedStartOn');
  const plannedEndOn = projectDate(input?.plannedEndOn, 'plannedEndOn');
  dateRange(plannedStartOn, plannedEndOn);
  return {
    title: textField(input?.title, 'title', 200),
    objective: textField(input?.objective, 'objective', 10000, false),
    plannedStartOn, plannedEndOn
  };
}

export function normalizeDevelopmentPlanItem(input) {
  const itemKind = String(input?.itemKind || 'subproject').trim();
  if (!['subproject', 'concept_gate'].includes(itemKind)) {
    throw new DevelopmentProjectError('Item kind is invalid', 422, ['itemKind']);
  }
  const plannedStartOn = projectDate(input?.plannedStartOn, 'plannedStartOn');
  const plannedEndOn = itemKind === 'concept_gate'
    ? plannedStartOn : projectDate(input?.plannedEndOn, 'plannedEndOn');
  dateRange(plannedStartOn, plannedEndOn);
  const gateTopicId = itemKind === 'concept_gate' ? Number(input?.gateTopicId) : null;
  if (itemKind === 'concept_gate'
      && (!Number.isSafeInteger(gateTopicId) || gateTopicId <= 0)) {
    throw new DevelopmentProjectError('Concept gate topic is required', 422, ['gateTopicId']);
  }
  const responsibleUserId = itemKind === 'subproject' ? Number(input?.responsibleUserId) : null;
  if (itemKind === 'subproject'
      && (!Number.isSafeInteger(responsibleUserId) || responsibleUserId <= 0)) {
    throw new DevelopmentProjectError('Subproject responsible member is required', 422,
      ['responsibleUserId']);
  }
  if (itemKind === 'concept_gate' && input?.responsibleUserId != null
      && String(input.responsibleUserId).trim() !== '') {
    throw new DevelopmentProjectError('Concept gate cannot have a responsible member', 422,
      ['responsibleUserId']);
  }
  if (itemKind === 'concept_gate' && String(input?.summary || '').trim()) {
    throw new DevelopmentProjectError('Concept gate cannot have a subproject summary', 422,
      ['summary']);
  }
  return {
    itemKind,
    title: textField(input?.title, 'title', 200),
    summary: itemKind === 'subproject'
      ? normalizeDevelopmentSubprojectSummary(input?.summary) : '',
    plannedStartOn,
    plannedEndOn,
    gateTopicId,
    responsibleUserId
  };
}

export function normalizeDevelopmentDependency(input) {
  const predecessorItemId = Number(input?.predecessorItemId);
  const successorItemId = Number(input?.successorItemId);
  if (!Number.isSafeInteger(predecessorItemId) || predecessorItemId <= 0
      || !Number.isSafeInteger(successorItemId) || successorItemId <= 0
      || predecessorItemId === successorItemId) {
    throw new DevelopmentProjectError('Choose two different plan items', 422,
      ['predecessorItemId', 'successorItemId']);
  }
  const relationCode = String(input?.relationCode || 'FS').toUpperCase().trim();
  if (!['FS', 'SS', 'FF', 'SF'].includes(relationCode)) {
    throw new DevelopmentProjectError('Dependency type is invalid', 422, ['relationCode']);
  }
  const lagCalendarDays = Number(input?.lagCalendarDays ?? 0);
  if (!Number.isInteger(lagCalendarDays) || lagCalendarDays < -365 || lagCalendarDays > 365) {
    throw new DevelopmentProjectError('Lag must be -365 to 365 calendar days', 422,
      ['lagCalendarDays']);
  }
  return { predecessorItemId, successorItemId, relationCode, lagCalendarDays };
}

function ordinalDay(date) {
  return Date.parse(`${date}T00:00:00.000Z`) / 86400000;
}

// Date-only planning uses calendar days. A subproject finish occupies its
// whole day, while a zero-duration milestone can release work on its date.
export function dependencyDateConflict(predecessor, successor, dependency) {
  const lag = dependency.lagCalendarDays;
  const firstStart = ordinalDay(predecessor.plannedStartOn);
  const firstFinish = ordinalDay(predecessor.plannedEndOn);
  const nextStart = ordinalDay(successor.plannedStartOn);
  const nextFinish = ordinalDay(successor.plannedEndOn);
  switch (dependency.relationCode) {
    case 'FS': return nextStart < firstFinish
      + (predecessor.itemKind === 'concept_gate' ? 0 : 1) + lag;
    case 'SS': return nextStart < firstStart + lag;
    case 'FF': return nextFinish < firstFinish + lag;
    case 'SF': return nextFinish < firstStart + lag;
    default: throw new DevelopmentProjectError('Dependency type is invalid');
  }
}

export function annotateProjectDependencies(items, dependencies) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return dependencies.map((dependency) => {
    const predecessor = byId.get(dependency.predecessorItemId);
    const successor = byId.get(dependency.successorItemId);
    return {
      ...dependency,
      predecessorCode: predecessor?.code || '',
      successorCode: successor?.code || '',
      dateConflict: predecessor && successor
        ? dependencyDateConflict(predecessor, successor, dependency) : true
    };
  });
}

export function ganttPositions(items, project) {
  const start = ordinalDay(project.plannedStartOn);
  const end = ordinalDay(project.plannedEndOn);
  const total = Math.max(1, end - start + 1);
  return items.map((item) => ({
    ...item,
    leftPercent: Math.max(0, Math.min(100, ((ordinalDay(item.plannedStartOn) - start) / total) * 100)),
    widthPercent: item.itemKind === 'concept_gate' ? 0
      : Math.max(0.5, Math.min(100, ((ordinalDay(item.plannedEndOn)
        - ordinalDay(item.plannedStartOn) + 1) / total) * 100))
  }));
}
