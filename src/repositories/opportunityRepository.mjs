import { ARCHIVED_STATUSES } from '../domain/statuses.mjs';

function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function mapOpportunityRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityNo: row.opportunity_no,
    title: row.title,
    customerId: Number(row.customer_id),
    customerName: row.customer_name || '',
    primaryContactId: numberOrNull(row.primary_contact_id),
    primaryContactName: row.primary_contact_name || '',
    requirement: row.requirement,
    estimatedAmount: numberOrNull(row.estimated_amount),
    productInterest: row.product_interest || '',
    projectType: row.project_type,
    deliveryCycle: row.delivery_cycle,
    expectedBidDate: row.expected_bid_date,
    status: row.status,
    salespersonId: Number(row.salesperson_id),
    salespersonUsername: row.salesperson_username || '',
    salespersonDisplayName: row.salesperson_display_name || '',
    salesManagerId: numberOrNull(row.sales_manager_id),
    quotationEngineerId: numberOrNull(row.quotation_engineer_id),
    technicalManagerId: numberOrNull(row.technical_manager_id),
    commercialManagerId: numberOrNull(row.commercial_manager_id),
    finalDealAmount: numberOrNull(row.final_deal_amount),
    lostReason: row.lost_reason,
    wonDescription: row.won_description,
    archivedAt: row.archived_at
  };
}

const opportunitySelect = `
  SELECT
    o.id,
    o.opportunity_no,
    o.title,
    o.customer_id,
    c.name AS customer_name,
    o.primary_contact_id,
    pc.name AS primary_contact_name,
    o.requirement,
    o.estimated_amount,
    o.product_interest,
    o.project_type,
    o.delivery_cycle,
    o.expected_bid_date,
    o.status,
    o.salesperson_id,
    salesperson.username AS salesperson_username,
    salesperson.display_name AS salesperson_display_name,
    o.sales_manager_id,
    o.quotation_engineer_id,
    o.technical_manager_id,
    o.commercial_manager_id,
    o.final_deal_amount,
    o.lost_reason,
    o.won_description,
    o.archived_at
  FROM opportunities o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN contacts pc ON pc.id = o.primary_contact_id
  JOIN users salesperson ON salesperson.id = o.salesperson_id
`;

const workflowFieldColumns = new Map([
  ['status', 'status'],
  ['salesManagerId', 'sales_manager_id'],
  ['quotationEngineerId', 'quotation_engineer_id'],
  ['technicalManagerId', 'technical_manager_id'],
  ['commercialManagerId', 'commercial_manager_id'],
  ['finalDealAmount', 'final_deal_amount'],
  ['lostReason', 'lost_reason'],
  ['wonDescription', 'won_description'],
  ['archivedAt', 'archived_at']
]);

function visibleOpportunityPredicate(userParam) {
  return `(
    o.salesperson_id = ${userParam}
    OR o.sales_manager_id = ${userParam}
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

function statusPlaceholders(params, statuses) {
  return statuses.map((status) => {
    params.push(status);
    return `$${params.length}`;
  }).join(', ');
}

function addArchiveScopeFilter(where, params, filter) {
  if (filter.archiveScope === 'all') {
    return;
  }
  if (filter.archiveScope === 'archived') {
    where.push(`o.status IN (${statusPlaceholders(params, ARCHIVED_STATUSES)})`);
    return;
  }
  if (!filter.status) {
    where.push(`o.status NOT IN (${statusPlaceholders(params, ARCHIVED_STATUSES)})`);
  }
}

function opportunityListConditions(filter = {}) {
  const where = [];
  const params = [];
  if (filter.salespersonId) {
    params.push(filter.salespersonId);
    where.push(`o.salesperson_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`o.status = $${params.length}`);
  }
  if (filter.customerId) {
    params.push(filter.customerId);
    where.push(`o.customer_id = $${params.length}`);
  }
  if (filter.contactId) {
    params.push(filter.contactId);
    where.push(`o.primary_contact_id = $${params.length}`);
  }
  if (filter.visibleToUserId) {
    params.push(filter.visibleToUserId);
    where.push(visibleOpportunityPredicate(`$${params.length}`));
  }
  if (filter.searchTerm) {
    params.push(`%${String(filter.searchTerm).replace(/[\\%_]/g, '\\$&')}%`);
    const searchParam = `$${params.length}`;
    where.push(`(
      o.opportunity_no ILIKE ${searchParam} ESCAPE '\\'
      OR o.title ILIKE ${searchParam} ESCAPE '\\'
      OR c.name ILIKE ${searchParam} ESCAPE '\\'
      OR salesperson.username ILIKE ${searchParam} ESCAPE '\\'
      OR salesperson.display_name ILIKE ${searchParam} ESCAPE '\\'
      OR pc.name ILIKE ${searchParam} ESCAPE '\\'
    )`);
  }
  addArchiveScopeFilter(where, params, filter);
  return { where, params };
}

