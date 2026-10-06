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
    sellerEntityCode: row.seller_entity_code || '',
    sellerEntityName: row.seller_entity_name || '',
    termSelections: row.term_selections || {},
    lineItems: row.line_items || [],
    draftRevisionNo: Number(row.draft_revision_no),
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapFormalVersion(row) {
  if (!row) return null;
  return {
    id: Number(row.id), opportunityId: Number(row.opportunity_id), draftId: Number(row.draft_id),
    draftRevisionNo: Number(row.draft_revision_no), versionNo: Number(row.version_no),
    quotationNo: row.quotation_no, snapshot: row.snapshot, status: row.status,
    sourceTechnicalDraftId: Number(row.source_technical_draft_id),
    sourceAttachmentId: Number(row.source_attachment_id), sourceSha256: row.source_sha256,
    submittedBy: Number(row.submitted_by), submittedAt: row.submitted_at,
    submittedByName: row.submitted_by_name || '',
    reviewedBy: row.reviewed_by == null ? null : Number(row.reviewed_by),
    reviewedAt: row.reviewed_at, reviewComment: row.review_comment || '',
    reviewedByName: row.reviewed_by_name || '',
    signedBy: row.signed_by == null ? null : Number(row.signed_by),
    signedByName: row.signed_by_name || '',
    signedAt: row.signed_at, signatureSha256: row.signature_sha256,
    sealSha256: row.seal_sha256, pdfStoredPath: row.pdf_stored_path,
    pdfSha256: row.pdf_sha256, pdfFileSize: row.pdf_file_size == null ? null : Number(row.pdf_file_size)
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
    async listFormalVersions(opportunityId) {
      const result = await queryTarget.query(`
        SELECT version.*, submitter.display_name AS submitted_by_name,
          reviewer.display_name AS reviewed_by_name, signer.display_name AS signed_by_name
        FROM sales_commercial_quotation_versions version
        JOIN users submitter ON submitter.id = version.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = version.reviewed_by
        LEFT JOIN users signer ON signer.id = version.signed_by
        WHERE version.opportunity_id = $1 ORDER BY version.version_no DESC, version.id DESC
      `, [opportunityId]);
      return result.rows.map(mapFormalVersion);
    },

    async getFormalVersion(id) {
      const result = await queryTarget.query(`
        SELECT version.*, submitter.display_name AS submitted_by_name,
          reviewer.display_name AS reviewed_by_name, signer.display_name AS signed_by_name
        FROM sales_commercial_quotation_versions version
        JOIN users submitter ON submitter.id = version.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = version.reviewed_by
        LEFT JOIN users signer ON signer.id = version.signed_by
        WHERE version.id = $1 LIMIT 1
      `, [id]);
      return mapFormalVersion(result.rows[0]);
    },

    async submitFormalVersion(input) {
      if (typeof queryTarget.connect !== 'function') {
        throw new Error('Formal quotation submission requires a database transaction');
      }
      const client = await queryTarget.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [input.opportunityId]);
        const result = await client.query(`
          WITH next_version AS (
            SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no
            FROM sales_commercial_quotation_versions WHERE opportunity_id = $1
          )
          INSERT INTO sales_commercial_quotation_versions (
            opportunity_id, draft_id, draft_revision_no, version_no, quotation_no,
            snapshot, source_technical_draft_id, source_attachment_id, source_sha256,
            submitted_by
          )
          SELECT draft.opportunity_id, draft.id, draft.draft_revision_no,
            next_version.version_no,
            'Q-' || opportunity.opportunity_no || '-V' || next_version.version_no,
            $4::jsonb, draft.source_technical_draft_id, draft.source_attachment_id,
            draft.source_sha256, $3
          FROM sales_commercial_quotation_drafts draft
          JOIN opportunities opportunity ON opportunity.id = draft.opportunity_id
          CROSS JOIN next_version
          WHERE draft.opportunity_id = $1 AND draft.draft_revision_no = $2
            AND opportunity.archived_at IS NULL
          RETURNING *
        `, [input.opportunityId, input.expectedRevisionNo, input.actorUserId,
          JSON.stringify(input.snapshot)]);
        await client.query('COMMIT');
        return mapFormalVersion(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async reviewFormalVersion(input) {
      const result = await queryTarget.query(`
        UPDATE sales_commercial_quotation_versions
        SET status = $3, reviewed_by = $4, reviewed_at = now(), review_comment = $5
        WHERE id = $1 AND opportunity_id = $2 AND status = 'pending'
          AND submitted_by <> $4
          AND ($3 <> 'approved' OR NOT EXISTS (
            SELECT 1 FROM opportunity_technical_drafts newer
            JOIN opportunity_technical_drafts source ON source.id = sales_commercial_quotation_versions.source_technical_draft_id
            WHERE newer.opportunity_id = sales_commercial_quotation_versions.opportunity_id
              AND newer.source_kind = 'uploaded_file'
              AND newer.status IN ('ready', 'pending', 'approved')
              AND newer.draft_revision_no > source.draft_revision_no
          ))
        RETURNING *
      `, [input.id, input.opportunityId, input.decision, input.actorUserId,
        input.comment || '']);
      return mapFormalVersion(result.rows[0]);
    },

    async signFormalVersion(input) {
      const result = await queryTarget.query(`
        UPDATE sales_commercial_quotation_versions version
        SET status = 'signed', signed_by = $3, signed_at = $4,
          signature_sha256 = $5, seal_sha256 = $6,
          pdf_stored_path = $7, pdf_sha256 = $8, pdf_file_size = $9
        FROM opportunity_technical_drafts technical
        JOIN attachments attachment ON attachment.id = $10
        WHERE version.id = $1 AND version.opportunity_id = $2
          AND version.status = 'approved'
          AND technical.id = version.source_technical_draft_id
          AND technical.status = 'approved'
          AND attachment.id = version.source_attachment_id
          AND attachment.sha256 = version.source_sha256
          AND attachment.retired_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM opportunity_technical_drafts newer
            WHERE newer.opportunity_id = version.opportunity_id
              AND newer.source_kind = 'uploaded_file'
              AND newer.status IN ('ready', 'pending', 'approved')
              AND newer.draft_revision_no > technical.draft_revision_no
          )
        RETURNING version.*
      `, [input.id, input.opportunityId, input.actorUserId, input.signedAt,
        input.signatureSha256, input.sealSha256, input.pdfStoredPath,
        input.pdfSha256, input.pdfFileSize, input.sourceAttachmentId]);
      return mapFormalVersion(result.rows[0]);
    },

    async listPublishedStandardTerms(language) {
      const result = await queryTarget.query(`
        SELECT id, term_key, language, revision_no, title, body
        FROM sales_quotation_standard_terms
        WHERE language = $1
          AND status = 'published'
          AND published_at <= now()
          AND retired_at IS NULL
        ORDER BY term_key, revision_no DESC, id DESC
      `, [language]);
      return result.rows.map((row) => ({
        id: Number(row.id), key: row.term_key, language: row.language,
        revisionNo: Number(row.revision_no), title: row.title, body: row.body
      }));
    },

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
          source_sha256, source_file_name, language, currency,
          seller_entity_code, seller_entity_name, line_items,
          term_selections, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $12)
        ON CONFLICT (opportunity_id) DO UPDATE SET
          source_technical_draft_id = EXCLUDED.source_technical_draft_id,
          source_attachment_id = EXCLUDED.source_attachment_id,
          source_sha256 = EXCLUDED.source_sha256,
          source_file_name = EXCLUDED.source_file_name,
          currency = EXCLUDED.currency,
          seller_entity_code = EXCLUDED.seller_entity_code,
          seller_entity_name = EXCLUDED.seller_entity_name,
          line_items = EXCLUDED.line_items,
          term_selections = EXCLUDED.term_selections,
          draft_revision_no = sales_commercial_quotation_drafts.draft_revision_no + 1,
          updated_by = EXCLUDED.updated_by
        WHERE sales_commercial_quotation_drafts.draft_revision_no = $13
        RETURNING *
      `, [
        input.opportunityId, input.source.technicalDraftId, input.source.attachmentId,
        input.source.sha256, input.source.originalName, input.language,
        input.currency || null, input.sellerEntityCode || null,
        input.sellerEntityName || null, JSON.stringify(input.lineItems),
        JSON.stringify(input.termSelections || {}), input.actorUserId,
        input.expectedRevisionNo
      ]);
      return mapDraft(result.rows[0]);
    }
  };
}
