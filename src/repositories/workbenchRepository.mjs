import { STATUSES } from '../domain/statuses.mjs';

function mapWorkItemRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    opportunityId: row.opportunity_id === null ? null : Number(row.opportunity_id),
    opportunityNo: row.opportunity_no || '',
    opportunityTitle: row.opportunity_title || '',
    customerName: row.customer_name || '',
    assigneeUserId: Number(row.assignee_user_id),
    title: row.title,
    description: row.description || '',
    status: row.status,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    roleContext: row.role_context || '',
    plannedStartAt: row.planned_start_at || row.created_at,
    dueAt: row.due_at || null,
    estimatedHours: row.estimated_hours === null || row.estimated_hours === undefined
      ? null
      : Number(row.estimated_hours),
    workloadLevel: row.workload_level || null,
    kpiCode: row.kpi_code || 'complete_assigned_work',
    kpiTarget: row.kpi_target || '',
    actualStartedAt: row.actual_started_at || null,
    actualCompletedAt: row.actual_completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    actionUrl: row.opportunity_id ? `/opportunities/${row.opportunity_id}` : '/workbench',
    estimateUrl: `/workbench/work-items/${row.id}/estimate`
  };
}

function mapOpportunityInitiationTodoRow(row) {
  const revise = row.opportunity_status === STATUSES.INITIATION_REJECTED;
  return {
    id: `opportunity-initiation-${row.opportunity_id}`,
    opportunityId: Number(row.opportunity_id),
    opportunityNo: row.opportunity_no,
    opportunityTitle: row.opportunity_title,
    customerName: row.customer_name,
    title: revise
      ? 'Revise and resubmit opportunity'
      : 'Submit opportunity initiation',
    status: 'pending',
    sourceType: 'workflow_opportunity',
    sourceKey: revise ? 'revise_opportunity_initiation' : 'submit_opportunity_initiation',
    roleContext: 'sales',
    plannedStartAt: row.updated_at,
    dueAt: null,
    estimatedHours: null,
    workloadLevel: null,
    kpiCode: revise ? 'resubmit_opportunity_initiation' : 'submit_opportunity_initiation',
    kpiTarget: '',
    createdAt: row.updated_at,
    actionUrl: `/opportunities/${row.opportunity_id}`
  };
}

