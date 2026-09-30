function mapSource(row) {
  if (!row) return null;
  return {
    technicalDraftId: Number(row.technical_draft_id),
    technicalDraftRevisionNo: Number(row.technical_draft_revision_no),
    attachmentId: Number(row.attachment_id),
    originalName: row.original_name,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at,
    technicalStatus: row.technical_status
  };
}

function mapDraft(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    sourceTechnicalDraftId: Number(row.source_technical_draft_id),
    sourceAttachmentId: Number(row.source_attachment_id),
    sourceSha256: row.source_sha256,
    sourceFileName: row.source_file_name,
    language: row.language,
    currency: row.currency || '',
    lineItems: row.line_items || [],
    draftRevisionNo: Number(row.draft_revision_no),
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const sourceSelect = `
  SELECT draft.id AS technical_draft_id,
    draft.draft_revision_no AS technical_draft_revision_no,
    draft.status AS technical_status,
    attachment.id AS attachment_id,
    attachment.original_name,
    attachment.sha256,
    attachment.uploaded_at
  FROM opportunity_technical_draft_attachments link
  JOIN opportunity_technical_drafts draft ON draft.id = link.technical_draft_id
  JOIN attachments attachment ON attachment.id = link.attachment_id
  WHERE draft.opportunity_id = $1
    AND draft.source_kind = 'uploaded_file'
    AND draft.status IN ('ready', 'pending', 'approved')
    AND attachment.retired_at IS NULL
    AND attachment.sha256 ~ '^[0-9a-f]{64}$'
`;

export function createSalesCommercialQuotationDraftRepository(queryTarget) {
  return {
    async listTechnicalSources(opportunityId) {
      const result = await queryTarget.query(`
        ${sourceSelect}
        ORDER BY draft.draft_revision_no DESC, link.sort_order ASC, link.id DESC
      `, [opportunityId]);
      return result.rows.map(mapSource);
    },

    async getTechnicalSource(opportunityId, attachmentId) {
      const result = await queryTarget.query(`
        ${sourceSelect}
          AND attachment.id = $2
        LIMIT 1
      `, [opportunityId, attachmentId]);
      return mapSource(result.rows[0]);
    },

    async getByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT * FROM sales_commercial_quotation_drafts
        WHERE opportunity_id = $1 LIMIT 1
      `, [opportunityId]);
      return mapDraft(result.rows[0]);
    },

    async saveDraft(input) {
      const result = await queryTarget.query(`
        INSERT INTO sales_commercial_quotation_drafts (
          opportunity_id, source_technical_draft_id, source_attachment_id,
          source_sha256, source_file_name, language, currency, line_items,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9)
        ON CONFLICT (opportunity_id) DO UPDATE SET
          source_technical_draft_id = EXCLUDED.source_technical_draft_id,
          source_attachment_id = EXCLUDED.source_attachment_id,
          source_sha256 = EXCLUDED.source_sha256,
          source_file_name = EXCLUDED.source_file_name,
          currency = EXCLUDED.currency,
          line_items = EXCLUDED.line_items,
          draft_revision_no = sales_commercial_quotation_drafts.draft_revision_no + 1,
          updated_by = EXCLUDED.updated_by
        WHERE sales_commercial_quotation_drafts.draft_revision_no = $10
        RETURNING *
      `, [
        input.opportunityId, input.source.technicalDraftId, input.source.attachmentId,
        input.source.sha256, input.source.originalName, input.language,
        input.currency || null, JSON.stringify(input.lineItems), input.actorUserId,
        input.expectedRevisionNo
      ]);
      return mapDraft(result.rows[0]);
    }
  };
}
