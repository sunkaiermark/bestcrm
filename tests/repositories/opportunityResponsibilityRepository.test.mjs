import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityResponsibilityRepository } from '../../src/repositories/opportunityResponsibilityRepository.mjs';

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      const rowsForCall = Array.isArray(rows[0]) ? rows[this.queries.length - 1] || [] : rows;
      return { rows: rowsForCall, rowCount: rowsForCall.length };
    }
  };
}

test('opportunity responsibility repository lists active team members with role and audit names', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '41',
    opportunity_id: '10',
    user_id: '7',
    username: 'sales_support01',
    user_display_name: 'Sales Support',
    role_code: 'sales_support',
    role_name: 'Sales Support',
    permission_level: 'edit',
    assignment_scope: 'Agitation chapter',
    task_description: 'Verify motor sizing',
    due_date: '2026-06-12',
    can_send_external_email: false,
    is_active: true,
    added_by: '2',
    added_by_display_name: 'Sales Manager',
    added_at: '2026-06-06T08:00:00.000Z',
    updated_by: '3',
    updated_by_display_name: 'Lead Engineer',
    updated_at: '2026-06-07T08:00:00.000Z',
    removed_by: null,
    removed_by_display_name: null,
    removed_at: null
  }]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  const members = await repository.listTeamMembersByOpportunity(10);

  assert.deepEqual(members, [{
    id: 41,
    opportunityId: 10,
    userId: 7,
    username: 'sales_support01',
    userDisplayName: 'Sales Support',
    roleCode: 'sales_support',
    roleName: 'Sales Support',
    permissionLevel: 'edit',
    assignmentScope: 'Agitation chapter',
    taskDescription: 'Verify motor sizing',
    dueDate: '2026-06-12',
    canSendExternalEmail: false,
    isActive: true,
    addedBy: 2,
    addedByDisplayName: 'Sales Manager',
    addedAt: '2026-06-06T08:00:00.000Z',
    updatedBy: 3,
    updatedByDisplayName: 'Lead Engineer',
    updatedAt: '2026-06-07T08:00:00.000Z',
    removedBy: null,
    removedByDisplayName: '',
    removedAt: null
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_members om/);
  assert.match(queryTarget.queries[0].sql, /JOIN users member/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN roles r/);
  assert.match(queryTarget.queries[0].sql, /JOIN users added_by_user/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users updated_by_user/);
  assert.match(queryTarget.queries[0].sql, /WHERE om\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /om\.is_active = true/);
  assert.deepEqual(queryTarget.queries[0].params, [10]);
});

test('opportunity responsibility repository adds active team members', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  await repository.addTeamMember({
    opportunityId: 10,
    userId: 8,
    roleCode: 'quotation_engineer',
    permissionLevel: 'edit',
    addedBy: 2,
    assignmentScope: 'Reactor section',
    taskDescription: 'Check heat transfer area',
    dueDate: '2026-06-15',
    canSendExternalEmail: true
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunity_members/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunity_member_events/);
  assert.match(queryTarget.queries[0].sql, /ON CONFLICT \(opportunity_id, user_id, role_code\) WHERE is_active = true DO UPDATE/);
  assert.deepEqual(queryTarget.queries[0].params, [
    10,
    8,
    'quotation_engineer',
    'edit',
    2,
    'Reactor section',
    'Check heat transfer area',
    '2026-06-15',
    true
  ]);
});

test('opportunity responsibility repository removes active team members by row id', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  await repository.removeTeamMember({
    opportunityId: 10,
    memberId: 41,
    removedBy: 2
  });

  assert.match(queryTarget.queries[0].sql, /UPDATE opportunity_members/);
  assert.match(queryTarget.queries[0].sql, /SET\s+is_active = false/);
  assert.match(queryTarget.queries[0].sql, /removed_by = \$3/);
  assert.match(queryTarget.queries[0].sql, /removed_at = now\(\)/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunity_member_events/);
  assert.match(queryTarget.queries[0].sql, /AND id = \$2/);
  assert.match(queryTarget.queries[0].sql, /opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /is_active = true/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 41, 2]);
});

