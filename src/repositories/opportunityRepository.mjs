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
    primaryContactId: numberOrNull(row.primary_contact_id),
    requirement: row.requirement,
    estimatedAmount: numberOrNull(row.estimated_amount),
    projectType: row.project_type,
    deliveryCycle: row.delivery_cycle,
    expectedBidDate: row.expected_bid_date,
    status: row.status,
    salespersonId: Number(row.salesperson_id),
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

export function createOpportunityRepository(queryTarget) {
  return {
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
          project_type,
          delivery_cycle,
          expected_bid_date,
          status,
          salesperson_id,
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
