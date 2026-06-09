function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapMaterialVersionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    materialType: row.material_type,
    versionNo: Number(row.version_no),
    status: row.status,
    submittedBy: numberOrNull(row.submitted_by),
    submitterDisplayName: row.submitter_display_name || '',
    submittedAt: row.submitted_at,
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewerDisplayName: row.reviewer_display_name || '',
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment,
    createdAt: row.created_at
  };
}

const materialVersionSelect = `
  SELECT
    omv.id,
    omv.opportunity_id,
    omv.material_type,
    omv.version_no,
    omv.status,
    omv.submitted_by,
    submitter.display_name AS submitter_display_name,
    omv.submitted_at,
    omv.reviewed_by,
    reviewer.display_name AS reviewer_display_name,
    omv.reviewed_at,
    omv.review_comment,
    omv.created_at
`;

export function createOpportunityMaterialVersionRepository(queryTarget) {
  return {
    async createVersion(input) {
      const status = input.status || 'draft';
      const submittedBy = input.submittedBy || null;
      const result = await queryTarget.query(`
        WITH inserted AS (
          INSERT INTO opportunity_material_versions (
            opportunity_id,
            material_type,
            version_no,
            status,
            submitted_by,
            submitted_at
          )
          SELECT
            $1,
            $2,
            COALESCE(MAX(version_no), 0) + 1,
            $3,
            $4,
            CASE WHEN $4::bigint IS NULL THEN NULL ELSE now() END
          FROM opportunity_material_versions
          WHERE opportunity_id = $1
            AND material_type = $2
          RETURNING *
        )
        ${materialVersionSelect}
        FROM inserted omv
        LEFT JOIN users submitter ON submitter.id = omv.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = omv.reviewed_by
      `, [
        input.opportunityId,
        input.materialType,
        status,
        submittedBy
      ]);
      return mapMaterialVersionRow(result.rows[0]);
    },

    async submitVersion(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_material_versions
          SET
            status = 'pending',
            submitted_by = $2,
            submitted_at = now(),
            reviewed_by = NULL,
            reviewed_at = NULL,
            review_comment = NULL
          WHERE id = $1
          RETURNING *
        )
        ${materialVersionSelect}
        FROM updated omv
        LEFT JOIN users submitter ON submitter.id = omv.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = omv.reviewed_by
      `, [
        input.versionId,
        input.submittedBy
      ]);
      return mapMaterialVersionRow(result.rows[0]);
    },

    async reviewVersion(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_material_versions
          SET
            status = $2,
            reviewed_by = $3,
            reviewed_at = now(),
            review_comment = $4
          WHERE id = $1
            AND status = 'pending'
          RETURNING *
        )
        ${materialVersionSelect}
        FROM updated omv
        LEFT JOIN users submitter ON submitter.id = omv.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = omv.reviewed_by
      `, [
        input.versionId,
        input.status,
        input.reviewedBy,
        input.reviewComment || null
      ]);
      return mapMaterialVersionRow(result.rows[0]);
    },

    async listByOpportunity(opportunityId, materialType = null) {
      const params = materialType ? [opportunityId, materialType] : [opportunityId];
      const materialTypeCondition = materialType ? 'AND omv.material_type = $2' : '';
      const result = await queryTarget.query(`
        ${materialVersionSelect}
        FROM opportunity_material_versions omv
        LEFT JOIN users submitter ON submitter.id = omv.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = omv.reviewed_by
        WHERE omv.opportunity_id = $1
          ${materialTypeCondition}
        ORDER BY omv.material_type ASC, omv.version_no ASC, omv.created_at ASC, omv.id ASC
      `, params);
      return result.rows.map(mapMaterialVersionRow);
    },

    async findLatestByOpportunityAndType(opportunityId, materialType) {
      const result = await queryTarget.query(`
        ${materialVersionSelect}
        FROM opportunity_material_versions omv
        LEFT JOIN users submitter ON submitter.id = omv.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = omv.reviewed_by
        WHERE omv.opportunity_id = $1
          AND omv.material_type = $2
        ORDER BY omv.version_no DESC, omv.created_at DESC, omv.id DESC
        LIMIT 1
      `, [
        opportunityId,
        materialType
      ]);
      return mapMaterialVersionRow(result.rows[0]);
    }
  };
}

