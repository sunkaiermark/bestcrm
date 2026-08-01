import { normalizeUploadedFilename } from '../utils/filenameEncoding.mjs';

function mapInquiryAttachmentRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    inquiryId: Number(row.inquiry_id),
    sourceIndex: Number(row.source_index),
    originalName: normalizeUploadedFilename(row.original_name),
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    cid: row.cid || '',
    uploadedAt: row.uploaded_at
  };
}

const inquiryAttachmentSelect = `
  SELECT
    id,
    inquiry_id,
    source_index,
    original_name,
    stored_path,
    mime_type,
    file_size,
    cid,
    uploaded_at
  FROM inquiry_attachments
`;

export function createInquiryAttachmentRepository(queryTarget) {
  return {
    async createAttachment(input) {
      const result = await queryTarget.query(`
        INSERT INTO inquiry_attachments (
          inquiry_id,
          source_index,
          original_name,
          stored_path,
          mime_type,
          file_size,
          cid
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (inquiry_id, source_index)
        DO NOTHING
        RETURNING *
      `, [
        input.inquiryId,
        input.sourceIndex,
        input.originalName,
        input.storedPath,
        input.mimeType,
        input.fileSize,
        input.cid || ''
      ]);
      return mapInquiryAttachmentRow(result.rows[0]);
    },

    async listByInquiry(inquiryId) {
      const result = await queryTarget.query(`
        ${inquiryAttachmentSelect}
        WHERE inquiry_id = $1
        ORDER BY uploaded_at DESC, id DESC
      `, [inquiryId]);
      return result.rows.map(mapInquiryAttachmentRow);
    },

    async findById(id) {
      const result = await queryTarget.query(`
        ${inquiryAttachmentSelect}
        WHERE id = $1
        LIMIT 1
      `, [id]);
      return mapInquiryAttachmentRow(result.rows[0]);
    }
  };
}
