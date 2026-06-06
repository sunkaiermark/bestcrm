function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function mapTeamMemberRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    userId: Number(row.user_id),
    username: row.username || '',
    userDisplayName: row.user_display_name || '',
    roleCode: row.role_code,
    roleName: row.role_name || '',
    permissionLevel: row.permission_level,
    isActive: Boolean(row.is_active),
    addedBy: Number(row.added_by),
    addedByDisplayName: row.added_by_display_name || '',
    addedAt: row.added_at,
    removedBy: numberOrNull(row.removed_by),
    removedByDisplayName: row.removed_by_display_name || '',
    removedAt: row.removed_at
  };
}

function mapOwnerTransferRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    fromOwnerUserId: Number(row.from_owner_user_id),
    fromOwnerDisplayName: row.from_owner_display_name || '',
    toOwnerUserId: Number(row.to_owner_user_id),
    toOwnerDisplayName: row.to_owner_display_name || '',
    changedBy: Number(row.changed_by),
    changedByDisplayName: row.changed_by_display_name || '',
    reason: row.reason,
    keepPreviousOwnerAsMember: Boolean(row.keep_previous_owner_as_member),
    transferredAt: row.transferred_at
  };
}

function mapCurrentResponsibleRow(row) {
  return {
    todoId: Number(row.todo_id),
    opportunityId: Number(row.opportunity_id),
    assigneeUserId: Number(row.assignee_user_id),
    assigneeUsername: row.assignee_username || '',
    assigneeDisplayName: row.assignee_display_name || '',
    title: row.title,
    status: row.status,
    dueAt: row.due_at,
    createdAt: row.created_at
  };
}

export function createOpportunityResponsibilityRepository(queryTarget) {
  return {
    async listTeamMembersByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          om.id,
          om.opportunity_id,
          om.user_id,
          member.username,
          member.display_name AS user_display_name,
          om.role_code,
          COALESCE(r.name, om.role_code) AS role_name,
          om.permission_level,
          om.is_active,
          om.added_by,
          added_by_user.display_name AS added_by_display_name,
          om.added_at,
          om.removed_by,
          removed_by_user.display_name AS removed_by_display_name,
          om.removed_at
        FROM opportunity_members om
        JOIN users member ON member.id = om.user_id
        LEFT JOIN roles r ON r.code = om.role_code
        JOIN users added_by_user ON added_by_user.id = om.added_by
        LEFT JOIN users removed_by_user ON removed_by_user.id = om.removed_by
        WHERE om.opportunity_id = $1
          AND om.is_active = true
        ORDER BY om.added_at ASC, om.id ASC
      `, [opportunityId]);
      return result.rows.map(mapTeamMemberRow);
    },

    async listOwnerTransfersByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          oot.id,
          oot.opportunity_id,
          oot.from_owner_user_id,
          from_owner.display_name AS from_owner_display_name,
          oot.to_owner_user_id,
          to_owner.display_name AS to_owner_display_name,
          oot.changed_by,
          changed_by_user.display_name AS changed_by_display_name,
          oot.reason,
          oot.keep_previous_owner_as_member,
          oot.transferred_at
        FROM opportunity_owner_transfers oot
        JOIN users from_owner ON from_owner.id = oot.from_owner_user_id
        JOIN users to_owner ON to_owner.id = oot.to_owner_user_id
        JOIN users changed_by_user ON changed_by_user.id = oot.changed_by
        WHERE oot.opportunity_id = $1
        ORDER BY oot.transferred_at DESC, oot.id DESC
      `, [opportunityId]);
      return result.rows.map(mapOwnerTransferRow);
    },

    async listCurrentResponsiblesByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          t.id AS todo_id,
          t.opportunity_id,
          t.assignee_user_id,
          assignee.username AS assignee_username,
          assignee.display_name AS assignee_display_name,
          t.title,
          t.status,
          t.due_at,
          t.created_at
        FROM todos t
        JOIN users assignee ON assignee.id = t.assignee_user_id
        WHERE t.opportunity_id = $1
          AND t.status = 'pending'
        ORDER BY t.created_at DESC, t.id DESC
      `, [opportunityId]);
      return result.rows.map(mapCurrentResponsibleRow);
    }
  };
}
