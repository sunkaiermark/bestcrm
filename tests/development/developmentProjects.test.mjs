import test from 'node:test';
import assert from 'node:assert/strict';
import {
  annotateProjectDependencies,
  dependencyDateConflict,
  ganttPositions,
  normalizeDevelopmentDependency,
  normalizeDevelopmentPlanItem,
  normalizeDevelopmentProject
} from '../../src/domain/developmentProjects.mjs';
import {
  addDevelopmentPlanItem,
  createDevelopmentProject,
  getDevelopmentProjectPlan,
  updateDevelopmentSubprojectResponsible,
  updateDevelopmentSubprojectSummary
} from '../../src/services/developmentProjectService.mjs';

test('NPD project and item dates are validated before repository writes', () => {
  assert.deepEqual(normalizeDevelopmentProject({ title: '  Mixer platform  ',
    plannedStartOn: '2026-09-22', plannedEndOn: '2026-10-30' }), {
    title: 'Mixer platform', objective: '', plannedStartOn: '2026-09-22',
    plannedEndOn: '2026-10-30'
  });
  assert.throws(() => normalizeDevelopmentProject({ title: 'X',
    plannedStartOn: '2026-02-30', plannedEndOn: '2026-10-30' }), /valid date/);
  assert.throws(() => normalizeDevelopmentProject({ title: 'X',
    plannedStartOn: '2026-10-31', plannedEndOn: '2026-10-30' }), /after planned end/);
  assert.deepEqual(normalizeDevelopmentPlanItem({ itemKind: 'concept_gate',
    title: ' Approval ', plannedStartOn: '2026-10-21', gateTopicId: 2 }), {
    itemKind: 'concept_gate', title: 'Approval', plannedStartOn: '2026-10-21',
    plannedEndOn: '2026-10-21', gateTopicId: 2,
    responsibleUserId: null, summary: ''
  });
  assert.throws(() => normalizeDevelopmentPlanItem({ itemKind: 'concept_gate',
    title: 'Approval', plannedStartOn: '2026-10-21' }), /topic is required/);
  assert.throws(() => normalizeDevelopmentPlanItem({ itemKind: 'subproject',
    title: 'Explore', plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-02' }),
  /responsible member is required/);
  assert.equal(normalizeDevelopmentPlanItem({ itemKind: 'subproject',
    title: 'Explore', plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-02',
    responsibleUserId: '7' }).responsibleUserId, 7);
  assert.equal(normalizeDevelopmentPlanItem({ itemKind: 'subproject',
    title: 'Explore', summary: '  Seal options  ', plannedStartOn: '2026-10-01',
    plannedEndOn: '2026-10-02', responsibleUserId: '7' }).summary, 'Seal options');
  assert.throws(() => normalizeDevelopmentPlanItem({ itemKind: 'subproject',
    title: 'Explore', summary: 'x'.repeat(2001), plannedStartOn: '2026-10-01',
    plannedEndOn: '2026-10-02', responsibleUserId: 7 }), /summary is invalid/);
  assert.throws(() => normalizeDevelopmentPlanItem({ itemKind: 'concept_gate',
    title: 'Approval', plannedStartOn: '2026-10-21', gateTopicId: 2,
    responsibleUserId: 7 }), /cannot have/);
  assert.throws(() => normalizeDevelopmentPlanItem({ itemKind: 'concept_gate',
    title: 'Approval', plannedStartOn: '2026-10-21', gateTopicId: 2,
    summary: 'Wrong kind' }), /cannot have a subproject summary/);
});

test('FS, SS, FF and SF date checks use calendar days without moving dates', () => {
  const before = { plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-05' };
  const after = { plannedStartOn: '2026-10-06', plannedEndOn: '2026-10-10' };
  assert.equal(dependencyDateConflict(before, after,
    { relationCode: 'FS', lagCalendarDays: 0 }), false);
  assert.equal(dependencyDateConflict(before, { ...after, plannedStartOn: '2026-10-05' },
    { relationCode: 'FS', lagCalendarDays: 0 }), true);
  assert.equal(dependencyDateConflict(before, after,
    { relationCode: 'FS', lagCalendarDays: 2 }), true);
  assert.equal(dependencyDateConflict(before, { ...after, plannedStartOn: '2026-10-04' },
    { relationCode: 'FS', lagCalendarDays: -2 }), false);
  assert.equal(dependencyDateConflict({ ...before, itemKind: 'concept_gate',
    plannedStartOn: '2026-10-05' }, { ...after, plannedStartOn: '2026-10-05' },
  { relationCode: 'FS', lagCalendarDays: 0 }), false);
  assert.equal(dependencyDateConflict(before, { ...after, plannedStartOn: '2026-09-30' },
    { relationCode: 'SS', lagCalendarDays: 0 }), true);
  assert.equal(dependencyDateConflict(before, { ...after, plannedEndOn: '2026-10-04' },
    { relationCode: 'FF', lagCalendarDays: 0 }), true);
  assert.equal(dependencyDateConflict(before, { ...after, plannedEndOn: '2026-09-30' },
    { relationCode: 'SF', lagCalendarDays: 0 }), true);
  assert.throws(() => normalizeDevelopmentDependency({ predecessorItemId: 1,
    successorItemId: 1 }), /different/);
  assert.throws(() => normalizeDevelopmentDependency({ predecessorItemId: 1,
    successorItemId: 2, relationCode: 'FS', lagCalendarDays: 366 }), /calendar days/);
});

test('Gantt positions and predecessor annotations keep data as the source of truth', () => {
  const project = { plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-10' };
  const items = ganttPositions([
    { id: 1, code: 'SP-01', itemKind: 'subproject',
      plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-05' },
    { id: 2, code: 'G-01', itemKind: 'concept_gate',
      plannedStartOn: '2026-10-06', plannedEndOn: '2026-10-06' }
  ], project);
  assert.equal(items[0].leftPercent, 0);
  assert.equal(items[0].widthPercent, 50);
  assert.equal(items[1].leftPercent, 50);
  assert.equal(items[1].widthPercent, 0);
  const annotated = annotateProjectDependencies(items, [{ id: 1,
    predecessorItemId: 1, successorItemId: 2, relationCode: 'FS', lagCalendarDays: 0 }]);
  assert.equal(annotated[0].dateConflict, false);
  assert.equal(annotated[0].predecessorCode, 'SP-01');
  assert.equal(annotated[0].successorCode, 'G-01');
});

test('one-row subproject entry validates optional upstream and downstream links before writing', async () => {
  const calls = [];
  const repository = {
    async addSubprojectWithDependencies(input) { calls.push(input); return { id: 21, ...input }; },
    async addItem(input) { calls.push(input); return { id: 22, ...input }; }
  };
  const actor = { id: 7, isActive: true };
  const item = { itemKind: 'subproject', title: 'Seal trial',
    plannedStartOn: '2026-11-10', plannedEndOn: '2026-12-15', responsibleUserId: 7 };
  await assert.rejects(addDevelopmentPlanItem(repository, actor, 1, {
    ...item, upstreamItemId: 11, upstreamRelationCode: 'BAD'
  }), /Dependency type/);
  await assert.rejects(addDevelopmentPlanItem(repository, actor, 1, {
    ...item, downstreamItemId: 12, downstreamLagCalendarDays: 366
  }), /calendar days/);
  assert.equal(calls.length, 0);
  const created = await addDevelopmentPlanItem(repository, actor, 1, {
    ...item, upstreamItemId: '11', upstreamRelationCode: 'FS',
    upstreamLagCalendarDays: '0', downstreamItemId: '12',
    downstreamRelationCode: 'FF', downstreamLagCalendarDays: '5'
  });
  assert.equal(created.id, 21);
  assert.deepEqual(calls[0].upstream, { itemId: 11, relationCode: 'FS', lagCalendarDays: 0 });
  assert.deepEqual(calls[0].downstream, { itemId: 12, relationCode: 'FF', lagCalendarDays: 5 });
  await addDevelopmentPlanItem(repository, actor, 1, item);
  assert.equal(calls[1].item.title, 'Seal trial');
  assert.equal(calls[1].item.responsibleUserId, 7);
});

test('assigning a subproject validates member and optimistic version before writing', async () => {
  const calls = [];
  const repository = { async updateItemResponsible(input) { calls.push(input); return input; } };
  const actor = { id: 7, isActive: true };
  await assert.rejects(updateDevelopmentSubprojectResponsible(repository, actor, 1, 2,
    { responsibleUserId: '', expectedRowVersion: 1 }), /responsibleUserId is invalid/);
  await assert.rejects(updateDevelopmentSubprojectResponsible(repository, actor, 1, 2,
    { responsibleUserId: 9, expectedRowVersion: 0 }), /expectedRowVersion is invalid/);
  assert.equal(calls.length, 0);
  await updateDevelopmentSubprojectResponsible(repository, actor, 1, 2,
    { responsibleUserId: '9', expectedRowVersion: '3' });
  assert.deepEqual(calls[0], { projectId: 1, itemId: 2, responsibleUserId: 9,
    expectedRowVersion: 3, actorUserId: 7 });
});

test('subproject summary update validates text and optimistic version before writing', async () => {
  const calls = [];
  const repository = { async updateItemSummary(input) { calls.push(input); return input; } };
  const actor = { id: 7, isActive: true };
  await assert.rejects(updateDevelopmentSubprojectSummary(repository, actor, 1, 2,
    { summary: 'x'.repeat(2001), expectedRowVersion: 1 }), /summary is invalid/);
  assert.equal(calls.length, 0);
  await updateDevelopmentSubprojectSummary(repository, actor, 1, 2,
    { summary: '  Trial setup  ', expectedRowVersion: '3' });
  assert.deepEqual(calls[0], { projectId: 1, itemId: 2,
    summary: 'Trial setup', expectedRowVersion: 3, actorUserId: 7 });
});

test('project creation requires an active employee and visibility is delegated to repository', async () => {
  const calls = [];
  const repository = {
    async createProject(input) { calls.push(input); return { id: 9, ...input }; },
    async getVisiblePlan(input) {
      calls.push(input);
      return { project: { id: 9, ownerUserId: 22,
        plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-10' },
      items: [], dependencies: [], members: [], topicLinks: [], events: [] };
    }
  };
  await assert.rejects(createDevelopmentProject(repository, { id: 22, isActive: false }, {
    title: 'Demo', plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-10'
  }), /Active login/);
  const created = await createDevelopmentProject(repository, { id: 22, isActive: true }, {
    title: 'Demo', plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-10'
  });
  assert.equal(created.actorUserId, 22);
  const plan = await getDevelopmentProjectPlan(repository, { id: 23, isActive: true }, 9);
  assert.equal(plan.canManage, false);
  assert.deepEqual(plan.inviteCandidates, []);
  assert.deepEqual(calls[1], { projectId: 9, actorUserId: 23 });
});
