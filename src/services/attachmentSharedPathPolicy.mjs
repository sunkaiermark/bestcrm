const sha256Pattern = /^[a-f0-9]{64}$/;

export function isApprovedInquiryOpportunitySharedPath(records) {
  if (!Array.isArray(records) || records.length < 2) return false;
  const inquiries = records.filter((record) => record.model === 'inquiry_attachment');
  if (inquiries.length !== 1) return false;
  const inquiry = inquiries[0];
  if (!Number.isSafeInteger(inquiry.recordId) || inquiry.recordId <= 0
      || !Number.isSafeInteger(inquiry.size) || inquiry.size < 0
      || !sha256Pattern.test(inquiry.sha256 || '')
      || inquiry.verified !== true) return false;
  return records.every((record) => record === inquiry || (
    record.model === 'opportunity_attachment'
    && Number.isSafeInteger(record.recordId) && record.recordId > 0
    && record.sourceInquiryAttachmentId === inquiry.recordId
    && record.size === inquiry.size
    && record.sha256 === inquiry.sha256
    && record.verified === true
  ));
}

export function unexpectedSharedAttachmentPaths(records) {
  const byPath = new Map();
  for (const record of records) {
    const group = byPath.get(record.storedPath) || [];
    group.push(record);
    byPath.set(record.storedPath, group);
  }
  return new Set([...byPath].filter(([, group]) => (
    group.length > 1 && !isApprovedInquiryOpportunitySharedPath(group)
  )).map(([storedPath]) => storedPath));
}
