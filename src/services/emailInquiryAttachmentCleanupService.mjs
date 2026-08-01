import { removeStoredAttachmentFile, resolveStoredPath } from './attachmentFileService.mjs';

const cleanupStatuses = ['archived', 'spam'];

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function mapCandidate(row) {
  return {
    id: Number(row.id),
    inquiryId: Number(row.inquiry_id),
    inquiryStatus: row.inquiry_status,
    originalName: row.original_name || '',
    storedPath: row.stored_path || '',
    fileSize: numberValue(row.file_size)
  };
}

function summarize(candidates) {
  return {
    candidates: candidates.length,
    bytes: candidates.reduce((total, candidate) => total + candidate.fileSize, 0)
  };
}

export async function listNonInquiryEmailAttachmentCandidates(queryTarget) {
  const result = await queryTarget.query(`
    SELECT
      ia.id,
      ia.inquiry_id,
      i.status AS inquiry_status,
      ia.original_name,
      ia.stored_path,
      ia.file_size
    FROM inquiry_attachments ia
    JOIN inquiries i ON i.id = ia.inquiry_id
    WHERE i.source = 'email'
      AND i.status = ANY($1::text[])
    ORDER BY ia.id
  `, [cleanupStatuses]);
  return result.rows.map(mapCandidate);
}

export async function cleanupNonInquiryEmailAttachments({
  queryTarget,
  uploadDir,
  apply = false
}) {
  const candidates = await listNonInquiryEmailAttachmentCandidates(queryTarget);
  const summary = summarize(candidates);
  if (!apply || candidates.length === 0) {
    return {
      mode: apply ? 'apply' : 'dry-run',
      ...summary,
      deletedRecords: 0,
      deletedFiles: 0,
      skipped: []
    };
  }

  const deletedIds = [];
  const skipped = [];
  for (const candidate of candidates) {
    const filePath = resolveStoredPath(uploadDir, candidate.storedPath);
    if (!filePath) {
      skipped.push({
        id: candidate.id,
        inquiryId: candidate.inquiryId,
        reason: 'invalid_stored_path'
      });
      continue;
    }
    await removeStoredAttachmentFile(filePath);
    deletedIds.push(candidate.id);
  }

  let deletedRecords = 0;
  if (deletedIds.length > 0) {
    const result = await queryTarget.query(`
      DELETE FROM inquiry_attachments
      WHERE id = ANY($1::bigint[])
      RETURNING id
    `, [deletedIds]);
    deletedRecords = result.rowCount ?? result.rows.length;
  }

  return {
    mode: 'apply',
    ...summary,
    deletedRecords,
    deletedFiles: deletedIds.length,
    skipped
  };
}

export function nonInquiryEmailAttachmentCleanupStatuses() {
  return [...cleanupStatuses];
}
