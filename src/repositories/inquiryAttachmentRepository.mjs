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
    sha256: row.sha256 || null,
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
    sha256,
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
          cid,
          sha256
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
        input.cid || '',
        input.sha256
      ]);
      return mapInquiryAttachmentRow(result.rows[0]);
    },

    async createAttachments(inputs = []) {
      if (!inputs.length) return [];
      const payload = inputs.map((input) => ({
        inquiry_id: input.inquiryId,
        source_index: input.sourceIndex,
        original_name: input.originalName,
        stored_path: input.storedPath,
        mime_type: input.mimeType,
        file_size: input.fileSize,
        cid: input.cid || '',
        sha256: input.sha256
      }));
      const result = await queryTarget.query(`
        INSERT INTO inquiry_attachments (
          inquiry_id,
          source_index,
          original_name,
          stored_path,
          mime_type,
          file_size,
          cid,
          sha256
        )
        SELECT
          item.inquiry_id,
          item.source_index,
          item.original_name,
          item.stored_path,
          item.mime_type,
          item.file_size,
          item.cid,
          item.sha256
        FROM jsonb_to_recordset($1::jsonb) AS item(
          inquiry_id bigint,
          source_index integer,
          original_name text,
          stored_path text,
          mime_type text,
          file_size bigint,
          cid text,
          sha256 text
        )
        RETURNING *
      `, [JSON.stringify(payload)]);
      return result.rows.map(mapInquiryAttachmentRow)
        .sort((left, right) => left.sourceIndex - right.sourceIndex);
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
