import { createHash } from 'node:crypto';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { canViewLeadSubmission } from './leadSubmissionService.mjs';
import { customerAnalysisContext } from '../domain/leadAnalysis.mjs';

export function canManageConvertedLeadReport(actor, lead) {
  return canViewLeadSubmission(actor, lead)
    && lead.status === 'converted' && Number(lead.convertedOpportunityId) > 0
    && (hasRole(actor, ROLES.ADMINISTRATOR)
      || Number(lead.createdBy) === Number(actor.id)
      || (hasRole(actor, ROLES.SALES_MANAGER) && Number(lead.assignedUserId) === Number(actor.id)));
}

export function savedLeadReportContext(lead) {
  return customerAnalysisContext({ ...lead.rawPayload?.leadAnalysis,
    companyName: lead.companyName, companyWebsite: lead.companyWebsite,
    subject: lead.subject, productInterest: lead.productInterest, requirementText: lead.requirementText,
    confirmedProductCategoryCodes: lead.confirmedProductCategoryCodes || [] });
}

export function savedLeadReportRevision(lead) {
  return createHash('sha256').update(JSON.stringify({
    context: savedLeadReportContext(lead), opportunityId: lead.convertedOpportunityId,
    analysis: lead.rawPayload?.leadAnalysis || {}
  })).digest('hex');
}

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { statusCode });
}

export async function saveConvertedLeadReport(repository, actor, lead, input, draft) {
  if (!canManageConvertedLeadReport(actor, lead)) fail('Forbidden', 403);
  if (input.reportReviewed !== '1') fail('请人工审阅客户分析报告后再保存。');
  const report = String(input.customerAnalysisReport || '').trim();
  if (!report || report.length > 30000) fail('客户分析报告必填，最多30000字符。');
  const revision = savedLeadReportRevision(lead);
  if (input.reportRevision !== revision) fail('线索分析已有更新，请刷新后重新审阅。', 409);
  if (input.reportGenerationToken && (!draft
      || draft.token !== input.reportGenerationToken || Number(draft.actorId) !== Number(actor.id)
      || Number(draft.leadId) !== Number(lead.id) || draft.revision !== revision)) {
    fail('报告草稿已过期或线索内容已变化，请重新生成并审阅。', 409);
  }
  const previous = lead.rawPayload?.leadAnalysis || {};
  const now = new Date().toISOString();
  const analysis = { ...previous, customerAnalysisReport: report,
    reviewedBy: Number(actor.id), reviewedAt: now,
    history: [...(previous.history || []), {
      customerAnalysisReport: report, reviewedBy: Number(actor.id), reviewedAt: now,
      action: 'customer_report_updated',
      ...(input.reportGenerationToken ? { ai: { report: draft.report } } : {})
    }].slice(-20) };
  const saved = await repository.updateConvertedLeadReport(lead.id, {
    analysis, previousAnalysis: previous, convertedOpportunityId: lead.convertedOpportunityId,
    companyName: lead.companyName || '', companyWebsite: lead.companyWebsite || '',
    requirementText: lead.requirementText || '', productInterest: lead.productInterest || '',
    subject: lead.subject || '', confirmedProductCategoryCodes: lead.confirmedProductCategoryCodes || []
  });
  if (!saved) fail('线索分析已有更新，请刷新后重新审阅。', 409);
  return saved;
}
