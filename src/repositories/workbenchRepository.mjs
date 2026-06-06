function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function mapTodoRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityNo: row.opportunity_no,
    opportunityTitle: row.opportunity_title,
    customerName: row.customer_name,
    title: row.title,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapOpportunityRow(row) {
  return {
    id: Number(row.id),
    opportunityNo: row.opportunity_no,
    title: row.title,
    customerName: row.customer_name,
    status: row.status,
    estimatedAmount: numberOrNull(row.estimated_amount),
    updatedAt: row.updated_at
  };
}

function mapWorkflowMessageRow(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityNo: row.opportunity_no,
    opportunityTitle: row.opportunity_title,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorDisplayName: row.actor_display_name || '',
    targetDisplayName: row.target_display_name || '',
    comment: row.comment,
    createdAt: row.created_at
  };
}

function mapStateCountRow(row) {
  return {
    status: row.status,
    count: Number(row.count)
  };
}

function assignedOpportunityPredicate(userParam = '$1') {
  return `(
    o.sales_manager_id = ${userParam}
    OR o.quotation_engineer_id = ${userParam}
    OR o.technical_manager_id = ${userParam}
    OR o.commercial_manager_id = ${userParam}
    OR EXISTS (
      SELECT 1
      FROM opportunity_members om
      WHERE om.opportunity_id = o.id
        AND om.user_id = ${userParam}
        AND om.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM contract_approvals ca
      JOIN contract_approval_steps cas ON cas.contract_approval_id = ca.id
      WHERE ca.opportunity_id = o.id
        AND cas.reviewer_user_id = ${userParam}
    )
  )`;
}

function visibleOpportunityPredicate(userParam = '$1') {
  return `(
    o.salesperson_id = ${userParam}
    OR ${assignedOpportunityPredicate(userParam)}
  )`;
}

export function createWorkbenchRepository(queryTarget) {
  return {
    async listPendingTodos(userId, limit = 8) {
      const result = await queryTarget.query(`
        SELECT
          t.id,
          t.opportunity_id,
          o.opportunity_no,
          o.title AS opportunity_title,
          c.name AS customer_name,
          t.title,
          t.status,
          t.created_at
        FROM todos t
        JOIN opportunities o ON o.id = t.opportunity_id
        JOIN customers c ON c.id = o.customer_id
        WHERE t.assignee_user_id = $1
          AND t.status = 'pending'
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $2
      `, [userId, limit]);
      return result.rows.map(mapTodoRow);
    },

    async listCreatedOpportunities(userId, limit = 8) {
      const result = await queryTarget.query(`
        SELECT
          o.id,
          o.opportunity_no,
          o.title,
          c.name AS customer_name,
          o.status,
          o.estimated_amount,
          o.updated_at
        FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.salesperson_id = $1
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT $2
      `, [userId, limit]);
      return result.rows.map(mapOpportunityRow);
    },

    async listAssignedOpportunities(userId, limit = 8) {
      const result = await queryTarget.query(`
        SELECT DISTINCT
          o.id,
          o.opportunity_no,
          o.title,
          c.name AS customer_name,
          o.status,
          o.estimated_amount,
          o.updated_at
        FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        WHERE ${assignedOpportunityPredicate('$1')}
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT $2
      `, [userId, limit]);
      return result.rows.map(mapOpportunityRow);
    },

    async listRecentWorkflowMessages(userId, isAdministrator = false, limit = 10) {
      const params = isAdministrator ? [limit] : [userId, limit];
      const visibilityClause = isAdministrator ? '' : `WHERE ${visibleOpportunityPredicate('$1')}`;
      const limitParam = isAdministrator ? '$1' : '$2';
      const result = await queryTarget.query(`
        SELECT
          we.id,
          we.opportunity_id,
          o.opportunity_no,
          o.title AS opportunity_title,
          we.event_type,
          we.from_status,
          we.to_status,
          actor.display_name AS actor_display_name,
          target.display_name AS target_display_name,
          we.comment,
          we.created_at
        FROM workflow_events we
        JOIN opportunities o ON o.id = we.opportunity_id
        LEFT JOIN users actor ON actor.id = we.actor_user_id
        LEFT JOIN users target ON target.id = we.target_user_id
        ${visibilityClause}
        ORDER BY we.created_at DESC, we.id DESC
        LIMIT ${limitParam}
      `, params);
      return result.rows.map(mapWorkflowMessageRow);
    },

    async countByWorkflowState(userId, isAdministrator = false) {
      const params = isAdministrator ? [] : [userId];
      const visibilityClause = isAdministrator ? '' : `WHERE ${visibleOpportunityPredicate('$1')}`;
      const result = await queryTarget.query(`
        SELECT o.status, count(*) AS count
        FROM opportunities o
        ${visibilityClause}
        GROUP BY o.status
        ORDER BY o.status ASC
      `, params);
      return result.rows.map(mapStateCountRow);
    }
  };
}
