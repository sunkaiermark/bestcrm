function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapAttachmentRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    category: row.category,
    originalName: row.original_name,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    uploadedBy: Number(row.uploaded_by),
    uploaderDisplayName: row.uploader_display_name || '',
    technicalSolutionId: numberOrNull(row.technical_solution_id),
    commercialQuoteId: numberOrNull(row.commercial_quote_id),
    contractApprovalId: numberOrNull(row.contract_approval_id),
    uploadedAt: row.uploaded_at
  };
}

const attachmentSelect = `
  SELECT
    a.id,
    a.opportunity_id,
    a.category,
    a.original_name,
    a.stored_path,
    a.mime_type,
    a.file_size,
    a.uploaded_by,
    uploader.display_name AS uploader_display_name,
    a.technical_solution_id,
    a.commercial_quote_id,
    a.contract_approval_id,
    a.uploaded_at
  FROM attachments a
  LEFT JOIN users uploader ON uploader.id = a.uploaded_by
`;

export function createAttachmentRepository(queryTarget) {
  return {
    async createAttachment(input) {
      const result = await queryTarget.query(`
        INSERT INTO attachments (
          opportunity_id,
          category,
          original_name,
          stored_path,
          mime_type,
          file_size,
          uploaded_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        input.opportunityId,
        input.category,
        input.originalName,
        input.storedPath,
        input.mimeType,
        input.fileSize,
        input.uploadedBy
      ]);
      return {
        id: Number(result.rows[0].id),
        opportunityId: input.opportunityId,
        category: input.category,
        originalName: input.originalName,
        storedPath: input.storedPath,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        uploadedBy: input.uploadedBy,
        technicalSolutionId: null,
        commercialQuoteId: null,
        contractApprovalId: null,
        uploadedAt: result.rows[0].uploaded_at
      };
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${attachmentSelect}
        WHERE a.opportunity_id = $1
        ORDER BY a.uploaded_at DESC, a.id DESC
      `, [opportunityId]);
      return result.rows.map(mapAttachmentRow);
    },

    async findById(id) {
      const result = await queryTarget.query(`
        ${attachmentSelect}
        WHERE a.id = $1
        LIMIT 1
      `, [id]);
      return mapAttachmentRow(result.rows[0]);
    },

    async deleteById(id) {
      return queryTarget.query(`
        DELETE FROM attachments
        WHERE id = $1
      `, [id]);
    },

    async bindUnlinkedToTechnicalSolution({ opportunityId, technicalSolutionId }) {
      return queryTarget.query(`
        UPDATE attachments
        SET technical_solution_id = $2
        WHERE opportunity_id = $1
          AND category = 'technical_solution'
          AND technical_solution_id IS NULL
      `, [opportunityId, technicalSolutionId]);
    },

    async bindUnlinkedToCommercialQuote({ opportunityId, commercialQuoteId }) {
      return queryTarget.query(`
        UPDATE attachments
        SET commercial_quote_id = $2
        WHERE opportunity_id = $1
          AND category = 'commercial_quote'
          AND commercial_quote_id IS NULL
      `, [opportunityId, commercialQuoteId]);
    },

    async bindUnlinkedToContractApproval({ opportunityId, contractApprovalId }) {
      return queryTarget.query(`
        UPDATE attachments
        SET contract_approval_id = $2
        WHERE opportunity_id = $1
          AND category = 'contract'
          AND contract_approval_id IS NULL
      `, [opportunityId, contractApprovalId]);
    }
  };
}
