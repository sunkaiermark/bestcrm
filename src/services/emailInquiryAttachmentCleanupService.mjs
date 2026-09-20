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
    fileSize: numberValue(row.file_size),
    sha256: row.sha256 || null
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
      ia.file_size,
      ia.sha256
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
  attachmentIntegrityRepository,
  actorUserId,
  apply = false
}) {
  const candidates = await listNonInquiryEmailAttachmentCandidates(queryTarget);
  const summary = summarize(candidates);
  if (!apply || candidates.length === 0) {
    return {
      mode: apply ? 'apply' : 'dry-run',
      ...summary,
      plannedInquiries: 0,
      purgedRecords: 0,
      queuedFiles: 0,
      purgeAuditIds: [],
      skipped: []
    };
  }

  if (typeof attachmentIntegrityRepository?.planInquiryAttachmentPurge !== 'function') {
    throw new Error('Inquiry attachment purge repository is not configured');
  }
  const parsedActorUserId = Number(actorUserId);
  if (!Number.isSafeInteger(parsedActorUserId) || parsedActorUserId <= 0) {
    throw new Error('actorUserId is required for attachment cleanup');
  }

  const inquiries = new Map();
  for (const candidate of candidates) {
    if (!inquiries.has(candidate.inquiryId)) {
      inquiries.set(candidate.inquiryId, candidate.inquiryStatus);
    }
  }
  const purgeAuditIds = [];
  let purgedRecords = 0;
  let queuedFiles = 0;
  const skipped = [];
  for (const [inquiryId, inquiryStatus] of inquiries) {
    try {
      const planned = await attachmentIntegrityRepository.planInquiryAttachmentPurge({
        inquiryId,
        actorUserId: parsedActorUserId,
        reason: `non_business_email_attachment_cleanup:${inquiryStatus}`,
        deleteInquiry: false
      });
      purgeAuditIds.push(Number(planned.purgeAuditId));
      purgedRecords += Number(planned.attachmentCount || 0);
      queuedFiles += Number(planned.fileJobCount || 0);
    } catch (error) {
      skipped.push({
        inquiryId,
        reason: String(error?.code || 'purge_planning_failed')
      });
    }
  }

  return {
    mode: 'apply',
    ...summary,
    plannedInquiries: purgeAuditIds.length,
    purgedRecords,
    queuedFiles,
    purgeAuditIds,
    skipped
  };
}

export function nonInquiryEmailAttachmentCleanupStatuses() {
  return [...cleanupStatuses];
}
