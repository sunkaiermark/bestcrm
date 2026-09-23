import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapAttachmentRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    category: row.category,
    originalName: normalizeUploadedFilename(row.original_name),
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    sha256: row.sha256 || null,
    sourceInquiryAttachmentId: numberOrNull(row.source_inquiry_attachment_id),
    uploadedBy: Number(row.uploaded_by),
    uploaderDisplayName: row.uploader_display_name || '',
    uploadedAt: row.uploaded_at,
    opportunityMaterialVersionId: numberOrNull(row.opportunity_material_version_id),
    retiredAt: row.retired_at || null,
    retiredBy: numberOrNull(row.retired_by),
    retirementReason: row.retirement_reason || '',
    replacedByAttachmentId: numberOrNull(row.replaced_by_attachment_id)
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
    a.sha256,
    a.source_inquiry_attachment_id,
    a.uploaded_by,
    uploader.display_name AS uploader_display_name,
    a.uploaded_at,
    a.opportunity_material_version_id,
    a.retired_at,
    a.retired_by,
    a.retirement_reason,
    a.replaced_by_attachment_id
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
          uploaded_by,
          source_inquiry_attachment_id,
          sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        input.opportunityId,
        input.category,
        input.originalName,
        input.storedPath,
        input.mimeType,
        input.fileSize,
        input.uploadedBy,
        input.sourceInquiryAttachmentId || null,
        input.sha256
      ]);
      return mapAttachmentRow(result.rows[0]);
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${attachmentSelect}
        WHERE a.opportunity_id = $1
          AND a.retired_at IS NULL
        ORDER BY a.uploaded_at DESC, a.id DESC
      `, [opportunityId]);
      return result.rows.map(mapAttachmentRow);
    },

    async listHistoryByOpportunity(opportunityId) {
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

    async retireById({ id, actorUserId, reason, replacedByAttachmentId = null }) {
      const result = await queryTarget.query(`
        UPDATE attachments
        SET retired_at = now(),
            retired_by = $2,
            retirement_reason = $3,
            replaced_by_attachment_id = $4
        WHERE id = $1
          AND retired_at IS NULL
        RETURNING *
      `, [id, actorUserId, reason, replacedByAttachmentId]);
      return mapAttachmentRow(result.rows[0]);
    },

    async replaceAttachment({ originalAttachmentId, actorUserId, reason, replacement }) {
      const result = await queryTarget.query(`
        WITH original AS MATERIALIZED (
          SELECT id, opportunity_id
          FROM attachments
          WHERE id = $1
            AND retired_at IS NULL
          FOR UPDATE
        ), replacement AS (
          INSERT INTO attachments (
            opportunity_id,
            category,
            original_name,
            stored_path,
            mime_type,
            file_size,
            uploaded_by,
            source_inquiry_attachment_id,
            sha256
          )
          SELECT $4, $5, $6, $7, $8, $9, $10, $11, $12
          FROM original
          WHERE original.opportunity_id = $4
          RETURNING *
        ), retired AS (
          UPDATE attachments AS prior
          SET retired_at = now(),
              retired_by = $2,
              retirement_reason = $3,
              replaced_by_attachment_id = replacement.id
          FROM replacement
          WHERE prior.id = $1
            AND prior.retired_at IS NULL
            AND prior.opportunity_id = replacement.opportunity_id
          RETURNING replacement.id AS replacement_id
        )
        SELECT replacement.*
        FROM replacement
        JOIN retired ON retired.replacement_id = replacement.id
      `, [
        originalAttachmentId,
        actorUserId,
        reason,
        replacement.opportunityId,
        replacement.category,
        replacement.originalName,
        replacement.storedPath,
        replacement.mimeType,
        replacement.fileSize,
        replacement.uploadedBy,
        replacement.sourceInquiryAttachmentId || null,
        replacement.sha256
      ]);
      return mapAttachmentRow(result.rows[0]);
    },

    async bindUnboundToMaterialVersion(input) {
      const result = await queryTarget.query(`
        UPDATE attachments
        SET opportunity_material_version_id = $3
        WHERE opportunity_id = $1
          AND category = $2
          AND opportunity_material_version_id IS NULL
          AND retired_at IS NULL
        RETURNING id
      `, [
        input.opportunityId,
        input.category,
        input.opportunityMaterialVersionId
      ]);
      return result.rows.map((row) => Number(row.id));
    },

    async bindSelectedToMaterialVersion(input) {
      const result = await queryTarget.query(`
        UPDATE attachments
        SET opportunity_material_version_id = $3
        WHERE id = $1
          AND opportunity_id = $2
          AND category = 'technical_solution'
          AND opportunity_material_version_id IS NULL
          AND retired_at IS NULL
        RETURNING id
      `, [input.attachmentId, input.opportunityId, input.opportunityMaterialVersionId]);
      return result.rows.length === 1;
    }
  };
}
