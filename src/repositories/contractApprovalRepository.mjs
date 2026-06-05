function mapContractApprovalRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    versionNo: Number(row.version_no),
    currentStep: Number(row.current_step),
    status: row.status,
    submittedBy: Number(row.submitted_by),
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    stepId: Number(row.step_id),
    reviewerUserId: Number(row.reviewer_user_id),
    reviewerDisplayName: row.reviewer_display_name || '',
    stepAction: row.step_action,
    stepComment: row.step_comment,
    actedAt: row.acted_at
  };
}

const contractApprovalSelect = `
  SELECT
    ca.id,
    ca.opportunity_id,
    ca.version_no,
    ca.current_step,
    ca.status,
    ca.submitted_by,
    ca.submitted_at,
    ca.completed_at,
    cas.id AS step_id,
    cas.reviewer_user_id,
    reviewer.display_name AS reviewer_display_name,
    cas.action AS step_action,
    cas.comment AS step_comment,
    cas.acted_at
  FROM contract_approvals ca
  JOIN contract_approval_steps cas ON cas.contract_approval_id = ca.id
  JOIN users reviewer ON reviewer.id = cas.reviewer_user_id
`;

export function createContractApprovalRepository(queryTarget) {
  return {
    async createApproval(input) {
      const approvalResult = await queryTarget.query(`
        INSERT INTO contract_approvals (
          opportunity_id,
          version_no,
          status,
          submitted_by
        )
        SELECT
          $1,
          COALESCE(MAX(version_no), 0) + 1,
          $2,
          $3
        FROM contract_approvals
        WHERE opportunity_id = $1
        RETURNING id, version_no, submitted_at
      `, [
        input.opportunityId,
        'pending',
        input.submittedBy
      ]);
      const approvalId = Number(approvalResult.rows[0].id);
      await queryTarget.query(`
        INSERT INTO contract_approval_steps (
          contract_approval_id,
          step_order,
          role_code,
          reviewer_user_id
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        approvalId,
        1,
        'legal_reviewer',
        input.reviewerUserId
      ]);
      return {
        id: approvalId,
        opportunityId: input.opportunityId,
        versionNo: Number(approvalResult.rows[0].version_no),
        currentStep: 1,
        status: 'pending',
        submittedBy: input.submittedBy,
        submittedAt: approvalResult.rows[0].submitted_at,
        completedAt: null,
        reviewerUserId: input.reviewerUserId
      };
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${contractApprovalSelect}
        WHERE ca.opportunity_id = $1
        ORDER BY ca.submitted_at DESC, ca.id DESC, cas.step_order ASC
      `, [opportunityId]);
      return result.rows.map(mapContractApprovalRow);
    },

    async findActiveByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${contractApprovalSelect}
        WHERE ca.opportunity_id = $1
          AND ca.status = 'pending'
          AND cas.action = 'pending'
        ORDER BY ca.submitted_at DESC, ca.id DESC
        LIMIT 1
      `, [opportunityId]);
      return mapContractApprovalRow(result.rows[0]);
    },

    async approveActive(input) {
      await updateStep(queryTarget, input.stepId, 'approved', input.comment);
      await closeApproval(queryTarget, input.approvalId, 'approved');
    },

    async rejectActive(input) {
      await updateStep(queryTarget, input.stepId, 'rejected', input.comment);
      await closeApproval(queryTarget, input.approvalId, 'rejected');
    }
  };
}

async function updateStep(queryTarget, stepId, action, comment) {
  await queryTarget.query(`
    UPDATE contract_approval_steps
    SET action = $1,
        comment = $2,
        acted_at = now()
    WHERE id = $3
  `, [action, comment || null, stepId]);
}

async function closeApproval(queryTarget, approvalId, status) {
  await queryTarget.query(`
    UPDATE contract_approvals
    SET status = $1,
        completed_at = now()
    WHERE id = $2
  `, [status, approvalId]);
}
