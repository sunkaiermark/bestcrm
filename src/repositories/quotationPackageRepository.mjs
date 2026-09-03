function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

export function quotationPackageLabel(packageVersion) {
  if (!packageVersion) return '';
  return packageVersion.versionNo
    ? `QP-V${Number(packageVersion.versionNo)}`
    : `QP-D${Number(packageVersion.draftRevisionNo)}`;
}

function mapPackageRow(row) {
  if (!row) return null;
  const packageVersion = {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    sourcePackageId: numberOrNull(row.source_package_id),
    draftRevisionNo: Number(row.draft_revision_no),
    versionNo: numberOrNull(row.version_no),
    status: row.status,
    technicalSolutionVersionId: Number(row.technical_solution_version_id),
    technicalSolutionVersionNo: numberOrNull(row.technical_solution_version_no),
    commercialQuoteId: Number(row.commercial_quote_id),
    commercialQuoteVersionNo: numberOrNull(row.commercial_quote_version_no),
    currency: row.currency,
    totalPrice: Number(row.total_price),
    deliveryPeriod: row.delivery_period,
    paymentTerms: row.payment_terms,
    validUntil: row.valid_until,
    commercialLineItems: jsonValue(row.commercial_line_items, []),
    inclusions: row.inclusions || '',
    exclusions: row.exclusions || '',
    technicalAssumptions: row.technical_assumptions || '',
    revisionReason: row.revision_reason || '',
    changeSummary: row.change_summary || '',
    createdBy: Number(row.created_by),
    creatorDisplayName: row.creator_display_name || '',
    createdAt: row.created_at,
    submittedBy: numberOrNull(row.submitted_by),
    submitterDisplayName: row.submitter_display_name || '',
    submittedAt: row.submitted_at,
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewerDisplayName: row.reviewer_display_name || '',
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment || '',
    sentBy: numberOrNull(row.sent_by),
    senderDisplayName: row.sender_display_name || '',
    sentAt: row.sent_at,
    acceptedBy: numberOrNull(row.accepted_by),
    accepterDisplayName: row.accepter_display_name || '',
    acceptedAt: row.accepted_at,
    supersededAt: row.superseded_at,
    sentEmailMessageId: numberOrNull(row.sent_email_message_id),
    updatedBy: Number(row.updated_by),
    updatedAt: row.updated_at
  };
  packageVersion.label = quotationPackageLabel(packageVersion);
  return packageVersion;
}

function mapAttachmentRow(row) {
  return {
    id: Number(row.id),
    quotationPackageId: Number(row.quotation_package_id),
    sourceType: row.source_type,
    technicalSolutionDocumentId: numberOrNull(row.technical_solution_document_id),
    attachmentId: numberOrNull(row.attachment_id),
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    displayOrder: Number(row.display_order),
    createdAt: row.created_at
  };
}

function mapEventRow(row) {
  return {
    id: Number(row.id),
    quotationPackageId: Number(row.quotation_package_id),
    eventType: row.event_type,
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    comment: row.comment || '',
    details: jsonValue(row.details, {}),
    createdAt: row.created_at
  };
}

const packageSelect = `
  SELECT
    qp.*,
    ts.formal_version_no AS technical_solution_version_no,
    cq.version_no AS commercial_quote_version_no,
    creator.display_name AS creator_display_name,
    submitter.display_name AS submitter_display_name,
    reviewer.display_name AS reviewer_display_name,
    sender.display_name AS sender_display_name,
    accepter.display_name AS accepter_display_name
  FROM quotation_package_versions qp
  JOIN opportunity_technical_drafts ts ON ts.id = qp.technical_solution_version_id
  JOIN commercial_quotes cq ON cq.id = qp.commercial_quote_id
  JOIN users creator ON creator.id = qp.created_by
  LEFT JOIN users submitter ON submitter.id = qp.submitted_by
  LEFT JOIN users reviewer ON reviewer.id = qp.reviewed_by
  LEFT JOIN users sender ON sender.id = qp.sent_by
  LEFT JOIN users accepter ON accepter.id = qp.accepted_by
`;

