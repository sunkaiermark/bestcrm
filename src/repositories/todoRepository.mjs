export function createTodoRepository(queryTarget) {
  return {
    async create(todo) {
      const result = await queryTarget.query(`
        INSERT INTO todos (
          opportunity_id,
          assignee_user_id,
          title
        )
        VALUES ($1, $2, $3)
        RETURNING *
      `, [
        todo.opportunityId,
        todo.assigneeUserId,
        todo.title
      ]);
      return {
        id: Number(result.rows[0].id),
        ...todo
      };
    },

    async closePendingForOpportunity(opportunityId, status) {
      return queryTarget.query(`
        UPDATE todos
        SET status = $2, completed_at = now()
        WHERE opportunity_id = $1
          AND status = 'pending'
      `, [opportunityId, status]);
    }
  };
}
