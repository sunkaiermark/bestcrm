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
    is_active: true,
    added_by: '2',
    added_by_display_name: 'Sales Manager',
    added_at: '2026-06-06T08:00:00.000Z',
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
    isActive: true,
    addedBy: 2,
    addedByDisplayName: 'Sales Manager',
    addedAt: '2026-06-06T08:00:00.000Z',
    removedBy: null,
    removedByDisplayName: '',
    removedAt: null
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_members om/);
  assert.match(queryTarget.queries[0].sql, /JOIN users member/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN roles r/);
  assert.match(queryTarget.queries[0].sql, /JOIN users added_by_user/);
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
    permissionLevel: 'view',
    addedBy: 2
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunity_members/);
  assert.match(queryTarget.queries[0].sql, /ON CONFLICT \(opportunity_id, user_id, role_code\) WHERE is_active = true DO UPDATE/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 8, 'quotation_engineer', 'view', 2]);
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
  assert.match(queryTarget.queries[0].sql, /AND id = \$2/);
  assert.match(queryTarget.queries[0].sql, /opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /is_active = true/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 41, 2]);
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

test('opportunity responsibility repository reads current responsibles from pending todos', async () => {
  const queryTarget = createFakeQueryTarget([{
    todo_id: '61',
    opportunity_id: '10',
    assignee_user_id: '9',
    assignee_username: 'technical_manager01',
    assignee_display_name: 'Technical Manager',
    title: 'Approve technical solution',
    status: 'pending',
    due_at: null,
    created_at: '2026-06-06T10:00:00.000Z'
  }]);
  const repository = createOpportunityResponsibilityRepository(queryTarget);

  const responsibles = await repository.listCurrentResponsiblesByOpportunity(10);

  assert.deepEqual(responsibles, [{
    todoId: 61,
    opportunityId: 10,
    assigneeUserId: 9,
    assigneeUsername: 'technical_manager01',
    assigneeDisplayName: 'Technical Manager',
    title: 'Approve technical solution',
    status: 'pending',
    dueAt: null,
    createdAt: '2026-06-06T10:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM todos t/);
  assert.match(queryTarget.queries[0].sql, /JOIN users assignee/);
  assert.match(queryTarget.queries[0].sql, /WHERE t\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /t\.status = 'pending'/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY t\.created_at DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [10]);
});
