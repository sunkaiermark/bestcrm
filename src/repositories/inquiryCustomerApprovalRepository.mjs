function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapApprovalRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    inquiryId: Number(row.inquiry_id),
    customerId: Number(row.customer_id),
    customerName: row.customer_name || '',
    requestedBy: Number(row.requested_by),
    requesterDisplayName: row.requester_display_name || '',
    customerOwnerUserId: Number(row.customer_owner_user_id),
    customerOwnerDisplayName: row.customer_owner_display_name || '',
    reviewerUserId: Number(row.reviewer_user_id),
    reviewerDisplayName: row.reviewer_display_name || '',
    status: row.status,
    requestPayload: row.request_payload || {},
    decisionNote: row.decision_note || '',
    decidedBy: numberOrNull(row.decided_by),
    decidedByDisplayName: row.decided_by_display_name || '',
    decidedAt: row.decided_at || null,
    convertedOpportunityId: numberOrNull(row.converted_opportunity_id),
    convertedOpportunityNo: row.converted_opportunity_no || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const approvalSelect = `
  SELECT
    approval.*,
    customer.name AS customer_name,
    requester.display_name AS requester_display_name,
    customer_owner.display_name AS customer_owner_display_name,
    reviewer.display_name AS reviewer_display_name,
    decider.display_name AS decided_by_display_name,
    opportunity.opportunity_no AS converted_opportunity_no
  FROM inquiry_customer_approvals approval
  JOIN customers customer ON customer.id = approval.customer_id
  JOIN users requester ON requester.id = approval.requested_by
  JOIN users customer_owner ON customer_owner.id = approval.customer_owner_user_id
  JOIN users reviewer ON reviewer.id = approval.reviewer_user_id
  LEFT JOIN users decider ON decider.id = approval.decided_by
  LEFT JOIN opportunities opportunity ON opportunity.id = approval.converted_opportunity_id
`;

