function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function textOrEmpty(value) {
  return value || '';
}

function mapSalesWorkPlanRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    salespersonUserId: Number(row.salesperson_user_id),
    salespersonDisplayName: textOrEmpty(row.salesperson_display_name),
    planDate: row.plan_date,
    customerId: numberOrNull(row.customer_id),
    customerName: textOrEmpty(row.customer_name),
    contactId: numberOrNull(row.contact_id),
    contactName: textOrEmpty(row.contact_name),
    opportunityId: numberOrNull(row.opportunity_id),
    opportunityNo: textOrEmpty(row.opportunity_no),
    opportunityTitle: textOrEmpty(row.opportunity_title),
    activityType: row.activity_type,
    subject: row.subject,
    objective: textOrEmpty(row.objective),
    plannedAction: textOrEmpty(row.planned_action),
    status: row.status,
    resultSummary: textOrEmpty(row.result_summary),
    nextStep: textOrEmpty(row.next_step),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSalesWorkLogRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    salespersonUserId: Number(row.salesperson_user_id),
    salespersonDisplayName: textOrEmpty(row.salesperson_display_name),
    logDate: row.log_date,
    customerId: numberOrNull(row.customer_id),
    customerName: textOrEmpty(row.customer_name),
    contactId: numberOrNull(row.contact_id),
    contactName: textOrEmpty(row.contact_name),
    opportunityId: numberOrNull(row.opportunity_id),
    opportunityNo: textOrEmpty(row.opportunity_no),
    opportunityTitle: textOrEmpty(row.opportunity_title),
    activityType: row.activity_type,
    subject: row.subject,
    content: row.content,
    customerFeedback: textOrEmpty(row.customer_feedback),
    result: textOrEmpty(row.result),
    nextStep: textOrEmpty(row.next_step),
    nextPlanDate: row.next_plan_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSalesWorkReportRow(row) {
  return {
    salespersonUserId: Number(row.salesperson_user_id),
    salespersonDisplayName: textOrEmpty(row.salesperson_display_name),
    totalPlans: Number(row.total_plans || 0),
    completedPlans: Number(row.completed_plans || 0),
    cancelledPlans: Number(row.cancelled_plans || 0),
    overduePlans: Number(row.overdue_plans || 0),
    totalLogs: Number(row.total_logs || 0),
    linkedCustomers: Number(row.linked_customers || 0),
    linkedOpportunities: Number(row.linked_opportunities || 0)
  };
}

function addFilter(where, params, sql, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  params.push(value);
  where.push(sql.replace('?', `$${params.length}`));
}

function buildPlanFilters(filter, params = []) {
  const where = [];
  addFilter(where, params, 'swp.salesperson_user_id = ?', filter.salespersonUserId);
  addFilter(where, params, 'swp.plan_date >= ?', filter.dateFrom);
  addFilter(where, params, 'swp.plan_date <= ?', filter.dateTo);
  addFilter(where, params, 'swp.status = ?', filter.status);
  addFilter(where, params, 'swp.customer_id = ?', filter.customerId);
  addFilter(where, params, 'swp.contact_id = ?', filter.contactId);
  addFilter(where, params, 'swp.opportunity_id = ?', filter.opportunityId);
  addFilter(where, params, 'swp.activity_type = ?', filter.activityType);
  return where;
}

function buildLogFilters(filter, params = []) {
  const where = [];
  addFilter(where, params, 'swl.salesperson_user_id = ?', filter.salespersonUserId);
  addFilter(where, params, 'swl.log_date >= ?', filter.dateFrom);
  addFilter(where, params, 'swl.log_date <= ?', filter.dateTo);
  addFilter(where, params, 'swl.customer_id = ?', filter.customerId);
  addFilter(where, params, 'swl.contact_id = ?', filter.contactId);
  addFilter(where, params, 'swl.opportunity_id = ?', filter.opportunityId);
  addFilter(where, params, 'swl.activity_type = ?', filter.activityType);
  return where;
}

