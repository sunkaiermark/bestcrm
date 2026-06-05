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
    }
  };
}