export function createInquiryCustomerApprovalRepository(queryTarget) {
  async function findById(id) {
    const result = await queryTarget.query(`
      ${approvalSelect}
      WHERE approval.id = $1
      LIMIT 1
    `, [id]);
    return mapApprovalRow(result.rows[0]);
  }

  return {
    findById,

    async findLatestByInquiry(inquiryId) {
      const result = await queryTarget.query(`
        ${approvalSelect}
        WHERE approval.inquiry_id = $1
        ORDER BY approval.created_at DESC, approval.id DESC
        LIMIT 1
      `, [inquiryId]);
      return mapApprovalRow(result.rows[0]);
    },

    async createPending(input) {
      const result = await queryTarget.query(`
        WITH updated_inquiry AS (
          UPDATE inquiries
          SET status = 'customer_approval_pending',
              assigned_user_id = $5,
              matched_customer_id = $2,
              matched_contact_id = $7,
              reviewed_by = $3,
              reviewed_at = now(),
              updated_at = now()
          WHERE id = $1
            AND status IN ('new', 'reviewing')
          RETURNING id
        ), inserted AS (
          INSERT INTO inquiry_customer_approvals (
            inquiry_id,
            customer_id,
            requested_by,
            customer_owner_user_id,
            reviewer_user_id,
            request_payload
          )
          SELECT id, $2, $3, $4, $5, $6::jsonb
          FROM updated_inquiry
          RETURNING id
        )
        SELECT id FROM inserted
      `, [
        input.inquiryId,
        input.customerId,
        input.requestedBy,
        input.customerOwnerUserId,
        input.reviewerUserId,
        JSON.stringify(input.requestPayload || {}),
        input.matchedContactId
      ]);
      return result.rows[0] ? findById(result.rows[0].id) : null;
    },

    async completeApproval(id, input) {
      const result = await queryTarget.query(`
        WITH request AS (
          SELECT approval.*
          FROM inquiry_customer_approvals approval
          JOIN inquiries inquiry ON inquiry.id = approval.inquiry_id
          WHERE approval.id = $1
            AND approval.status = 'pending'
            AND (approval.reviewer_user_id = $2 OR $17::boolean = true)
            AND approval.inquiry_id = $18
            AND inquiry.status = 'customer_approval_pending'
          FOR UPDATE OF approval, inquiry
        ), new_contact AS (
          INSERT INTO contacts (
            customer_id,
            name,
            title,
            phone,
            email,
            wechat,
            education_background,
            work_experience,
            key_achievements,
            notes
          )
          SELECT
            request.customer_id,
            $5,
            $6,
            $7,
            $8,
            '',
            '',
            '',
            '',
            $9
          FROM request
          WHERE $4::bigint IS NULL AND $5 <> ''
          RETURNING id
        ), opportunity AS (
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
          SELECT
            nextval('opportunity_no_seq')::text,
            $10,
            request.customer_id,
            COALESCE($4::bigint, (SELECT id FROM new_contact LIMIT 1)),
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            'draft',
            request.requested_by
          FROM request
          RETURNING *
        ), converted AS (
          UPDATE inquiries inquiry
          SET status = 'converted',
              matched_customer_id = opportunity.customer_id,
              matched_contact_id = opportunity.primary_contact_id,
              converted_opportunity_id = opportunity.id,
              assigned_user_id = request.requested_by,
              reviewed_by = $2,
              reviewed_at = now(),
              updated_at = now()
          FROM request, opportunity
          WHERE inquiry.id = request.inquiry_id
            AND inquiry.status = 'customer_approval_pending'
          RETURNING inquiry.id
        ), approved AS (
          UPDATE inquiry_customer_approvals approval
          SET status = 'approved',
              decision_note = $3,
              decided_by = $2,
              decided_at = now(),
              converted_opportunity_id = opportunity.id,
              updated_at = now()
          FROM opportunity, converted
          WHERE approval.id = $1 AND approval.status = 'pending'
          RETURNING approval.id
        )
        SELECT
          opportunity.id,
          opportunity.opportunity_no,
          opportunity.title,
          opportunity.customer_id,
          opportunity.primary_contact_id,
          opportunity.salesperson_id
        FROM opportunity, converted, approved
      `, [
        id,
        input.decidedBy,
        input.decisionNote || '',
        input.primaryContactId,
        input.newContactName || '',
        input.newContactTitle || '',
        input.newContactPhone || '',
        input.newContactEmail || '',
        input.newContactNotes || '',
        input.title,
        input.requirement,
        input.estimatedAmount,
        input.productInterest || '',
        input.projectType || '',
        input.deliveryCycle || '',
        input.expectedBidDate,
        input.allowAnyReviewer || false,
        input.inquiryId
      ]);
      const row = result.rows[0];
      return row ? {
        id: Number(row.id),
        opportunityNo: row.opportunity_no,
        title: row.title,
        customerId: Number(row.customer_id),
        primaryContactId: numberOrNull(row.primary_contact_id),
        salespersonId: Number(row.salesperson_id)
      } : null;
    },

    async rejectAndReturnInquiry(id, input) {
      const result = await queryTarget.query(`
        WITH request AS (
          SELECT
            approval.id,
            approval.inquiry_id,
            approval.requested_by
          FROM inquiry_customer_approvals approval
          JOIN inquiries inquiry ON inquiry.id = approval.inquiry_id
          WHERE approval.id = $1
            AND approval.status = 'pending'
            AND (approval.reviewer_user_id = $2 OR $4::boolean = true)
            AND approval.inquiry_id = $5
            AND inquiry.status = 'customer_approval_pending'
          FOR UPDATE OF approval, inquiry
        ), rejected AS (
          UPDATE inquiry_customer_approvals approval
          SET status = 'rejected',
              decision_note = $3,
              decided_by = $2,
              decided_at = now(),
              updated_at = now()
          FROM request
          WHERE approval.id = request.id
          RETURNING request.inquiry_id, request.requested_by
        ), returned AS (
          UPDATE inquiries inquiry
          SET status = 'reviewing',
              assigned_user_id = rejected.requested_by,
              matched_customer_id = NULL,
              matched_contact_id = NULL,
              review_note = $3,
              reviewed_by = $2,
              reviewed_at = now(),
              updated_at = now()
          FROM rejected
          WHERE inquiry.id = rejected.inquiry_id
            AND inquiry.status = 'customer_approval_pending'
          RETURNING inquiry.id
        )
        SELECT id FROM returned
      `, [
        id,
        input.decidedBy,
        input.decisionNote || '',
        input.allowAnyReviewer || false,
        input.inquiryId
      ]);
      return result.rowCount > 0;
    }
  };
}