function reportWhere(alias, dateColumn, filter, paramIndexes) {
  const where = [];
  if (paramIndexes.dateFrom) {
    where.push(`${alias}.${dateColumn} >= $${paramIndexes.dateFrom}`);
  }
  if (paramIndexes.dateTo) {
    where.push(`${alias}.${dateColumn} <= $${paramIndexes.dateTo}`);
  }
  if (paramIndexes.salespersonUserId) {
    where.push(`${alias}.salesperson_user_id = $${paramIndexes.salespersonUserId}`);
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

function reportParamIndexes(filter, params) {
  const indexes = {};
  if (filter.dateFrom) {
    params.push(filter.dateFrom);
    indexes.dateFrom = params.length;
  }
  if (filter.dateTo) {
    params.push(filter.dateTo);
    indexes.dateTo = params.length;
  }
  if (filter.salespersonUserId) {
    params.push(filter.salespersonUserId);
    indexes.salespersonUserId = params.length;
  }
  return indexes;
}

export function createSalesWorkRepository(queryTarget) {
  return {
    async createPlan(input) {
      const result = await queryTarget.query(`
        INSERT INTO sales_work_plans (
          salesperson_user_id,
          plan_date,
          customer_id,
          contact_id,
          opportunity_id,
          activity_type,
          subject,
          objective,
          planned_action,
          next_step
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `, [
        input.salespersonUserId,
        input.planDate,
        input.customerId || null,
        input.contactId || null,
        input.opportunityId || null,
        input.activityType,
        input.subject,
        input.objective || '',
        input.plannedAction || '',
        input.nextStep || ''
      ]);
      return mapSalesWorkPlanRow({
        ...result.rows[0],
        salesperson_user_id: input.salespersonUserId,
        plan_date: input.planDate,
        customer_id: input.customerId || null,
        contact_id: input.contactId || null,
        opportunity_id: input.opportunityId || null,
        activity_type: input.activityType,
        subject: input.subject,
        objective: input.objective || '',
        planned_action: input.plannedAction || '',
        status: result.rows[0].status || 'planned',
        result_summary: result.rows[0].result_summary || '',
        next_step: input.nextStep || ''
      });
    },

    async listPlans(filter = {}) {
      const params = [];
      const where = buildPlanFilters(filter, params);
      const result = await queryTarget.query(`
        SELECT
          swp.*,
          salesperson.display_name AS salesperson_display_name,
          c.name AS customer_name,
          ct.name AS contact_name,
          o.opportunity_no,
          o.title AS opportunity_title
        FROM sales_work_plans swp
        JOIN users salesperson ON salesperson.id = swp.salesperson_user_id
        LEFT JOIN customers c ON c.id = swp.customer_id
        LEFT JOIN contacts ct ON ct.id = swp.contact_id
        LEFT JOIN opportunities o ON o.id = swp.opportunity_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY swp.plan_date DESC, swp.id DESC
      `, params);
      return result.rows.map(mapSalesWorkPlanRow);
    },

    async updatePlanStatus(id, input) {
      const result = await queryTarget.query(`
        UPDATE sales_work_plans
        SET
          status = $1,
          result_summary = $2,
          next_step = $3,
          updated_at = now()
        WHERE id = $4
        RETURNING *
      `, [
        input.status,
        input.resultSummary || '',
        input.nextStep || '',
        id
      ]);
      return mapSalesWorkPlanRow(result.rows[0]);
    },

    async createLog(input) {
      const result = await queryTarget.query(`
        INSERT INTO sales_work_logs (
          salesperson_user_id,
          log_date,
          customer_id,
          contact_id,
          opportunity_id,
          activity_type,
          subject,
          content,
          customer_feedback,
          result,
          next_step,
          next_plan_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        input.salespersonUserId,
        input.logDate,
        input.customerId || null,
        input.contactId || null,
        input.opportunityId || null,
        input.activityType,
        input.subject,
        input.content,
        input.customerFeedback || '',
        input.result || '',
        input.nextStep || '',
        input.nextPlanDate || null
      ]);
      return mapSalesWorkLogRow({
        ...result.rows[0],
        salesperson_user_id: input.salespersonUserId,
        log_date: input.logDate,
        customer_id: input.customerId || null,
        contact_id: input.contactId || null,
        opportunity_id: input.opportunityId || null,
        activity_type: input.activityType,
        subject: input.subject,
        content: input.content,
        customer_feedback: input.customerFeedback || '',
        result: input.result || '',
        next_step: input.nextStep || '',
        next_plan_date: input.nextPlanDate || null
      });
    },

    async listLogs(filter = {}) {
      const params = [];
      const where = buildLogFilters(filter, params);
      const result = await queryTarget.query(`
        SELECT
          swl.*,
          salesperson.display_name AS salesperson_display_name,
          c.name AS customer_name,
          ct.name AS contact_name,
          o.opportunity_no,
          o.title AS opportunity_title
        FROM sales_work_logs swl
        JOIN users salesperson ON salesperson.id = swl.salesperson_user_id
        LEFT JOIN customers c ON c.id = swl.customer_id
        LEFT JOIN contacts ct ON ct.id = swl.contact_id
        LEFT JOIN opportunities o ON o.id = swl.opportunity_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY swl.log_date DESC, swl.id DESC
      `, params);
      return result.rows.map(mapSalesWorkLogRow);
    },

    async summarizeSalesWork(filter = {}) {
      const params = [];
      const paramIndexes = reportParamIndexes(filter, params);
      const planWhere = reportWhere('swp', 'plan_date', filter, paramIndexes);
      const logWhere = reportWhere('swl', 'log_date', filter, paramIndexes);
      const result = await queryTarget.query(`
        WITH plan_summary AS (
          SELECT
            salesperson_user_id,
            count(*) AS total_plans,
            count(*) FILTER (WHERE status = 'completed') AS completed_plans,
            count(*) FILTER (WHERE status = 'cancelled') AS cancelled_plans,
            count(*) FILTER (WHERE status = 'planned' AND plan_date < current_date) AS overdue_plans
          FROM sales_work_plans swp
          ${planWhere}
          GROUP BY salesperson_user_id
        ),
        log_summary AS (
          SELECT
            salesperson_user_id,
            count(*) AS total_logs,
            count(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL) AS linked_customers,
            count(DISTINCT opportunity_id) FILTER (WHERE opportunity_id IS NOT NULL) AS linked_opportunities
          FROM sales_work_logs swl
          ${logWhere}
          GROUP BY salesperson_user_id
        )
        SELECT
          COALESCE(ps.salesperson_user_id, ls.salesperson_user_id) AS salesperson_user_id,
          salesperson.display_name AS salesperson_display_name,
          COALESCE(ps.total_plans, 0) AS total_plans,
          COALESCE(ps.completed_plans, 0) AS completed_plans,
          COALESCE(ps.cancelled_plans, 0) AS cancelled_plans,
          COALESCE(ps.overdue_plans, 0) AS overdue_plans,
          COALESCE(ls.total_logs, 0) AS total_logs,
          COALESCE(ls.linked_customers, 0) AS linked_customers,
          COALESCE(ls.linked_opportunities, 0) AS linked_opportunities
        FROM plan_summary ps
        FULL OUTER JOIN log_summary ls ON ls.salesperson_user_id = ps.salesperson_user_id
        JOIN users salesperson ON salesperson.id = COALESCE(ps.salesperson_user_id, ls.salesperson_user_id)
        ORDER BY salesperson.display_name ASC
      `, params);
      return result.rows.map(mapSalesWorkReportRow);
    }
  };
}
