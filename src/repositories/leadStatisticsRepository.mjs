function numberOrZero(value) {
  return Number(value || 0);
}

function mapRow(row) {
  return {
    sourceChannel: row.source_channel || 'other',
    sourceOwnerUserId: row.source_owner_user_id == null ? null : Number(row.source_owner_user_id),
    sourceOwnerName: row.source_owner_name || row.source_owner_label || '',
    leadCount: numberOrZero(row.lead_count),
    opportunityCount: numberOrZero(row.opportunity_count),
    winRecordedCount: numberOrZero(row.win_recorded_count),
    signedOrderCount: numberOrZero(row.signed_order_count)
  };
}

function mapDetailRow(row) {
  return {
    inquiryId: Number(row.inquiry_id),
    submissionType: row.submission_type || 'standard',
    createdAt: row.created_at,
    companyName: row.company_name || '',
    subject: row.subject || '',
    productInterest: row.product_interest || '',
    sourceChannel: row.source_channel || 'other',
    sourceOwnerName: row.source_owner_name || row.source_owner_label || '',
    salesOwnerName: row.sales_owner_name || '',
    lifecycleState: row.lead_lifecycle_state || 'active',
    nextFollowUpOn: row.lead_next_follow_up_on || null,
    status: row.status || '',
    opportunityId: row.opportunity_id == null ? null : Number(row.opportunity_id),
    opportunityNo: row.opportunity_no || '',
    signedOrder: row.signed_order_id != null
  };
}

const reportRows = `
  WITH filtered AS (
    SELECT inquiry.id,
      inquiry.submission_type,
      inquiry.created_at,
      inquiry.company_name,
      inquiry.subject,
      inquiry.product_interest,
      inquiry.lead_lifecycle_state,
      inquiry.lead_next_follow_up_on,
      inquiry.status,
      COALESCE(NULLIF(inquiry.source_attribution_channel, ''), inquiry.source_channel, inquiry.source, 'other') AS source_channel,
      inquiry.source_attribution_owner_user_id AS source_owner_user_id,
      source_owner.display_name AS source_owner_name,
      inquiry.source_attribution_owner_label AS source_owner_label,
      COALESCE(opportunity.salesperson_id, inquiry.recommended_salesperson_id) AS sales_owner_user_id,
      sales_owner.display_name AS sales_owner_name,
      opportunity.id AS opportunity_id,
      opportunity.opportunity_no AS opportunity_no,
      opportunity.status AS opportunity_status,
      execution.id AS signed_order_id
    FROM inquiries inquiry
    LEFT JOIN users source_owner ON source_owner.id = inquiry.source_attribution_owner_user_id
    LEFT JOIN opportunities opportunity ON opportunity.id = inquiry.converted_opportunity_id
      AND opportunity.deleted_at IS NULL
    LEFT JOIN users sales_owner ON sales_owner.id = COALESCE(opportunity.salesperson_id, inquiry.recommended_salesperson_id)
    LEFT JOIN project_executions execution ON execution.opportunity_id = opportunity.id
    WHERE inquiry.created_at >= $1::date
      AND inquiry.created_at < $2::date
      AND ($3::text IS NULL OR COALESCE(NULLIF(inquiry.source_attribution_channel, ''), inquiry.source_channel, inquiry.source, 'other') = $3)
      AND ($4::bigint IS NULL OR inquiry.source_attribution_owner_user_id = $4)
      AND ($5::bigint IS NULL OR COALESCE(opportunity.salesperson_id, inquiry.recommended_salesperson_id) = $5)
  )`;

export function createLeadStatisticsRepository(queryTarget) {
  return {
    async listAttributionOwners() {
      const result = await queryTarget.query(`
        SELECT DISTINCT owner.id, owner.display_name, owner.is_active
        FROM inquiries inquiry
        JOIN users owner ON owner.id = inquiry.source_attribution_owner_user_id
        ORDER BY owner.display_name, owner.id
      `);
      return result.rows.map((row) => ({
        id: Number(row.id), name: row.display_name, isActive: row.is_active === true
      }));
    },

    async listSalesOwners() {
      const result = await queryTarget.query(`
        SELECT DISTINCT owner.id, owner.display_name, owner.is_active
        FROM inquiries inquiry
        LEFT JOIN opportunities opportunity ON opportunity.id = inquiry.converted_opportunity_id
          AND opportunity.deleted_at IS NULL
        JOIN users owner ON owner.id = COALESCE(opportunity.salesperson_id, inquiry.recommended_salesperson_id)
        ORDER BY owner.display_name, owner.id
      `);
      return result.rows.map((row) => ({
        id: Number(row.id), name: row.display_name, isActive: row.is_active === true
      }));
    },

    async getReport({ startOn, endDateExclusive, sourceChannel, attributionOwnerUserId,
      salesOwnerUserId, page, pageSize }) {
      const params = [startOn, endDateExclusive, sourceChannel, attributionOwnerUserId, salesOwnerUserId];
      const [summaryResult, groupsResult, detailResult] = await Promise.all([
        queryTarget.query(`${reportRows}
          SELECT count(*)::integer AS lead_count,
            count(*) FILTER (WHERE opportunity_id IS NOT NULL)::integer AS opportunity_count,
            count(*) FILTER (WHERE opportunity_status IN ('won_contract_pending', 'contract_approval_in_progress', 'contract_archived'))::integer AS win_recorded_count,
            count(*) FILTER (WHERE signed_order_id IS NOT NULL)::integer AS signed_order_count
          FROM filtered`, params),
        queryTarget.query(`${reportRows}
          SELECT source_channel, source_owner_user_id, source_owner_name, source_owner_label,
            count(*)::integer AS lead_count,
            count(*) FILTER (WHERE opportunity_id IS NOT NULL)::integer AS opportunity_count,
            count(*) FILTER (WHERE opportunity_status IN ('won_contract_pending', 'contract_approval_in_progress', 'contract_archived'))::integer AS win_recorded_count,
            count(*) FILTER (WHERE signed_order_id IS NOT NULL)::integer AS signed_order_count
          FROM filtered
          GROUP BY source_channel, source_owner_user_id, source_owner_name, source_owner_label
          ORDER BY signed_order_count DESC, opportunity_count DESC, lead_count DESC,
            source_channel, source_owner_name NULLS LAST, source_owner_label NULLS LAST`, params),
        queryTarget.query(`${reportRows}
          SELECT id AS inquiry_id, submission_type, created_at, company_name, subject, product_interest,
            source_channel, source_owner_name, source_owner_label, sales_owner_name,
            lead_lifecycle_state, lead_next_follow_up_on, status,
            opportunity_id, opportunity_no, signed_order_id
          FROM filtered
          ORDER BY created_at DESC, inquiry_id DESC
          LIMIT $6 OFFSET $7`, [...params, pageSize, (page - 1) * pageSize])
      ]);
      const summary = summaryResult.rows[0] || {};
      return {
        summary: {
          leadCount: numberOrZero(summary.lead_count),
          opportunityCount: numberOrZero(summary.opportunity_count),
          winRecordedCount: numberOrZero(summary.win_recorded_count),
          signedOrderCount: numberOrZero(summary.signed_order_count)
        },
        groups: groupsResult.rows.map(mapRow),
        details: detailResult.rows.map(mapDetailRow)
      };
    }
  };
}
