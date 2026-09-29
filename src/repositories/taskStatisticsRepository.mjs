const reportRows = `
  WITH task_rows AS (
    SELECT 'work_item'::text AS source_type, item.id AS source_id,
      item.assignee_user_id AS user_id, employee.display_name AS user_name,
      employee.is_active AS user_is_active,
      opportunity.opportunity_no AS project_no,
      opportunity.title AS project_name,
      item.title AS task_title, left(item.description, 300) AS task_summary,
      to_char(COALESCE(item.planned_start_at, item.created_at)
        AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') AS planned_start,
      to_char(item.due_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') AS planned_end,
      CASE WHEN item.status = 'completed' THEN
        to_char(item.actual_completed_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI')
        ELSE NULL END AS actual_completed,
      item.status, item.opportunity_id,
      (COALESCE(item.planned_start_at, item.created_at)
        AT TIME ZONE 'Asia/Shanghai')::date AS period_date,
      COALESCE(item.planned_start_at, item.created_at) AS sort_start
    FROM work_items item
    JOIN users employee ON employee.id = item.assignee_user_id
    LEFT JOIN opportunities opportunity ON opportunity.id = item.opportunity_id

    UNION ALL

    SELECT 'development_subproject'::text, subproject.id,
      subproject.responsible_user_id, employee.display_name, employee.is_active,
      project.project_no, project.title, subproject.title,
      left(subproject.summary, 300),
      subproject.planned_start_on::text, subproject.planned_end_on::text,
      NULL::text, 'planned'::text, NULL::bigint,
      subproject.planned_start_on,
      subproject.planned_start_on::timestamp AT TIME ZONE 'Asia/Shanghai'
    FROM development_project_items subproject
    JOIN development_projects project ON project.id = subproject.project_id
    LEFT JOIN users employee ON employee.id = subproject.responsible_user_id
    WHERE subproject.item_kind = 'subproject'
  ), filtered AS (
    SELECT * FROM task_rows
    WHERE period_date >= $1::date AND period_date < $2::date
      AND ($3::bigint IS NULL OR user_id = $3)
  )`;

function mapRow(row) {
  return {
    sourceType: row.source_type,
    sourceId: Number(row.source_id),
    userId: row.user_id == null ? null : Number(row.user_id),
    userName: row.user_name || null,
    userIsActive: row.user_is_active === true,
    projectNo: row.project_no || null,
    projectName: row.project_name || null,
    taskTitle: row.task_title,
    taskSummary: row.task_summary || '',
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end || null,
    actualCompleted: row.actual_completed || null,
    status: row.status,
    opportunityId: row.opportunity_id == null ? null : Number(row.opportunity_id)
  };
}

export function createTaskStatisticsRepository(queryTarget) {
  return {
    async listUsers() {
      const result = await queryTarget.query(`
        SELECT id, display_name, is_active FROM users
        ORDER BY display_name, id
      `);
      return result.rows.map((row) => ({
        id: Number(row.id), name: row.display_name, isActive: row.is_active === true
      }));
    },

    async getReport({ startDate, endDate, userId, page, pageSize }) {
      const baseParams = [startDate, endDate, userId];
      const [summary, detail] = await Promise.all([
        queryTarget.query(`${reportRows}
          SELECT count(*)::integer AS total,
            count(*) FILTER (WHERE status = 'completed')::integer AS completed,
            count(*) FILTER (WHERE status = 'cancelled')::integer AS cancelled,
            count(*) FILTER (WHERE source_type = 'development_subproject')::integer AS subprojects,
            count(*) FILTER (WHERE user_id IS NULL)::integer AS unassigned
          FROM filtered`, baseParams),
        queryTarget.query(`${reportRows}
          SELECT source_type, source_id, user_id, user_name, user_is_active,
            project_no, project_name, task_title, task_summary,
            planned_start, planned_end, actual_completed, status, opportunity_id
          FROM filtered
          ORDER BY sort_start DESC, source_type, source_id DESC
          LIMIT $4 OFFSET $5`, [...baseParams, pageSize, (page - 1) * pageSize])
      ]);
      return {
        summary: {
          total: Number(summary.rows[0].total),
          completed: Number(summary.rows[0].completed),
          cancelled: Number(summary.rows[0].cancelled),
          subprojects: Number(summary.rows[0].subprojects),
          unassigned: Number(summary.rows[0].unassigned)
        },
        rows: detail.rows.map(mapRow)
      };
    }
  };
}
