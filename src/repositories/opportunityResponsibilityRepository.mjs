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
    assignmentScope: row.assignment_scope || '',
    taskDescription: row.task_description || '',
    dueDate: row.due_date,
    canSendExternalEmail: Boolean(row.can_send_external_email),
    isActive: Boolean(row.is_active),
    addedBy: Number(row.added_by),
    addedByDisplayName: row.added_by_display_name || '',
    addedAt: row.added_at,
    updatedBy: numberOrNull(row.updated_by),
    updatedByDisplayName: row.updated_by_display_name || '',
    updatedAt: row.updated_at,
    removedBy: numberOrNull(row.removed_by),
    removedByDisplayName: row.removed_by_display_name || '',
    removedAt: row.removed_at
  };
}

function mapTeamMemberEventRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    memberId: numberOrNull(row.member_id),
    userId: Number(row.user_id),
    userDisplayName: row.user_display_name || '',
    eventType: row.event_type,
    roleCode: row.role_code,
    roleName: row.role_name || '',
    permissionLevel: row.permission_level,
    assignmentScope: row.assignment_scope || '',
    taskDescription: row.task_description || '',
    dueDate: row.due_date,
    canSendExternalEmail: Boolean(row.can_send_external_email),
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    createdAt: row.created_at
  };
}

function mapEngineeringContributionRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    contributorUserId: Number(row.contributor_user_id),
    contributorDisplayName: row.contributor_display_name || '',
    contributionSummary: row.contribution_summary,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    createdAt: row.created_at
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

