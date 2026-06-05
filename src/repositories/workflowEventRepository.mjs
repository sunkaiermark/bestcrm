function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function mapWorkflowEventRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    targetUserId: numberOrNull(row.target_user_id),
    targetDisplayName: row.target_display_name || '',
    comment: row.comment,
    createdAt: row.created_at
  };
}

export function createWorkflowEventRepository(queryTarget) {
  return {
    async create(event) {
      const result = await queryTarget.query(`
        INSERT INTO workflow_events (
          opportunity_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          target_user_id,
          comment
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        event.opportunityId,
        event.eventType,
        event.fromStatus,
        event.toStatus,
        event.actorUserId,
        event.targetUserId,
        event.comment
      ]);
      return {
        id: Number(result.rows[0].id),
        ...event
      };
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          we.id,
          we.opportunity_id,
          we.event_type,
          we.from_status,
          we.to_status,
          we.actor_user_id,
          actor.display_name AS actor_display_name,
          we.target_user_id,
          target.display_name AS target_display_name,
          we.comment,
          we.created_at
        FROM workflow_events we
        LEFT JOIN users actor ON actor.id = we.actor_user_id
        LEFT JOIN users target ON target.id = we.target_user_id
        WHERE we.opportunity_id = $1
        ORDER BY we.created_at DESC, we.id DESC
      `, [opportunityId]);
      return result.rows.map(mapWorkflowEventRow);
    }
  };
}
