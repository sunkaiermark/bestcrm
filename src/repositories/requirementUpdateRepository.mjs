function mapRequirementUpdateRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    requirementText: row.requirement_text,
    reason: row.reason,
    createdBy: Number(row.created_by),
    creatorDisplayName: row.creator_display_name || '',
    createdAt: row.created_at
  };
}

export function createRequirementUpdateRepository(queryTarget) {
  return {
    async create(input) {
      const result = await queryTarget.query(`
        INSERT INTO requirement_updates (
          opportunity_id,
          requirement_text,
          reason,
          created_by
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [
        input.opportunityId,
        input.requirementText,
        input.reason,
        input.createdBy
      ]);
      return {
        id: Number(result.rows[0].id),
        opportunityId: input.opportunityId,
        requirementText: input.requirementText,
        reason: input.reason,
        createdBy: input.createdBy,
        createdAt: result.rows[0].created_at
      };
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          ru.id,
          ru.opportunity_id,
          ru.requirement_text,
          ru.reason,
          ru.created_by,
          creator.display_name AS creator_display_name,
          ru.created_at
        FROM requirement_updates ru
        LEFT JOIN users creator ON creator.id = ru.created_by
        WHERE ru.opportunity_id = $1
        ORDER BY ru.created_at ASC, ru.id ASC
      `, [opportunityId]);
      return result.rows.map(mapRequirementUpdateRow);
    }
  };
}
