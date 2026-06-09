import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

function mapAttachmentRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    category: row.category,
    originalName: normalizeUploadedFilename(row.original_name),
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    uploadedBy: Number(row.uploaded_by),
    uploaderDisplayName: row.uploader_display_name || '',
    uploadedAt: row.uploaded_at,
    opportunityMaterialVersionId: row.opportunity_material_version_id === null || row.opportunity_material_version_id === undefined
      ? null
      : Number(row.opportunity_material_version_id)
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
    a.uploaded_at,
    a.opportunity_material_version_id
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

    async bindUnboundToMaterialVersion(input) {
      const result = await queryTarget.query(`
        UPDATE attachments
        SET opportunity_material_version_id = $3
        WHERE opportunity_id = $1
          AND category = $2
          AND opportunity_material_version_id IS NULL
        RETURNING id
      `, [
        input.opportunityId,
        input.category,
        input.opportunityMaterialVersionId
      ]);
      return result.rows.map((row) => Number(row.id));
    }
  };
}
