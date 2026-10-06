function mapTerm(row) {
  if (!row) return null;
  return {
    id: Number(row.id), key: row.term_key, language: row.language,
    revisionNo: Number(row.revision_no), title: row.title, body: row.body,
    status: row.status, createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    approvedBy: row.approved_by == null ? null : Number(row.approved_by),
    approvedByDisplayName: row.approved_by_display_name || '',
    publishedAt: row.published_at, retiredAt: row.retired_at,
    retiredBy: row.retired_by == null ? null : Number(row.retired_by),
    createdAt: row.created_at
  };
}

export function createSalesQuotationStandardTermRepository(queryTarget) {
  return {
    async listAll(language) {
      const result = await queryTarget.query(`
        SELECT term.*, author.display_name AS created_by_display_name,
          reviewer.display_name AS approved_by_display_name
        FROM sales_quotation_standard_terms term
        JOIN users author ON author.id = term.created_by
        LEFT JOIN users reviewer ON reviewer.id = term.approved_by
        WHERE term.language = $1
        ORDER BY term.term_key, term.revision_no DESC, term.id DESC
      `, [language]);
      return result.rows.map(mapTerm);
    },

    async findById(id) {
      const result = await queryTarget.query(`
        SELECT * FROM sales_quotation_standard_terms WHERE id = $1
      `, [id]);
      return mapTerm(result.rows[0]);
    },

    async createDraft(input) {
      const result = await queryTarget.query(`
        INSERT INTO sales_quotation_standard_terms (
          term_key, language, revision_no, title, body, created_by
        ) SELECT $1, $2, COALESCE(MAX(revision_no), 0) + 1, $3, $4, $5
          FROM sales_quotation_standard_terms
          WHERE term_key = $1 AND language = $2
        RETURNING *
      `, [input.key, input.language, input.title, input.body, input.actorUserId]);
      return mapTerm(result.rows[0]);
    },

    async updateDraft(input) {
      const result = await queryTarget.query(`
        UPDATE sales_quotation_standard_terms SET title = $3, body = $4
        WHERE id = $1 AND status = 'draft' AND created_by = $2
        RETURNING *
      `, [input.id, input.actorUserId, input.title, input.body]);
      return mapTerm(result.rows[0]);
    },

    async publish(input) {
      const result = await queryTarget.query(`
        UPDATE sales_quotation_standard_terms
        SET status = 'published', approved_by = $2, published_at = now()
        WHERE id = $1 AND status = 'draft' AND created_by <> $2
          AND title = $3 AND body = $4
        RETURNING *
      `, [input.id, input.actorUserId, input.expectedTitle, input.expectedBody]);
      return mapTerm(result.rows[0]);
    },

    async retire(input) {
      const result = await queryTarget.query(`
        UPDATE sales_quotation_standard_terms
        SET status = 'retired', retired_at = now(), retired_by = $2
        WHERE id = $1 AND status = 'published'
        RETURNING *
      `, [input.id, input.actorUserId]);
      return mapTerm(result.rows[0]);
    }
  };
}
