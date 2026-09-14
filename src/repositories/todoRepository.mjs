function nullableDate(value) {
  return value || null;
}

const workItemDefinitions = new Map([
  ['Approve opportunity initiation', { kpiCode: 'approve_on_time', roleContext: 'sales' }],
  ['Prepare technical solution', { kpiCode: 'submit_technical_solution', roleContext: 'technical' }],
  ['Revise technical solution', { kpiCode: 'resubmit_technical_solution', roleContext: 'technical' }],
  ['Approve technical solution', { kpiCode: 'review_technical_solution', roleContext: 'technical' }],
  ['Prepare commercial quote', { kpiCode: 'submit_commercial_quote', roleContext: 'commercial' }],
  ['Revise commercial quote', { kpiCode: 'resubmit_commercial_quote', roleContext: 'commercial' }],
  ['Approve commercial quote', { kpiCode: 'review_commercial_quote', roleContext: 'commercial' }],
  ['Send approved quote to customer', { kpiCode: 'send_approved_quote', roleContext: 'sales' }],
  ['Submit contract approval', { kpiCode: 'submit_contract_approval', roleContext: 'contract' }],
  ['Review contract', { kpiCode: 'review_contract', roleContext: 'contract' }],
  ['Revise contract', { kpiCode: 'resubmit_contract', roleContext: 'contract' }],
  ['Revise opportunity initiation', { kpiCode: 'resubmit_opportunity_initiation', roleContext: 'sales' }]
]);

function normalizedSourceKey(title) {
  const value = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return value || 'assigned_work';
}

function workItemDefinition(todo) {
  const definition = workItemDefinitions.get(todo.title);
  return {
    sourceKey: normalizedSourceKey(todo.title),
    kpiCode: definition?.kpiCode || 'complete_assigned_work',
    roleContext: definition?.roleContext || ''
  };
}

function closedWorkItemStatus(todoStatus) {
  return todoStatus === 'completed' ? 'completed' : 'cancelled';
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
  async function synchronizeCreatedTodo(createdTodo, input, actorUserId) {
    const definition = workItemDefinition(input);
    await queryTarget.query(`
      UPDATE work_items
      SET
        status = 'cancelled',
        actual_completed_at = now(),
        result_summary = 'Replaced by a newer workflow task',
        updated_by_user_id = $4,
        updated_at = now()
      WHERE opportunity_id = $1
        AND assignee_user_id = $2
        AND source_type = 'workflow_todo'
        AND source_key = $3
        AND status IN ('pending', 'in_progress', 'waiting', 'review_pending')
    `, [
      input.opportunityId,
      input.assigneeUserId,
      definition.sourceKey,
      actorUserId ?? null
    ]);

    await queryTarget.query(`
      INSERT INTO work_items (
        business_type,
        business_record_id,
        opportunity_id,
        assignee_user_id,
        created_by_user_id,
        source_type,
        source_record_id,
        source_key,
        role_context,
        title,
        description,
        planned_start_at,
        due_at,
        estimated_hours,
        workload_level,
        kpi_code,
        kpi_target,
        status
      ) VALUES (
        'opportunity', $1, $1, $2, $3, 'workflow_todo', $4, $5, $6, $7, $8,
        COALESCE($9::timestamptz, now()), $10, $11, $12, $13, $14, 'pending'
      )
      ON CONFLICT (source_type, source_record_id)
        WHERE source_record_id IS NOT NULL
      DO NOTHING
    `, [
      input.opportunityId,
      input.assigneeUserId,
      actorUserId ?? null,
      createdTodo.id,
      definition.sourceKey,
      input.roleContext || definition.roleContext,
      input.title,
      input.description || '',
      input.plannedStartAt || null,
      input.dueAt || null,
      input.estimatedHours ?? null,
      input.workloadLevel || null,
      input.kpiCode || definition.kpiCode,
      input.kpiTarget || ''
    ]);
  }

  async function synchronizeClosedTodos(rows, status, actorUserId) {
    const todoIds = (rows || []).map((row) => Number(row.id)).filter(Number.isFinite);
    if (!todoIds.length) {
      return;
    }
    await queryTarget.query(`
      UPDATE work_items
      SET
        status = $2,
        actual_completed_at = now(),
        result_summary = CASE
          WHEN result_summary = '' THEN $3
          ELSE result_summary
        END,
        updated_by_user_id = $4,
        updated_at = now()
      WHERE source_type = 'workflow_todo'
        AND source_record_id = ANY($1::bigint[])
        AND status IN ('pending', 'in_progress', 'waiting', 'review_pending')
    `, [todoIds, closedWorkItemStatus(status), status, actorUserId ?? null]);
  }

  return {
    async create(todo, actorUserId = null) {
      const result = await queryTarget.query(`
        INSERT INTO todos (
          opportunity_id,
          assignee_user_id,
          title,
          due_at
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        todo.opportunityId,
        todo.assigneeUserId,
        todo.title,
        todo.dueAt || null
      ]);
      const createdTodo = {
        id: Number(result.rows[0].id),
        ...todo
      };
      await synchronizeCreatedTodo(createdTodo, todo, actorUserId);
      return createdTodo;
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

    async closePendingForOpportunity(opportunityId, status, actorUserId = null) {
      const result = await queryTarget.query(`
        UPDATE todos
        SET status = $2, completed_at = now()
        WHERE opportunity_id = $1
          AND status = 'pending'
        RETURNING id
      `, [opportunityId, status]);
      await synchronizeClosedTodos(result.rows, status, actorUserId);
      return result;
    },

    async closePendingForOpportunityAndAssignee(opportunityId, assigneeUserId, status, actorUserId = null) {
      const result = await queryTarget.query(`
        UPDATE todos
        SET status = $3, completed_at = now()
        WHERE opportunity_id = $1
          AND assignee_user_id = $2
          AND status = 'pending'
        RETURNING id
      `, [opportunityId, assigneeUserId, status]);
      await synchronizeClosedTodos(result.rows, status, actorUserId);
      return result;
    },

    async closePendingForOpportunityAssigneeAndTitle(opportunityId, assigneeUserId, title, status, actorUserId = null) {
      const result = await queryTarget.query(`
        UPDATE todos
        SET status = $4, completed_at = now()
        WHERE opportunity_id = $1
          AND assignee_user_id = $2
          AND title = $3
          AND status = 'pending'
        RETURNING id
      `, [opportunityId, assigneeUserId, title, status]);
      await synchronizeClosedTodos(result.rows, status, actorUserId);
      return result;
    }
  };
}
