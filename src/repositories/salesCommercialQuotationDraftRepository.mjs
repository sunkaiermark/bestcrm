import { ACTIONS } from '../domain/workflow.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { createTodoRepository } from './todoRepository.mjs';
import { createWorkflowEventRepository } from './workflowEventRepository.mjs';

// The visible name is MarkYang; this canonical login identifies that one account.
const MARKYANG_ACCOUNT_USERNAME = '杨胜华';

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
    taxRate: row.tax_rate == null ? '0' : String(row.tax_rate),
    sellerEntityCode: row.seller_entity_code || '',
    sellerEntityName: row.seller_entity_name || '',
    customerContactId: row.customer_contact_id == null ? null : Number(row.customer_contact_id),
    customerContactName: row.customer_contact_name || '',
    customerContactPhone: row.customer_contact_phone || '',
    customerContactEmail: row.customer_contact_email || '',
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
        const opportunityResult = await client.query(`
          SELECT id, status, salesperson_id, commercial_manager_id
          FROM opportunities
          WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE
        `, [input.opportunityId]);
        const opportunity = opportunityResult.rows[0];
        const commercialManagerId = Number(input.commercialManagerId ?? opportunity?.commercial_manager_id);
        if (!Number.isSafeInteger(commercialManagerId) || commercialManagerId <= 0) {
          const error = new Error('An assigned Commercial Manager is required');
          error.code = 'BESTCRM_COMMERCIAL_MANAGER_REQUIRED';
          throw error;
        }
        const pendingResult = await client.query(`
          SELECT id
          FROM sales_commercial_quotation_versions
          WHERE opportunity_id = $1 AND status = 'pending'
          ORDER BY version_no DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `, [input.opportunityId]);
        if (pendingResult.rowCount > 0) {
          const error = new Error('A formal quotation is already pending commercial review');
          error.code = 'BESTCRM_FORMAL_QUOTATION_PENDING';
          throw error;
        }
        // The database guard on a formal version reads the opportunity row.  Persist
        // the configured reviewer before inserting the version, while this same
        // transaction still holds the opportunity lock.
        await client.query(`
          UPDATE opportunities
          SET commercial_manager_id = $2, updated_at = now()
          WHERE id = $1
        `, [input.opportunityId, commercialManagerId]);
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
        if (!result.rows[0]) {
          await client.query('ROLLBACK');
          return null;
        }
        const version = mapFormalVersion(result.rows[0]);
        const actionUrl = `/opportunities/${input.opportunityId}/commercial-quotation-draft#quotation-version-${version.id}`;
        await client.query(`
          UPDATE opportunities
          SET status = $2, updated_at = now()
          WHERE id = $1
        `, [input.opportunityId, STATUSES.COMMERCIAL_QUOTE_PENDING]);
        const todoRepository = createTodoRepository(client);
        const eventRepository = createWorkflowEventRepository(client);
        await todoRepository.closePendingForOpportunityAndTitle(
          input.opportunityId,
          'Approve commercial quote',
          'cancelled',
          input.actorUserId
        );
        await eventRepository.create({
          opportunityId: input.opportunityId,
          eventType: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
          fromStatus: opportunity.status,
          toStatus: STATUSES.COMMERCIAL_QUOTE_PENDING,
          actorUserId: input.actorUserId,
          targetUserId: commercialManagerId,
          comment: `Formal quotation ${version.quotationNo} submitted for commercial review`,
          actionUrl
        });
        await todoRepository.create({
          opportunityId: input.opportunityId,
          assigneeUserId: commercialManagerId,
          title: 'Approve commercial quote',
          description: `Review frozen quotation ${version.quotationNo}`,
          actionUrl
        }, input.actorUserId);
        await client.query('COMMIT');
        return version;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async reviewFormalVersion(input) {
      if (typeof queryTarget.connect !== 'function') {
        throw new Error('Formal quotation review requires a database transaction');
      }
      const client = await queryTarget.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(`
          SELECT version.id, version.quotation_no, version.status,
            opportunity.status AS opportunity_status,
            opportunity.salesperson_id,
            opportunity.commercial_manager_id
          FROM sales_commercial_quotation_versions version
          JOIN opportunities opportunity ON opportunity.id = version.opportunity_id
          WHERE version.id = $1 AND version.opportunity_id = $2
            AND opportunity.archived_at IS NULL
          FOR UPDATE OF version, opportunity
        `, [input.id, input.opportunityId]);
        const current = locked.rows[0];
        if (!current || current.status !== 'pending') {
          await client.query('COMMIT');
          return null;
        }
        const result = await client.query(`
          UPDATE sales_commercial_quotation_versions
          SET status = $3, reviewed_by = $4, reviewed_at = now(), review_comment = $5
          WHERE id = $1 AND opportunity_id = $2 AND status = 'pending'
            AND (
              submitted_by <> $4
              OR EXISTS (
                SELECT 1 FROM users reviewer
                WHERE reviewer.id = $4
                  AND reviewer.username = '${MARKYANG_ACCOUNT_USERNAME}'
                  AND reviewer.is_active = true
              )
            )
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
        if (!result.rows[0]) {
          await client.query('COMMIT');
          return null;
        }
        const nextStatus = input.decision === 'approved'
          ? STATUSES.CUSTOMER_NEGOTIATION
          : STATUSES.COMMERCIAL_QUOTE_REJECTED;
        await client.query(`
          UPDATE opportunities
          SET status = $2, updated_at = now()
          WHERE id = $1
        `, [input.opportunityId, nextStatus]);
        const actionUrl = `/opportunities/${input.opportunityId}/commercial-quotation-draft#quotation-version-${input.id}`;
        const todoRepository = createTodoRepository(client);
        const eventRepository = createWorkflowEventRepository(client);
        await todoRepository.closePendingForOpportunityAndTitle(
          input.opportunityId,
          'Approve commercial quote',
          'completed',
          input.actorUserId
        );
        await eventRepository.create({
          opportunityId: input.opportunityId,
          eventType: input.decision === 'approved'
            ? ACTIONS.APPROVE_COMMERCIAL_QUOTE
            : ACTIONS.REJECT_COMMERCIAL_QUOTE,
          fromStatus: current.opportunity_status,
          toStatus: nextStatus,
          actorUserId: input.actorUserId,
          targetUserId: Number(current.salesperson_id),
          comment: input.comment || `Formal quotation ${current.quotation_no} ${input.decision}`,
          actionUrl
        });
        await client.query('COMMIT');
        return mapFormalVersion(result.rows[0]);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
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
          tax_rate,
          seller_entity_code, seller_entity_name,
          customer_contact_id, customer_contact_name,
          customer_contact_phone, customer_contact_email,
          line_items, term_selections, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $17)
        ON CONFLICT (opportunity_id) DO UPDATE SET
          source_technical_draft_id = EXCLUDED.source_technical_draft_id,
          source_attachment_id = EXCLUDED.source_attachment_id,
          source_sha256 = EXCLUDED.source_sha256,
          source_file_name = EXCLUDED.source_file_name,
          currency = EXCLUDED.currency,
          tax_rate = EXCLUDED.tax_rate,
          seller_entity_code = EXCLUDED.seller_entity_code,
          seller_entity_name = EXCLUDED.seller_entity_name,
          customer_contact_id = EXCLUDED.customer_contact_id,
          customer_contact_name = EXCLUDED.customer_contact_name,
          customer_contact_phone = EXCLUDED.customer_contact_phone,
          customer_contact_email = EXCLUDED.customer_contact_email,
          line_items = EXCLUDED.line_items,
          term_selections = EXCLUDED.term_selections,
          draft_revision_no = sales_commercial_quotation_drafts.draft_revision_no + 1,
          updated_by = EXCLUDED.updated_by
        WHERE sales_commercial_quotation_drafts.draft_revision_no = $18
        RETURNING *
      `, [
        input.opportunityId, input.source.technicalDraftId, input.source.attachmentId,
        input.source.sha256, input.source.originalName, input.language,
        input.currency || null, input.taxRate || '0', input.sellerEntityCode || null,
        input.sellerEntityName || null, input.customerContactId || null,
        input.customerContactName || '', input.customerContactPhone || '',
        input.customerContactEmail || '', JSON.stringify(input.lineItems),
        JSON.stringify(input.termSelections || {}), input.actorUserId,
        input.expectedRevisionNo
      ]);
      return mapDraft(result.rows[0]);
    }
  };
}
