function mapRelease(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    technicalDocumentId: Number(row.technical_document_id),
    opportunityId: Number(row.opportunity_id),
    customerId: Number(row.customer_id),
    fileSha256: row.file_sha256,
    purpose: row.purpose,
    status: row.status,
    requestedBy: Number(row.requested_by),
    requestedAt: row.requested_at,
    reviewedBy: row.reviewed_by == null ? null : Number(row.reviewed_by),
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment || '',
    revokedBy: row.revoked_by == null ? null : Number(row.revoked_by),
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason || ''
  };
}

export function createTechnicalDocumentCustomerReleaseRepository(queryTarget) {
  return {
    async listByDraft(draftId) {
      const result = await queryTarget.query(`
        SELECT rel.*
        FROM technical_document_customer_releases rel
        JOIN technical_solution_documents document
          ON document.id = rel.technical_document_id
        WHERE document.technical_draft_id = $1
        ORDER BY document.id
      `, [draftId]);
      return result.rows.map(mapRelease);
    },

    async request({ opportunityId, customerId, draftId, documentId, fileSha256, purpose, actorUserId }) {
      const result = await queryTarget.query(`
        INSERT INTO technical_document_customer_releases (
          technical_document_id, opportunity_id, customer_id,
          file_sha256, purpose, requested_by
        )
        SELECT document.id, draft.opportunity_id, opportunity.customer_id,
          document.sha256, $6, $7
        FROM technical_solution_documents document
        JOIN opportunity_technical_drafts draft ON draft.id = document.technical_draft_id
        JOIN opportunities opportunity ON opportunity.id = draft.opportunity_id
        WHERE document.id = $4 AND draft.id = $3
          AND draft.opportunity_id = $1 AND opportunity.customer_id = $2
          AND document.sha256 = $5
          AND draft.status = 'approved' AND draft.formal_version_no IS NOT NULL
          AND NOT draft.self_approval_test
        ON CONFLICT (technical_document_id) DO NOTHING
        RETURNING *
      `, [opportunityId, customerId, draftId, documentId, fileSha256, purpose, actorUserId]);
      return mapRelease(result.rows[0]);
    },

    async review({ opportunityId, customerId, documentId, fileSha256, decision, comment, actorUserId }) {
      const result = await queryTarget.query(`
        UPDATE technical_document_customer_releases rel
        SET status = $5, reviewed_by = $7, reviewed_at = now(), review_comment = $6
        WHERE rel.technical_document_id = $3
          AND rel.opportunity_id = $1 AND rel.customer_id = $2
          AND rel.file_sha256 = $4
          AND rel.status = 'pending' AND rel.requested_by <> $7
        RETURNING rel.*
      `, [opportunityId, customerId, documentId, fileSha256, decision, comment, actorUserId]);
      return mapRelease(result.rows[0]);
    },

    async revoke({ opportunityId, customerId, documentId, fileSha256, reason, actorUserId }) {
      const result = await queryTarget.query(`
        UPDATE technical_document_customer_releases rel
        SET status = 'revoked', revoked_by = $6, revoked_at = now(),
          revocation_reason = $5
        WHERE rel.technical_document_id = $3
          AND rel.opportunity_id = $1 AND rel.customer_id = $2
          AND rel.file_sha256 = $4 AND rel.status = 'approved'
        RETURNING rel.*
      `, [opportunityId, customerId, documentId, fileSha256, reason, actorUserId]);
      return mapRelease(result.rows[0]);
    }
  };
}