test('opportunity responsibility repository lists engineering assignment events', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '61',
    opportunity_id: '10',
    member_id: '41',
    user_id: '8',
    user_display_name: 'Support Engineer',
    event_type: 'updated',
    role_code: 'quotation_engineer',
    role_name: 'Quotation Engineer',
    permission_level: 'edit',
    assignment_scope: 'Drying section',
    task_description: 'Update equipment list',
    due_date: '2026-06-18',
    can_send_external_email: true,
    actor_user_id: '3',
    actor_display_name: 'Lead Engineer',
    created_at: '2026-06-08T08:00:00.000Z'
  }]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  const events = await repository.listTeamMemberEventsByOpportunity(10);

  assert.deepEqual(events, [{
    id: 61,
    opportunityId: 10,
    memberId: 41,
    userId: 8,
    userDisplayName: 'Support Engineer',
    eventType: 'updated',
    roleCode: 'quotation_engineer',
    roleName: 'Quotation Engineer',
    permissionLevel: 'edit',
    assignmentScope: 'Drying section',
    taskDescription: 'Update equipment list',
    dueDate: '2026-06-18',
    canSendExternalEmail: true,
    actorUserId: 3,
    actorDisplayName: 'Lead Engineer',
    createdAt: '2026-06-08T08:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_member_events ome/);
  assert.deepEqual(queryTarget.queries[0].params, [10]);
});

test('opportunity responsibility repository creates and lists attributed engineering contributions', async () => {
  const createTarget = createFakeQueryTarget([{ id: '71' }]);
  const createRepository = createOpportunityResponsibilityRepository(createTarget);

  const created = await createRepository.createEngineeringContribution({
    opportunityId: 10,
    contributorUserId: 8,
    contributionSummary: 'Completed agitator calculation.',
    createdBy: 8
  });

  assert.deepEqual(created, { id: 71 });
  assert.match(createTarget.queries[0].sql, /INSERT INTO opportunity_engineering_contributions/);
  assert.deepEqual(createTarget.queries[0].params, [10, 8, 'Completed agitator calculation.', 8]);

  const listTarget = createFakeQueryTarget([{
    id: '71',
    opportunity_id: '10',
    contributor_user_id: '8',
    contributor_display_name: 'Support Engineer',
    contribution_summary: 'Completed agitator calculation.',
    created_by: '8',
    created_by_display_name: 'Support Engineer',
    created_at: '2026-06-09T08:00:00.000Z'
  }]);
  const listRepository = createOpportunityResponsibilityRepository(listTarget);

  const contributions = await listRepository.listEngineeringContributionsByOpportunity(10);

  assert.deepEqual(contributions, [{
    id: 71,
    opportunityId: 10,
    contributorUserId: 8,
    contributorDisplayName: 'Support Engineer',
    contributionSummary: 'Completed agitator calculation.',
    createdBy: 8,
    createdByDisplayName: 'Support Engineer',
    createdAt: '2026-06-09T08:00:00.000Z'
  }]);
  assert.match(listTarget.queries[0].sql, /FROM opportunity_engineering_contributions oec/);
  assert.deepEqual(listTarget.queries[0].params, [10]);
});

test('opportunity responsibility repository lists owner transfer history', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '51',
    opportunity_id: '10',
    from_owner_user_id: '7',
    from_owner_display_name: 'Old Owner',
    to_owner_user_id: '8',
    to_owner_display_name: 'New Owner',
    changed_by: '2',
    changed_by_display_name: 'Sales Manager',
    reason: 'Territory realignment',
    keep_previous_owner_as_member: true,
    transferred_at: '2026-06-06T09:00:00.000Z'
  }]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  const transfers = await repository.listOwnerTransfersByOpportunity(10);

  assert.deepEqual(transfers, [{
    id: 51,
    opportunityId: 10,
    fromOwnerUserId: 7,
    fromOwnerDisplayName: 'Old Owner',
    toOwnerUserId: 8,
    toOwnerDisplayName: 'New Owner',
    changedBy: 2,
    changedByDisplayName: 'Sales Manager',
    reason: 'Territory realignment',
    keepPreviousOwnerAsMember: true,
    transferredAt: '2026-06-06T09:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_owner_transfers oot/);
  assert.match(queryTarget.queries[0].sql, /JOIN users from_owner/);
  assert.match(queryTarget.queries[0].sql, /JOIN users to_owner/);
  assert.match(queryTarget.queries[0].sql, /JOIN users changed_by_user/);
  assert.match(queryTarget.queries[0].sql, /WHERE oot\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY oot\.transferred_at DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [10]);
});

test('opportunity responsibility repository transfers owner and optionally keeps previous owner as team member', async () => {
  const queryTarget = createFakeQueryTarget([
    [],
    [{ id: '10' }],
    [{ id: '51' }],
    [{ id: '41' }],
    []
  ]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  await repository.transferOwner({
    opportunityId: 10,
    fromOwnerUserId: 7,
    toOwnerUserId: 8,
    changedBy: 2,
    reason: 'Territory realignment',
    keepPreviousOwnerAsMember: true
  });

  assert.match(queryTarget.queries[0].sql, /BEGIN/);
  assert.match(queryTarget.queries[1].sql, /UPDATE opportunities/);
  assert.match(queryTarget.queries[1].sql, /salesperson_id = \$2/);
  assert.match(queryTarget.queries[1].sql, /WHERE id = \$1/);
  assert.match(queryTarget.queries[1].sql, /salesperson_id = \$3/);
  assert.deepEqual(queryTarget.queries[1].params, [10, 8, 7]);
  assert.match(queryTarget.queries[2].sql, /INSERT INTO opportunity_owner_transfers/);
  assert.deepEqual(queryTarget.queries[2].params, [10, 7, 8, 2, 'Territory realignment', true]);
  assert.match(queryTarget.queries[3].sql, /INSERT INTO opportunity_members/);
  assert.deepEqual(queryTarget.queries[3].params, [10, 7, 'salesperson', 'view', 2]);
  assert.match(queryTarget.queries[4].sql, /COMMIT/);
});

test('opportunity responsibility repository does not expose current responsible todo queries', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  assert.equal(repository.listCurrentResponsiblesByOpportunity, undefined);
  assert.deepEqual(queryTarget.queries, []);
});
