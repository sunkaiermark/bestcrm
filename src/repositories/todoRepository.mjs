function nullableDate(value) {
  return value || null;
}

function mapTodoRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    assigneeUserId: Number(row.assignee_user_id),
    assigneeDisplayName: row.assignee_display_name || '',
    title: row.title,
    status: row.status,
    dueAt: nullableDate(row.due_at),
    createdAt: row.created_at,
    completedAt: nullableDate(row.completed_at)
  };
}

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

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          t.id,
          t.opportunity_id,
          t.assignee_user_id,
          assignee.display_name AS assignee_display_name,
          t.title,
          t.status,
          t.due_at,
          t.created_at,
          t.completed_at
        FROM todos t
        JOIN users assignee ON assignee.id = t.assignee_user_id
        WHERE t.opportunity_id = $1
        ORDER BY CASE WHEN t.status = 'pending' THEN 0 ELSE 1 END, t.created_at DESC, t.id DESC
      `, [opportunityId]);
      return result.rows.map(mapTodoRow);
    },

    async closePendingForOpportunity(opportunityId, status) {
      return queryTarget.query(`
        UPDATE todos
        SET status = $2, completed_at = now()
        WHERE opportunity_id = $1
          AND status = 'pending'
      `, [opportunityId, status]);
    },

    async closePendingForOpportunityAndAssignee(opportunityId, assigneeUserId, status) {
      return queryTarget.query(`
        UPDATE todos
        SET status = $3, completed_at = now()
        WHERE opportunity_id = $1
          AND assignee_user_id = $2
          AND status = 'pending'
      `, [opportunityId, assigneeUserId, status]);
    }
  };
}