export function createOpportunityResponsibilityRepository(queryTarget) {
  return {
    async addTeamMember(input) {
      const result = await queryTarget.query(`
        WITH existing_member AS (
          SELECT id
          FROM opportunity_members
          WHERE opportunity_id = $1
            AND user_id = $2
            AND role_code = $3
            AND is_active = true
        ), upserted_member AS (
          INSERT INTO opportunity_members (
            opportunity_id,
            user_id,
            role_code,
            permission_level,
            assignment_scope,
            task_description,
            due_date,
            can_send_external_email,
            added_by,
            updated_by,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $6, $7, $8, $9, $5, $5, now())
          ON CONFLICT (opportunity_id, user_id, role_code) WHERE is_active = true DO UPDATE
          SET
            permission_level = EXCLUDED.permission_level,
            assignment_scope = EXCLUDED.assignment_scope,
            task_description = EXCLUDED.task_description,
            due_date = EXCLUDED.due_date,
            can_send_external_email = EXCLUDED.can_send_external_email,
            updated_by = EXCLUDED.updated_by,
            updated_at = now(),
            removed_by = NULL,
            removed_at = NULL
          RETURNING *
        ), logged_event AS (
          INSERT INTO opportunity_member_events (
            opportunity_id,
            member_id,
            user_id,
            event_type,
            role_code,
            permission_level,
            assignment_scope,
            task_description,
            due_date,
            can_send_external_email,
            actor_user_id
          )
          SELECT
            opportunity_id,
            id,
            user_id,
            CASE WHEN EXISTS (SELECT 1 FROM existing_member) THEN 'updated' ELSE 'assigned' END,
            role_code,
            permission_level,
            assignment_scope,
            task_description,
            due_date,
            can_send_external_email,
            $5
          FROM upserted_member
        )
        SELECT id FROM upserted_member
      `, [
        input.opportunityId,
        input.userId,
        input.roleCode,
        input.permissionLevel,
        input.addedBy,
        input.assignmentScope || null,
        input.taskDescription || null,
        input.dueDate || null,
        Boolean(input.canSendExternalEmail)
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async removeTeamMember(input) {
      const result = await queryTarget.query(`
        WITH removed_member AS (
          UPDATE opportunity_members
          SET
            is_active = false,
            removed_by = $3,
            removed_at = now(),
            updated_by = $3,
            updated_at = now()
          WHERE opportunity_id = $1
            AND id = $2
            AND is_active = true
          RETURNING *
        ), logged_event AS (
          INSERT INTO opportunity_member_events (
            opportunity_id,
            member_id,
            user_id,
            event_type,
            role_code,
            permission_level,
            assignment_scope,
            task_description,
            due_date,
            can_send_external_email,
            actor_user_id
          )
          SELECT
            opportunity_id,
            id,
            user_id,
            'removed',
            role_code,
            permission_level,
            assignment_scope,
            task_description,
            due_date,
            can_send_external_email,
            $3
          FROM removed_member
        )
        SELECT id FROM removed_member
      `, [
        input.opportunityId,
        input.memberId,
        input.removedBy
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async transferOwner(input) {
      await queryTarget.query('BEGIN');
      try {
        const ownerResult = await queryTarget.query(`
          UPDATE opportunities
          SET salesperson_id = $2, updated_at = now()
          WHERE id = $1
            AND salesperson_id = $3
          RETURNING id
        `, [
          input.opportunityId,
          input.toOwnerUserId,
          input.fromOwnerUserId
        ]);
        if (!ownerResult.rows[0]) {
          throw new Error('Opportunity owner changed before transfer');
        }

        const transferResult = await queryTarget.query(`
          INSERT INTO opportunity_owner_transfers (
            opportunity_id,
            from_owner_user_id,
            to_owner_user_id,
            changed_by,
            reason,
            keep_previous_owner_as_member
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          input.opportunityId,
          input.fromOwnerUserId,
          input.toOwnerUserId,
          input.changedBy,
          input.reason,
          input.keepPreviousOwnerAsMember
        ]);

        if (input.keepPreviousOwnerAsMember) {
          await queryTarget.query(`
            INSERT INTO opportunity_members (
              opportunity_id,
              user_id,
              role_code,
              permission_level,
              added_by
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (opportunity_id, user_id, role_code) WHERE is_active = true DO UPDATE
            SET
              permission_level = EXCLUDED.permission_level,
              added_by = EXCLUDED.added_by,
              added_at = now(),
              removed_by = NULL,
              removed_at = NULL
          `, [
            input.opportunityId,
            input.fromOwnerUserId,
            'salesperson',
            'view',
            input.changedBy
          ]);
        }

        await queryTarget.query('COMMIT');
        return transferResult.rows[0] ? { id: Number(transferResult.rows[0].id) } : null;
      } catch (error) {
        await queryTarget.query('ROLLBACK');
        throw error;
      }
    },

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
          om.assignment_scope,
          om.task_description,
          om.due_date,
          om.can_send_external_email,
          om.is_active,
          om.added_by,
          added_by_user.display_name AS added_by_display_name,
          om.added_at,
          om.updated_by,
          updated_by_user.display_name AS updated_by_display_name,
          om.updated_at,
          om.removed_by,
          removed_by_user.display_name AS removed_by_display_name,
          om.removed_at
        FROM opportunity_members om
        JOIN users member ON member.id = om.user_id
        LEFT JOIN roles r ON r.code = om.role_code
        JOIN users added_by_user ON added_by_user.id = om.added_by
        LEFT JOIN users updated_by_user ON updated_by_user.id = om.updated_by
        LEFT JOIN users removed_by_user ON removed_by_user.id = om.removed_by
        WHERE om.opportunity_id = $1
          AND om.is_active = true
        ORDER BY om.added_at ASC, om.id ASC
      `, [opportunityId]);
      return result.rows.map(mapTeamMemberRow);
    },

    async listTeamMemberEventsByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          ome.id,
          ome.opportunity_id,
          ome.member_id,
          ome.user_id,
          member.display_name AS user_display_name,
          ome.event_type,
          ome.role_code,
          COALESCE(r.name, ome.role_code) AS role_name,
          ome.permission_level,
          ome.assignment_scope,
          ome.task_description,
          ome.due_date,
          ome.can_send_external_email,
          ome.actor_user_id,
          actor.display_name AS actor_display_name,
          ome.created_at
        FROM opportunity_member_events ome
        JOIN users member ON member.id = ome.user_id
        LEFT JOIN roles r ON r.code = ome.role_code
        JOIN users actor ON actor.id = ome.actor_user_id
        WHERE ome.opportunity_id = $1
        ORDER BY ome.created_at DESC, ome.id DESC
      `, [opportunityId]);
      return result.rows.map(mapTeamMemberEventRow);
    },

    async createEngineeringContribution(input) {
      const result = await queryTarget.query(`
        INSERT INTO opportunity_engineering_contributions (
          opportunity_id,
          contributor_user_id,
          contribution_summary,
          created_by
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        input.opportunityId,
        input.contributorUserId,
        input.contributionSummary,
        input.createdBy
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async listEngineeringContributionsByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          oec.id,
          oec.opportunity_id,
          oec.contributor_user_id,
          contributor.display_name AS contributor_display_name,
          oec.contribution_summary,
          oec.created_by,
          created_by_user.display_name AS created_by_display_name,
          oec.created_at
        FROM opportunity_engineering_contributions oec
        JOIN users contributor ON contributor.id = oec.contributor_user_id
        JOIN users created_by_user ON created_by_user.id = oec.created_by
        WHERE oec.opportunity_id = $1
        ORDER BY oec.created_at DESC, oec.id DESC
      `, [opportunityId]);
      return result.rows.map(mapEngineeringContributionRow);
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
    }
  };
}
