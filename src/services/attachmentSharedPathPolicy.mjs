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

export function isApprovedWorkPackageSnapshotSharedPath(records) {
  if(!Array.isArray(records)||records.length<2)return false;
  const first=records[0],ids=new Map(records.map(r=>[r.recordId,r]));
  if(!Number.isSafeInteger(first.opportunityId)||first.opportunityId<=0||ids.size!==records.length)return false;
  if(records.some(r=>r.model!=='opportunity_attachment'||!Number.isSafeInteger(r.recordId)||r.recordId<=0||r.opportunityId!==first.opportunityId||r.storedPath!==first.storedPath||r.size!==first.size||!Number.isSafeInteger(r.size)||r.size<0||r.sha256!==first.sha256||!sha256Pattern.test(r.sha256||'')||r.verified!==true||!['active','retired'].includes(r.lifecycleState)))return false;
  const roots=records.filter(r=>!r.sharedSourceAttachmentIds?.length);
  if(roots.length!==1)return false;
  const reachesRoot=(id,seen=new Set())=>{
    if(seen.has(id)||!ids.has(id))return false;
    if(id===roots[0].recordId)return true;
    const next=new Set(seen);next.add(id);
    const sources=ids.get(id).sharedSourceAttachmentIds;
    return Array.isArray(sources)&&sources.length>0&&new Set(sources).size===sources.length&&sources.every(parent=>Number.isSafeInteger(parent)&&parent!==id&&reachesRoot(parent,next));
  };
  return records.every(r=>reachesRoot(r.recordId));
}

export function unexpectedSharedAttachmentPaths(records) {
  const byPath = new Map();
  for (const record of records) {
    const group = byPath.get(record.storedPath) || [];
    group.push(record);
    byPath.set(record.storedPath, group);
  }
  return new Set([...byPath].filter(([, group]) => (
    group.length > 1 && !isApprovedInquiryOpportunitySharedPath(group) && !isApprovedWorkPackageSnapshotSharedPath(group)
  )).map(([storedPath]) => storedPath));
}
