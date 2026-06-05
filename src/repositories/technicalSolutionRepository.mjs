function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapTechnicalSolutionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    versionNo: Number(row.version_no),
    summary: row.summary,
    parameters: row.parameters,
    implementationPlan: row.implementation_plan,
    status: row.status,
    submittedBy: Number(row.submitted_by),
    submitterDisplayName: row.submitter_display_name || '',
    submittedAt: row.submitted_at,
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewerDisplayName: row.reviewer_display_name || '',
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment
  };
}

export function createTechnicalSolutionRepository(queryTarget) {
  return {
    async createVersion(input) {
      const result = await queryTarget.query(`
        INSERT INTO technical_solutions (
          opportunity_id,
          version_no,
          summary,
          parameters,
          implementation_plan,
          status,
          submitted_by
        )
        SELECT
          $1,
          COALESCE(MAX(version_no), 0) + 1,
          $2,
          $3,
          $4,
          'pending',
          $5
        FROM technical_solutions
        WHERE opportunity_id = $1
        RETURNING *
      `, [
        input.opportunityId,
        input.summary,
        input.parameters,
        input.implementationPlan,
        input.submittedBy
      ]);
      return mapTechnicalSolutionRow(result.rows[0]);
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          ts.id,
          ts.opportunity_id,
          ts.version_no,
          ts.summary,
          ts.parameters,
          ts.implementation_plan,
          ts.status,
          ts.submitted_by,
          submitter.display_name AS submitter_display_name,
          ts.submitted_at,
          ts.reviewed_by,
          reviewer.display_name AS reviewer_display_name,
          ts.reviewed_at,
          ts.review_comment
        FROM technical_solutions ts
        LEFT JOIN users submitter ON submitter.id = ts.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = ts.reviewed_by
        WHERE ts.opportunity_id = $1
        ORDER BY ts.version_no ASC, ts.submitted_at ASC, ts.id ASC
      `, [opportunityId]);
      return result.rows.map(mapTechnicalSolutionRow);
    },

    async reviewLatestPending(input) {
      const result = await queryTarget.query(`
        UPDATE technical_solutions
        SET
          status = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          review_comment = $4
        WHERE id = (
          SELECT id
          FROM technical_solutions
          WHERE opportunity_id = $1
            AND status = 'pending'
          ORDER BY version_no DESC, submitted_at DESC, id DESC
          LIMIT 1
        )
        RETURNING *
      `, [
        input.opportunityId,
        input.status,
        input.reviewedBy,
        input.reviewComment
      ]);
      return mapTechnicalSolutionRow(result.rows[0]);
    }
  };
}