function mapProjectExecutionConfirmationRow(row) {
  return {
    id: `project-execution-confirmation-${row.opportunity_id}`,
    opportunityId: Number(row.opportunity_id),
    opportunityNo: row.opportunity_no,
    opportunityTitle: row.opportunity_title,
    customerName: row.customer_name,
    title: 'Confirm Project Execution creation',
    description: 'Confirm that the contract is signed and record the signing date.',
    status: 'pending',
    sourceType: 'project_execution_confirmation',
    sourceKey: 'confirm_project_execution_creation',
    roleContext: row.role_code || '',
    plannedStartAt: row.archived_at || row.updated_at,
    dueAt: null,
    estimatedHours: null,
    workloadLevel: null,
    kpiCode: 'confirm_project_execution_creation',
    kpiTarget: '',
    createdAt: row.archived_at || row.updated_at,
    actionUrl: `/opportunities/${row.opportunity_id}/project-execution/confirm`
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
    async listOpenWorkItems(userId, limit = 20) {
      const result = await queryTarget.query(`
        SELECT
          item.id,
          item.opportunity_id,
          opportunity.opportunity_no,
          opportunity.title AS opportunity_title,
          customer.name AS customer_name,
          item.assignee_user_id,
          item.source_type,
          item.source_key,
          item.role_context,
          item.title,
          item.description,
          item.planned_start_at,
          item.due_at,
          item.estimated_hours,
          item.workload_level,
          item.kpi_code,
          item.kpi_target,
          item.status,
          item.actual_started_at,
          item.actual_completed_at,
          item.created_at,
          item.updated_at
        FROM work_items item
        LEFT JOIN opportunities opportunity ON opportunity.id = item.opportunity_id
        LEFT JOIN customers customer ON customer.id = opportunity.customer_id
        WHERE item.assignee_user_id = $1
          AND item.status IN ('pending', 'in_progress', 'waiting', 'review_pending')
        ORDER BY
          CASE WHEN item.due_at IS NOT NULL AND item.due_at < now() THEN 0 ELSE 1 END,
          item.due_at ASC NULLS LAST,
          item.planned_start_at ASC NULLS LAST,
          item.id DESC
        LIMIT $2
      `, [userId, limit]);
      return result.rows.map(mapWorkItemRow);
    },

    async findWorkItemById(id) {
      const result = await queryTarget.query(`
        SELECT
          item.id,
          item.opportunity_id,
          opportunity.opportunity_no,
          opportunity.title AS opportunity_title,
          customer.name AS customer_name,
          item.assignee_user_id,
          item.source_type,
          item.source_key,
          item.role_context,
          item.title,
          item.description,
          item.planned_start_at,
          item.due_at,
          item.estimated_hours,
          item.workload_level,
          item.kpi_code,
          item.kpi_target,
          item.status,
          item.actual_started_at,
          item.actual_completed_at,
          item.created_at,
          item.updated_at
        FROM work_items item
        LEFT JOIN opportunities opportunity ON opportunity.id = item.opportunity_id
        LEFT JOIN customers customer ON customer.id = opportunity.customer_id
        WHERE item.id = $1
        LIMIT 1
      `, [Number(id)]);
      return mapWorkItemRow(result.rows[0]);
    },

    async updateWorkItemEstimation(id, input) {
      const result = await queryTarget.query(`
        UPDATE work_items
        SET
          estimated_hours = $2,
          workload_level = $3,
          updated_by_user_id = $4,
          updated_at = now()
        WHERE id = $1
          AND status IN ('pending', 'in_progress', 'waiting', 'review_pending')
        RETURNING id
      `, [
        Number(id),
        input.estimatedHours,
        input.workloadLevel,
        Number(input.actorUserId)
      ]);
      return result.rowCount > 0;
    },

    async listOpportunityInitiationTodos(userId, limit = 8) {
      const result = await queryTarget.query(`
        SELECT
          o.id AS opportunity_id,
          o.opportunity_no,
          o.title AS opportunity_title,
          c.name AS customer_name,
          o.status AS opportunity_status,
          o.updated_at
        FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.salesperson_id = $1
          AND o.status IN ($2, $3)
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT $4
      `, [userId, STATUSES.DRAFT, STATUSES.INITIATION_REJECTED, limit]);
      return result.rows.map(mapOpportunityInitiationTodoRow);
    },

    async listProjectExecutionConfirmationItems(userId, limit = 8) {
      const result = await queryTarget.query(`
        SELECT
          o.id AS opportunity_id,
          o.opportunity_no,
          o.title AS opportunity_title,
          c.name AS customer_name,
          o.archived_at,
          o.updated_at,
          configured.role_code
        FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        CROSS JOIN LATERAL (
          SELECT aps.user_id, aps.role_code
          FROM approval_settings aps
          JOIN roles role ON role.code = aps.role_code
          JOIN user_roles assignment
            ON assignment.role_id = role.id
           AND assignment.user_id = aps.user_id
          JOIN users configured_user ON configured_user.id = aps.user_id
          WHERE aps.setting_key = 'project_execution_creation'
            AND aps.is_active = true
            AND configured_user.is_active = true
          ORDER BY aps.sort_order ASC, aps.id ASC
          LIMIT 1
        ) configured
        LEFT JOIN project_executions pe ON pe.opportunity_id = o.id
        WHERE o.status = $2
          AND configured.user_id = $1
          AND pe.id IS NULL
        ORDER BY o.archived_at DESC NULLS LAST, o.updated_at DESC, o.id DESC
        LIMIT $3
      `, [userId, STATUSES.CONTRACT_ARCHIVED, limit]);
      return result.rows.map(mapProjectExecutionConfirmationRow);
    },

    async listRecentWorkflowMessages(userId, isAdministrator = false, limit = 10) {
      const params = isAdministrator ? [limit] : [userId, limit];
      const visibilityClause = isAdministrator ? '' : `WHERE ${visibleOpportunityPredicate('$1')}`;
      const limitParam = isAdministrator ? '$1' : '$2';
      const result = await queryTarget.query(`
        SELECT recent.*
        FROM (
          SELECT DISTINCT ON (we.opportunity_id)
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
          ORDER BY we.opportunity_id, we.created_at DESC, we.id DESC
        ) recent
        ORDER BY recent.created_at DESC, recent.id DESC
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