function mapOpportunityFilterOptions(rows) {
  const salespeopleById = new Map();
  const customersById = new Map();
  const contactsById = new Map();
  for (const row of rows) {
    const salespersonId = Number(row.salesperson_id);
    if (!salespeopleById.has(salespersonId)) {
      salespeopleById.set(salespersonId, {
        id: salespersonId,
        username: row.salesperson_username || '',
        displayName: row.salesperson_display_name || ''
      });
    }
    const customerId = Number(row.customer_id);
    if (!customersById.has(customerId)) {
      customersById.set(customerId, {
        id: customerId,
        name: row.customer_name || ''
      });
    }
    if (row.primary_contact_id) {
      const contactId = Number(row.primary_contact_id);
      if (!contactsById.has(contactId)) {
        contactsById.set(contactId, {
          id: contactId,
          name: row.primary_contact_name || '',
          customerId,
          customerName: row.customer_name || ''
        });
      }
    }
  }
  const label = (item) => item.displayName || item.username || item.name || '';
  const compare = (left, right) => label(left).localeCompare(label(right), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
  return {
    salespeople: [...salespeopleById.values()].sort(compare),
    customers: [...customersById.values()].sort(compare),
    contacts: [...contactsById.values()].sort(compare)
  };
}

export function createOpportunityRepository(queryTarget) {
  return {
    async listOpportunities(filter = {}) {
      const { where, params } = opportunityListConditions(filter);
      const result = await queryTarget.query(`
        ${opportunitySelect}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY o.created_at DESC, o.id DESC
      `, params);
      return result.rows.map(mapOpportunityRow);
    },

    async listOpportunityFilterOptions(filter = {}) {
      const { where, params } = opportunityListConditions(filter);
      const result = await queryTarget.query(`
        SELECT DISTINCT
          o.salesperson_id,
          salesperson.username AS salesperson_username,
          salesperson.display_name AS salesperson_display_name,
          o.customer_id,
          c.name AS customer_name,
          o.primary_contact_id,
          pc.name AS primary_contact_name
        FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN contacts pc ON pc.id = o.primary_contact_id
        JOIN users salesperson ON salesperson.id = o.salesperson_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      `, params);
      return mapOpportunityFilterOptions(result.rows);
    },

    async getOpportunityDetail(id) {
      const result = await queryTarget.query(`
        ${opportunitySelect}
        WHERE o.id = $1
        LIMIT 1
      `, [id]);
      return mapOpportunityRow(result.rows[0]);
    },

    async createOpportunity(input) {
      const result = await queryTarget.query(`
        INSERT INTO opportunities (
          opportunity_no,
          title,
          customer_id,
          primary_contact_id,
          requirement,
          estimated_amount,
          product_interest,
          project_type,
          delivery_cycle,
          expected_bid_date,
          status,
          salesperson_id
        )
        VALUES (COALESCE($1, nextval('opportunity_no_seq')::text), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        input.opportunityNo,
        input.title,
        input.customerId,
        input.primaryContactId,
        input.requirement,
        input.estimatedAmount,
        input.productInterest,
        input.projectType,
        input.deliveryCycle,
        input.expectedBidDate,
        input.status,
        input.salespersonId
      ]);
      return mapOpportunityRow(result.rows[0]);
    },

    async updateOpportunity(id, input) {
      const result = await queryTarget.query(`
        UPDATE opportunities
        SET
          title = $1,
          customer_id = $2,
          primary_contact_id = $3,
          requirement = $4,
          estimated_amount = $5,
          product_interest = $6,
          project_type = $7,
          delivery_cycle = $8,
          expected_bid_date = $9,
          updated_at = now()
        WHERE id = $10
        RETURNING *
      `, [
        input.title,
        input.customerId,
        input.primaryContactId,
        input.requirement,
        input.estimatedAmount,
        input.productInterest,
        input.projectType,
        input.deliveryCycle,
        input.expectedBidDate,
        id
      ]);
      return mapOpportunityRow(result.rows[0]);
    },

    async deleteById(id) {
      return queryTarget.query('DELETE FROM opportunities WHERE id = $1', [id]);
    },

    async findById(id) {
      const result = await queryTarget.query(`
        SELECT
          id,
          opportunity_no,
          title,
          customer_id,
          primary_contact_id,
          requirement,
          estimated_amount,
          product_interest,
          project_type,
          delivery_cycle,
          expected_bid_date,
          status,
          salesperson_id,
          '' AS salesperson_username,
          '' AS salesperson_display_name,
          sales_manager_id,
          quotation_engineer_id,
          technical_manager_id,
          commercial_manager_id,
          final_deal_amount,
          lost_reason,
          won_description,
          archived_at
        FROM opportunities
        WHERE id = $1
        LIMIT 1
      `, [id]);
      return mapOpportunityRow(result.rows[0]);
    },

    async updateWorkflowState(id, changes) {
      const assignments = [];
      const params = [];

      for (const [field, column] of workflowFieldColumns.entries()) {
        if (Object.hasOwn(changes, field)) {
          params.push(changes[field]);
          assignments.push(`${column} = $${params.length}`);
        }
      }

      if (assignments.length === 0) {
        throw new Error('No workflow fields to update');
      }

      params.push(id);
      const result = await queryTarget.query(`
        UPDATE opportunities
        SET ${assignments.join(', ')}, updated_at = now()
        WHERE id = $${params.length}
        RETURNING *
      `, params);
      return mapOpportunityRow(result.rows[0]);
    }
  };
}
