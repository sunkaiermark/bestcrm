function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapProjectExecutionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    opportunityNo: row.opportunity_no || '',
    opportunityTitle: row.opportunity_title || '',
    customerName: row.customer_name || '',
    contractSignedOn: row.contract_signed_on,
    status: row.status,
    confirmedByUserId: Number(row.confirmed_by_user_id),
    confirmedByDisplayName: row.confirmed_by_display_name || '',
    salespersonId: numberOrNull(row.salesperson_id),
    salesManagerId: numberOrNull(row.sales_manager_id),
    quotationEngineerId: numberOrNull(row.quotation_engineer_id),
    technicalManagerId: numberOrNull(row.technical_manager_id),
    commercialManagerId: numberOrNull(row.commercial_manager_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const projectExecutionSelect = `
  SELECT
    pe.*,
    o.opportunity_no,
    o.title AS opportunity_title,
    o.salesperson_id,
    o.sales_manager_id,
    o.quotation_engineer_id,
    o.technical_manager_id,
    o.commercial_manager_id,
    c.name AS customer_name,
    confirmer.display_name AS confirmed_by_display_name
  FROM project_executions pe
  JOIN opportunities o ON o.id = pe.opportunity_id
  JOIN customers c ON c.id = o.customer_id
  JOIN users confirmer ON confirmer.id = pe.confirmed_by_user_id
`;

export function createProjectExecutionRepository(queryTarget) {
  async function findByOpportunity(opportunityId) {
    const result = await queryTarget.query(`
      ${projectExecutionSelect}
      WHERE pe.opportunity_id = $1
      LIMIT 1
    `, [Number(opportunityId)]);
    return mapProjectExecutionRow(result.rows[0]);
  }

  return {
    async findById(id) {
      const result = await queryTarget.query(`
        ${projectExecutionSelect}
        WHERE pe.id = $1
        LIMIT 1
      `, [Number(id)]);
      return mapProjectExecutionRow(result.rows[0]);
    },

    findByOpportunity,

    async createForOpportunity(input) {
      const inserted = await queryTarget.query(`
        INSERT INTO project_executions (
          opportunity_id,
          contract_signed_on,
          confirmed_by_user_id
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (opportunity_id) DO NOTHING
        RETURNING id
      `, [
        Number(input.opportunityId),
        input.contractSignedOn,
        Number(input.confirmedByUserId)
      ]);

      const projectExecution = await findByOpportunity(input.opportunityId);
      return {
        projectExecution,
        created: inserted.rowCount > 0
      };
    }
  };
}
