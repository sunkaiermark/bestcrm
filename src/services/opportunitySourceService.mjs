import { canViewLeadSubmission } from './leadSubmissionService.mjs';
import { canViewInquiry } from './inquiryService.mjs';

export async function loadOpportunitySource({ opportunity, user, inquiryRepository, aiSourceRepository, emailArchiveRepository, aiSourceEnabled, emailCenterEnabled }) {
  if (!opportunity.originInquiryId || !inquiryRepository?.findById) return null;
  const lead = await inquiryRepository.findById(opportunity.originInquiryId);
  if (!lead) return null;
  const leadUrl = lead.submissionType==='sales_lead'
    ? (canViewLeadSubmission(user, lead) ? `/lead-submissions/${lead.id}` : null)
    : (canViewInquiry(user) ? `/inquiries/${lead.id}` : null);
  const result = { leadId: lead.id, leadUrl, leadAnalysis: leadUrl ? lead.rawPayload?.leadAnalysis || null : null, kind: 'unknown', creatorName: '', createdAt: null, links: [] };
  // Origin follows the persisted lead relationship, not an opportunity link or payload label.
  const origins = await aiSourceRepository?.findOriginsByLead?.(lead.id) || [];
  if (origins.length) {
    result.kind = 'ai';
    const canUse = user.isActive !== false && user.roles?.some(r => ['administrator', 'sales_manager', 'salesperson'].includes(r));
    const manager = user.roles?.some(r => ['administrator', 'sales_manager'].includes(r));
    if (aiSourceEnabled && canUse) result.links = origins.filter(s => s.retention !== 'deleted' && (manager || Number(s.assigned_user_id) === Number(user.id))).map(s => ({ kind: 'ai', url: `/ai-sources/${s.id}` }));
    return result;
  }
  const thread = await emailArchiveRepository?.findLatestThreadByInquiry?.(lead.id);
  const originalMail = thread && Number(thread.inquiryId) === Number(lead.id) && Number(lead.rawPayload?.emailThreadId) === Number(thread.id);
  if (lead.source === 'email' || lead.sourceChannel === 'email' || originalMail) {
    result.kind = 'email';
    if (thread && Number(thread.inquiryId) === Number(lead.id) && emailCenterEnabled && leadUrl) result.links.push({ kind: 'email', url: `/email-center/threads/${thread.id}` });
  } else if (lead.source === 'manual') {
    result.kind = 'manual'; result.creatorName = lead.createdByDisplayName || ''; result.createdAt = lead.createdAt || null;
  } else if (lead.source === 'website') result.kind = 'website';
  else if (lead.source === 'chatwoot') result.kind = 'chat';
  return result;
}