function draftValues(input) {
  return [
    input.opportunityId,
    input.sourcePackageId || null,
    input.technicalSolutionVersionId,
    input.commercialQuoteId,
    input.currency,
    input.totalPrice,
    input.deliveryPeriod,
    input.paymentTerms,
    input.validUntil,
    JSON.stringify(input.commercialLineItems || []),
    input.inclusions || '',
    input.exclusions || '',
    input.technicalAssumptions || '',
    input.revisionReason || null,
    input.changeSummary || null,
    input.actorUserId
  ];
}

export function createQuotationPackageRepository(queryTarget) {
  return {
    supportsQuotationPackages: true,

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${packageSelect}
        WHERE qp.opportunity_id = $1
        ORDER BY qp.draft_revision_no DESC, qp.id DESC
      `, [opportunityId]);
      return result.rows.map(mapPackageRow);
    },

    async getPackageDetail(packageId) {
      const [packageResult, attachmentResult, eventResult] = await Promise.all([
        queryTarget.query(`${packageSelect} WHERE qp.id = $1 LIMIT 1`, [packageId]),
        queryTarget.query(`
          SELECT * FROM quotation_package_attachments
          WHERE quotation_package_id = $1
          ORDER BY display_order ASC, id ASC
        `, [packageId]),
        queryTarget.query(`
          SELECT e.*, actor.display_name AS actor_display_name
          FROM quotation_package_events e
          JOIN users actor ON actor.id = e.actor_user_id
          WHERE e.quotation_package_id = $1
          ORDER BY e.created_at DESC, e.id DESC
        `, [packageId])
      ]);
      const packageVersion = mapPackageRow(packageResult.rows[0]);
      if (!packageVersion) return null;
      packageVersion.attachments = attachmentResult.rows.map(mapAttachmentRow);
      packageVersion.events = eventResult.rows.map(mapEventRow);
      return packageVersion;
    },

    async getEmailAttachmentSources(packageId) {
      const result = await queryTarget.query(`
        SELECT
          snapshot.source_type,
          snapshot.original_name,
          snapshot.mime_type,
          snapshot.byte_size,
          snapshot.sha256,
          snapshot.display_order,
          document.content,
          attachment.stored_path
        FROM quotation_package_attachments snapshot
        LEFT JOIN technical_solution_documents document
          ON document.id = snapshot.technical_solution_document_id
        LEFT JOIN attachments attachment
          ON attachment.id = snapshot.attachment_id
        WHERE snapshot.quotation_package_id = $1
        ORDER BY snapshot.display_order, snapshot.id
      `, [packageId]);
      return result.rows.map((row) => ({
        sourceType: row.source_type,
        originalName: row.original_name,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        sha256: row.sha256,
        content: row.content || null,
        storedPath: row.stored_path || ''
      }));
    },

    async listApprovedTechnicalSolutions(opportunityId) {
      const result = await queryTarget.query(`
        SELECT id, formal_version_no, language, reviewed_at
        FROM opportunity_technical_drafts
        WHERE opportunity_id = $1 AND status = 'approved'
        ORDER BY formal_version_no DESC
      `, [opportunityId]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        versionNo: Number(row.formal_version_no),
        label: `TS-V${Number(row.formal_version_no)}`,
        language: row.language,
        reviewedAt: row.reviewed_at
      }));
    },

    async listApprovedCommercialQuotes(opportunityId) {
      const result = await queryTarget.query(`
        SELECT id, version_no, total_price, payment_terms, validity_date, reviewed_at
        FROM commercial_quotes
        WHERE opportunity_id = $1 AND status = 'approved'
        ORDER BY version_no DESC
      `, [opportunityId]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        versionNo: Number(row.version_no),
        label: `CQ-V${Number(row.version_no)}`,
        totalPrice: Number(row.total_price),
        paymentTerms: row.payment_terms || '',
        validityDate: row.validity_date,
        reviewedAt: row.reviewed_at
      }));
    },

    async findCurrentSentByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${packageSelect}
        WHERE qp.opportunity_id = $1 AND qp.status = 'sent'
        ORDER BY qp.version_no DESC
        LIMIT 1
      `, [opportunityId]);
      return mapPackageRow(result.rows[0]);
    },

    async getCreationContext({ opportunityId, technicalSolutionVersionId, commercialQuoteId }) {
      const [componentResult, documentResult, attachmentResult, itemResult] = await Promise.all([
        queryTarget.query(`
          SELECT
            ts.id AS technical_id, ts.status AS technical_status,
            ts.formal_version_no AS technical_version_no,
            cq.id AS quote_id, cq.status AS quote_status,
            cq.version_no AS quote_version_no, cq.total_price,
            cq.payment_terms, cq.validity_date
          FROM opportunity_technical_drafts ts
          JOIN commercial_quotes cq ON cq.opportunity_id = ts.opportunity_id
          WHERE ts.opportunity_id = $1 AND ts.id = $2 AND cq.id = $3
          LIMIT 1
        `, [opportunityId, technicalSolutionVersionId, commercialQuoteId]),
        queryTarget.query(`
          SELECT id, original_name, mime_type, byte_size, sha256
          FROM technical_solution_documents
          WHERE technical_draft_id = $1
          ORDER BY format ASC, id ASC
        `, [technicalSolutionVersionId]),
        queryTarget.query(`
          SELECT a.id, a.original_name, a.stored_path, a.mime_type, a.file_size
          FROM attachments a
          JOIN opportunity_material_versions mv ON mv.id = a.opportunity_material_version_id
          JOIN commercial_quotes cq
            ON cq.opportunity_id = mv.opportunity_id
           AND cq.version_no = mv.version_no
          WHERE cq.id = $1
            AND mv.material_type = 'commercial_quote'
            AND mv.status = 'approved'
          ORDER BY a.uploaded_at ASC, a.id ASC
        `, [commercialQuoteId]),
        queryTarget.query(`
          SELECT item_name, specification, unit, quantity, unit_price, subtotal
          FROM quote_items WHERE quote_id = $1 ORDER BY id ASC
        `, [commercialQuoteId])
      ]);
      const row = componentResult.rows[0];
      if (!row) return null;
      return {
        technicalSolution: {
          id: Number(row.technical_id),
          status: row.technical_status,
          versionNo: numberOrNull(row.technical_version_no)
        },
        commercialQuote: {
          id: Number(row.quote_id),
          status: row.quote_status,
          versionNo: numberOrNull(row.quote_version_no),
          totalPrice: Number(row.total_price),
          paymentTerms: row.payment_terms || '',
          validityDate: row.validity_date,
          items: itemResult.rows.map((item) => ({
            itemName: item.item_name,
            specification: item.specification || '',
            unit: item.unit || '',
            quantity: Number(item.quantity),
            unitPrice: Number(item.unit_price),
            subtotal: Number(item.subtotal)
          }))
        },
        technicalDocuments: documentResult.rows.map((document) => ({
          id: Number(document.id),
          originalName: document.original_name,
          mimeType: document.mime_type,
          byteSize: Number(document.byte_size),
          sha256: document.sha256
        })),
        commercialAttachments: attachmentResult.rows.map((attachment) => ({
          id: Number(attachment.id),
          originalName: attachment.original_name,
          storedPath: attachment.stored_path,
          mimeType: attachment.mime_type,
          byteSize: Number(attachment.file_size)
        }))
      };
    },

    async createDraft(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock($1::bigint)
        ), next_revision AS (
          SELECT COALESCE((
            SELECT MAX(draft_revision_no) FROM quotation_package_versions WHERE opportunity_id = $1
          ), 0) + 1 AS draft_revision_no
          FROM opportunity_lock
        ), inserted AS (
          INSERT INTO quotation_package_versions (
            opportunity_id, source_package_id, draft_revision_no, status,
            technical_solution_version_id, commercial_quote_id, currency, total_price,
            delivery_period, payment_terms, valid_until, commercial_line_items,
            inclusions, exclusions, technical_assumptions,
            revision_reason, change_summary, created_by, updated_by
          )
          SELECT $1, $2, next_revision.draft_revision_no, 'draft',
            $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
            $11, $12, $13, $14, $15, $16, $16
          FROM next_revision
          RETURNING *
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, details)
          SELECT id, CASE WHEN source_package_id IS NULL THEN 'created' ELSE 'revision_created' END,
            $16, jsonb_build_object('draftRevisionNo', draft_revision_no, 'sourcePackageId', source_package_id)
          FROM inserted
        )
        SELECT * FROM inserted
      `, draftValues(input));
      return mapPackageRow(result.rows[0]);
    },

    async addAttachmentSnapshot(input) {
      const result = await queryTarget.query(`
        INSERT INTO quotation_package_attachments (
          quotation_package_id, source_type, technical_solution_document_id,
          attachment_id, original_name, mime_type, byte_size, sha256, display_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        input.quotationPackageId,
        input.sourceType,
        input.technicalSolutionDocumentId || null,
        input.attachmentId || null,
        input.originalName,
        input.mimeType,
        input.byteSize,
        input.sha256,
        input.displayOrder || 0
      ]);
      return mapAttachmentRow(result.rows[0]);
    },

    async updateDraft(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE quotation_package_versions
          SET technical_solution_version_id = $2,
              commercial_quote_id = $3,
              currency = $4,
              total_price = $5,
              delivery_period = $6,
              payment_terms = $7,
              valid_until = $8,
              commercial_line_items = $9::jsonb,
              inclusions = $10,
              exclusions = $11,
              technical_assumptions = $12,
              revision_reason = $13,
              change_summary = $14,
              updated_by = $15,
              updated_at = now()
          WHERE id = $1 AND status = 'draft'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id)
          SELECT id, 'updated', $15 FROM updated
        )
        SELECT * FROM updated
      `, [
        input.packageId,
        input.technicalSolutionVersionId,
        input.commercialQuoteId,
        input.currency,
        input.totalPrice,
        input.deliveryPeriod,
        input.paymentTerms,
        input.validUntil,
        JSON.stringify(input.commercialLineItems || []),
        input.inclusions || '',
        input.exclusions || '',
        input.technicalAssumptions || '',
        input.revisionReason || null,
        input.changeSummary || null,
        input.actorUserId
      ]);
      return mapPackageRow(result.rows[0]);
    },

    async replaceAttachmentSnapshots(packageId) {
      await queryTarget.query(`DELETE FROM quotation_package_attachments WHERE quotation_package_id = $1`, [packageId]);
    },

    async submitDraft({ packageId, actorUserId, comment }) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE quotation_package_versions
          SET status = 'pending', submitted_by = $2, submitted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1 AND status = 'draft'
            AND EXISTS (SELECT 1 FROM quotation_package_attachments a WHERE a.quotation_package_id = $1)
          RETURNING *
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, comment)
          SELECT id, 'submitted', $2, $3 FROM updated
        )
        SELECT * FROM updated
      `, [packageId, actorUserId, comment || null]);
      return mapPackageRow(result.rows[0]);
    },

    async approvePending({ packageId, actorUserId, comment }) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT id, opportunity_id FROM quotation_package_versions WHERE id = $1 AND status = 'pending'
        ), opportunity_lock AS (
          SELECT pg_advisory_xact_lock(opportunity_id) FROM target
        ), next_version AS (
          SELECT COALESCE(MAX(qp.version_no), 0) + 1 AS version_no
          FROM quotation_package_versions qp, target, opportunity_lock
          WHERE qp.opportunity_id = target.opportunity_id
        ), updated AS (
          UPDATE quotation_package_versions qp
          SET status = 'approved', version_no = next_version.version_no,
              reviewed_by = $2, reviewed_at = now(), review_comment = $3,
              updated_by = $2, updated_at = now()
          FROM next_version
          WHERE qp.id = $1 AND qp.status = 'pending'
          RETURNING qp.*
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, comment, details)
          SELECT id, 'approved', $2, $3, jsonb_build_object('versionNo', version_no) FROM updated
        )
        SELECT * FROM updated
      `, [packageId, actorUserId, comment || null]);
      return mapPackageRow(result.rows[0]);
    },

    async rejectPending({ packageId, actorUserId, comment }) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE quotation_package_versions
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_comment = $3,
              updated_by = $2, updated_at = now()
          WHERE id = $1 AND status = 'pending'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, comment)
          SELECT id, 'rejected', $2, $3 FROM updated
        )
        SELECT * FROM updated
      `, [packageId, actorUserId, comment]);
      return mapPackageRow(result.rows[0]);
    },

    async markSent({ packageId, actorUserId, comment, sentEmailMessageId = null }) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT candidate.id, candidate.opportunity_id
          FROM quotation_package_versions candidate
          WHERE candidate.id = $1
            AND candidate.status = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM quotation_package_versions accepted
              WHERE accepted.opportunity_id = candidate.opportunity_id AND accepted.status = 'accepted'
            )
        ), opportunity_lock AS (
          SELECT pg_advisory_xact_lock(opportunity_id) FROM target
        ), superseded AS (
          UPDATE quotation_package_versions qp
          SET status = 'superseded', superseded_at = now(), updated_by = $2, updated_at = now()
          FROM target, opportunity_lock
          WHERE qp.opportunity_id = target.opportunity_id AND qp.status = 'sent'
          RETURNING qp.id
        ), superseded_events AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, details)
          SELECT id, 'superseded', $2, jsonb_build_object('replacementPackageId', $1) FROM superseded
        ), updated AS (
          UPDATE quotation_package_versions qp
          SET status = 'sent', sent_by = $2, sent_at = now(), sent_email_message_id = $4,
              updated_by = $2, updated_at = now()
          FROM target
          WHERE qp.id = target.id
            AND NOT EXISTS (
              SELECT 1 FROM quotation_package_versions accepted
              WHERE accepted.opportunity_id = target.opportunity_id AND accepted.status = 'accepted'
            )
          RETURNING qp.*
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, comment)
          SELECT id, 'sent', $2, $3 FROM updated
        )
        SELECT * FROM updated
      `, [packageId, actorUserId, comment || null, sentEmailMessageId]);
      return mapPackageRow(result.rows[0]);
    },

    async acceptSent({ packageId, actorUserId, comment }) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE quotation_package_versions
          SET status = 'accepted', accepted_by = $2, accepted_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1 AND status = 'sent'
          RETURNING *
        ), linked AS (
          UPDATE opportunities o
          SET accepted_quotation_package_id = updated.id, updated_at = now()
          FROM updated WHERE o.id = updated.opportunity_id
        ), inserted_event AS (
          INSERT INTO quotation_package_events (quotation_package_id, event_type, actor_user_id, comment)
          SELECT id, 'accepted', $2, $3 FROM updated
        )
        SELECT * FROM updated
      `, [packageId, actorUserId, comment || null]);
      return mapPackageRow(result.rows[0]);
    },

    async findAcceptedByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${packageSelect}
        WHERE qp.opportunity_id = $1 AND qp.status = 'accepted'
        LIMIT 1
      `, [opportunityId]);
      return mapPackageRow(result.rows[0]);
    }
  };
}
