import { createHash } from 'node:crypto';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { quotationPackageLabel } from '../repositories/quotationPackageRepository.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';
import { isProjectLeadEngineer } from './opportunityService.mjs';

const PACKAGE_TYPES = new Set(['technical', 'commercial']);
const RESOLVED_DEVIATION_STATUSES = new Set(['compliant', 'approved_deviation', 'not_applicable', 'closed']);

function fail(message, statusCode = 400, code = BID_CENTER_ERROR_CODES.VALIDATION, details = []) {
  const error = new BidCenterServiceError(message, { statusCode, code });
  error.details = details;
  throw error;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`${field} is invalid`);
  return number;
}

function requiredText(value, field, maxLength = 2000) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail(`${field} is required`);
  if (normalized.length > maxLength) fail(`${field} is too long`);
  return normalized;
}

function optionalText(value, maxLength = 5000) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > maxLength) fail('Submitted text is too long');
  return normalized;
}

function blank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function visibleUserId(actor) {
  return hasRole(actor, ROLES.ADMINISTRATOR) ? null : positiveInteger(actor.id, 'User');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function snapshotHash(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function issue(code, message, extra = {}) {
  return { code, message, ...extra };
}

function packageSource(packageType, source) {
  if (packageType === 'technical') return { technicalDraftId: source.id };
  if (packageType === 'commercial') return { commercialDraftId: source.id };
  return { quotationPackageId: source.id };
}

function packageLabel(packageType, source) {
  if (packageType === 'technical') return source.formalVersionLabel || source.draftLabel || `TS-D${source.draftRevisionNo}`;
  if (packageType === 'commercial') return source.formalVersionLabel || source.draftLabel || `CP-D${source.draftRevisionNo}`;
  return source.label || quotationPackageLabel(source);
}

function activeSections(draft) {
  return (draft.renderedContent?.sections || []).filter((section) => section.included !== false);
}

function requiredSectionKeys(draft) {
  return new Set((draft.contentSchemaSnapshot?.sections || [])
    .filter((section) => section.required === true || section.isRequired === true)
    .map((section) => section.key));
}

function collectDeviationIssues(value, issues, path = 'content') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDeviationIssues(item, issues, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const candidate = String(value.complianceStatus ?? value.deviationStatus ?? '').trim().toLowerCase();
  if (candidate && !RESOLVED_DEVIATION_STATUSES.has(candidate)) {
    issues.push(issue('unresolved_deviation', `Deviation at ${path} is not resolved`, { path, status: candidate }));
  }
  for (const [key, child] of Object.entries(value)) collectDeviationIssues(child, issues, `${path}.${key}`);
}

function sectionIssues(draft, changes, attachments) {
  const issues = [];
  const sections = draft.renderedContent?.sections || [];
  const activeByKey = new Map(activeSections(draft).map((section) => [section.key, section]));
  for (const sectionKey of requiredSectionKeys(draft)) {
    if (!activeByKey.has(sectionKey)) {
      issues.push(issue('required_section_missing', `Required section ${sectionKey} is omitted`, { sectionKey }));
    }
  }
  for (const section of sections) {
    if (section.modificationStatus === 'needs_review') {
      issues.push(issue('section_needs_review', `Section ${section.key} still needs review`, { sectionKey: section.key }));
    }
    const modified = section.projectAdded === true
      || section.included === false
      || section.standardChanged === true
      || ['customized', 'project_added', 'omitted', 'needs_review'].includes(section.modificationStatus);
    if (modified && !changes.some((change) => change.sectionKey === section.key && !blank(change.reason))) {
      issues.push(issue('change_reason_missing', `Section ${section.key} has no auditable change reason`, { sectionKey: section.key }));
    }
    const baseline = (draft.contentSchemaSnapshot?.sections || []).find((item) => item.key === section.key);
    const requiresAttachment = section.requiredAttachment === true
      || baseline?.requiredAttachment === true
      || ((section.sectionType === 'controlled_attachment' || baseline?.sectionType === 'controlled_attachment')
        && (section.required === true || baseline?.required === true));
    if (section.included !== false && requiresAttachment
        && !attachments.some((attachment) => attachment.sectionKey === section.key && !attachment.removedAt)) {
      issues.push(issue('required_attachment_missing', `Section ${section.key} requires an attachment`, { sectionKey: section.key }));
    }
  }
  const renderedText = JSON.stringify(draft.renderedContent || {});
  if (/\{\{[^{}]+\}\}|<<[^<>]+>>/.test(renderedText)) {
    issues.push(issue('unresolved_placeholder', 'The package contains unresolved placeholders'));
  }
  collectDeviationIssues(draft.renderedContent, issues);
  return issues;
}

function variableIssues(draft) {
  const issues = (draft.validationIssues || []).map((item) => issue(
    item.code || 'variable_validation',
    `Variable ${item.variableKey || item.labelEn || item.labelZh || 'value'} is invalid`,
    item
  ));
  for (const variable of draft.variableSchemaSnapshot || []) {
    if (variable.isRequired === true && blank(draft.variableValues?.[variable.variableKey])
        && !issues.some((item) => item.variableKey === variable.variableKey && item.code === 'required')) {
      issues.push(issue('required', `Variable ${variable.variableKey} is required`, {
        variableKey: variable.variableKey,
        sectionKey: variable.sectionKey
      }));
    }
  }
  return issues;
}

function sourceFieldValue(draft, sourceField) {
  const variable = (draft.variableSchemaSnapshot || []).find((item) => (
    item.sourceField === sourceField || item.variableKey === sourceField
  ));
  return variable ? draft.variableValues?.[variable.variableKey] : undefined;
}

function moneyEqual(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) < 0.005;
}

function quoteConsistencyIssues(draft, quote) {
  const issues = [];
  if (!quote || quote.status !== 'approved' || !quote.versionNo) {
    return [issue('approved_quote_missing', 'An approved commercial quote is required')];
  }
  const total = sourceFieldValue(draft, 'total_price');
  if (blank(total) || !moneyEqual(total, quote.totalPrice)) {
    issues.push(issue('total_price_mismatch', 'Commercial package total does not match the approved quote', {
      expected: quote.totalPrice,
      actual: total
    }));
  }
  const itemTotal = (quote.items || []).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  if (quote.items?.length && !moneyEqual(itemTotal, quote.totalPrice)) {
    issues.push(issue('line_item_total_mismatch', 'Approved quote line items do not add up to the approved total', {
      expected: quote.totalPrice,
      actual: itemTotal
    }));
  }
  const exactSources = [
    ['payment_terms', quote.paymentTerms],
    ['quotation_validity', quote.validityDate]
  ];
  for (const [sourceField, expected] of exactSources) {
    const value = sourceFieldValue(draft, sourceField);
    if (value !== undefined && String(value || '').trim() !== String(expected || '').trim()) {
      issues.push(issue(`${sourceField}_mismatch`, `${sourceField} does not match the approved quote`, {
        expected, actual: value
      }));
    }
  }
  return issues;
}

function baseSnapshot(packageType, source, attachments) {
  return {
    packageType,
    sourceId: source.id,
    status: source.status,
    variableValues: source.variableValues || {},
    selectedClauses: source.selectedClauses || [],
    renderedContent: source.renderedContent || {},
    technicalSolutionVersionId: source.technicalSolutionVersionId || null,
    commercialDraftId: source.commercialDraftId || null,
    commercialQuoteId: source.commercialQuoteId || null,
    totalPrice: source.totalPrice || null,
    currency: source.currency || null,
    deliveryPeriod: source.deliveryPeriod || null,
    paymentTerms: source.paymentTerms || null,
    validUntil: source.validUntil || null,
    attachmentHashes: attachments.filter((item) => !item.removedAt).map((item) => item.sha256).sort()
  };
}

function commercialViewer(actor, opportunity) {
  if (hasRole(actor, ROLES.ADMINISTRATOR)) return true;
  const actorId = Number(actor.id);
  return (hasRole(actor, ROLES.SALESPERSON) && Number(opportunity.salespersonId) === actorId)
    || (hasRole(actor, ROLES.SALES_MANAGER) && Number(opportunity.salesManagerId) === actorId)
    || (hasRole(actor, ROLES.QUOTATION_ENGINEER) && Number(opportunity.quotationEngineerId) === actorId)
    || (hasRole(actor, ROLES.COMMERCIAL_MANAGER) && Number(opportunity.commercialManagerId) === actorId)
    || [ROLES.LEGAL_REVIEWER, ROLES.FINANCE_REVIEWER, ROLES.GENERAL_MANAGER]
      .some((role) => hasRole(actor, role));
}

function canSubmit(actor, opportunity, packageType) {
  if (packageType === 'technical') return isProjectLeadEngineer(actor, opportunity);
  return hasRole(actor, ROLES.QUOTATION_ENGINEER)
    && Number(opportunity.quotationEngineerId) === Number(actor.id);
}

function canReview(actor, opportunity, packageType, source) {
  const actorId = Number(actor.id);
  if (Number(source.submittedBy) === actorId) return false;
  if (packageType === 'technical') {
    return hasRole(actor, ROLES.TECHNICAL_MANAGER)
      && Number(opportunity.technicalManagerId) === actorId;
  }
  if (packageType === 'commercial') {
    return hasRole(actor, ROLES.COMMERCIAL_MANAGER)
      && Number(opportunity.commercialManagerId) === actorId;
  }
  return hasRole(actor, ROLES.SALES_MANAGER)
    && Number(opportunity.salesManagerId) === actorId;
}

function completeAssembler(actor, opportunity) {
  return isProjectLeadEngineer(actor, opportunity);
}

function reviewerId(opportunity, packageType) {
  if (packageType === 'technical') return opportunity.technicalManagerId;
  if (packageType === 'commercial') return opportunity.commercialManagerId;
  return opportunity.salesManagerId;
}

function todoTitle(action, packageType, source) {
  const typeLabel = packageType === 'technical' ? 'technical package'
    : packageType === 'commercial' ? 'commercial package' : 'complete bid';
  return `${action} ${typeLabel} ${packageLabel(packageType, source)}`;
}

function changeSummary(current, previous, currentAttachments = [], previousAttachments = [], packageType = null) {
  if (!previous) return null;
  const changedVariables = [...new Set([
    ...Object.keys(previous.variableValues || {}), ...Object.keys(current.variableValues || {})
  ])].filter((key) => JSON.stringify(previous.variableValues?.[key]) !== JSON.stringify(current.variableValues?.[key]));
  const previousSections = new Map((previous.renderedContent?.sections || []).map((section) => [section.key, section]));
  const currentSections = new Map((current.renderedContent?.sections || []).map((section) => [section.key, section]));
  const changedSections = [...new Set([...previousSections.keys(), ...currentSections.keys()])]
    .filter((key) => JSON.stringify(stableValue(previousSections.get(key))) !== JSON.stringify(stableValue(currentSections.get(key))));
  const previousClauses = (previous.selectedClauses || []).map((item) => `${item.id}:${item.revisionNo || ''}`).sort();
  const currentClauses = (current.selectedClauses || []).map((item) => `${item.id}:${item.revisionNo || ''}`).sort();
  const previousMaterials = (previous.renderedContent?.sections || [])
    .flatMap((section) => section.contentBlocks || []).map((item) => `${item.blockId}:${item.revisionId}`).sort();
  const currentMaterials = (current.renderedContent?.sections || [])
    .flatMap((section) => section.contentBlocks || []).map((item) => `${item.blockId}:${item.revisionId}`).sort();
  const previousHashes = previousAttachments.map((item) => item.sha256).sort();
  const currentHashes = currentAttachments.map((item) => item.sha256).sort();
  const changedFields = ['technicalSolutionVersionId', 'commercialDraftId', 'commercialQuoteId', 'currency',
    'totalPrice', 'deliveryPeriod', 'paymentTerms', 'validUntil', 'revisionReason', 'changeSummary']
    .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null));
  return {
    from: packageLabel(packageType || (current.technicalSolutionVersionId ? 'complete' : 'technical'), previous),
    changedVariables,
    changedSections,
    clausesChanged: JSON.stringify(previousClauses) !== JSON.stringify(currentClauses),
    publicMaterialsChanged: JSON.stringify(previousMaterials) !== JSON.stringify(currentMaterials),
    attachmentHashesChanged: JSON.stringify(previousHashes) !== JSON.stringify(currentHashes),
    changedFields
  };
}

export function createBidPackageApprovalService({ enabled = false, dependencies }) {
  function assertEnabled() {
    if (enabled !== true) fail('Bid center is disabled', 404, BID_CENTER_ERROR_CODES.DISABLED);
  }

  async function workspace(actor, workspaceId) {
    assertEnabled();
    const result = await dependencies.bidWorkspaceRepository.getWorkspaceDetail(
      positiveInteger(workspaceId, 'Bid workspace'),
      { visibleToUserId: visibleUserId(actor) }
    );
    if (!result) fail('Bid workspace not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
      ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(result.opportunity.id)
      : [];
    result.opportunity.teamMembers = teamMembers;
    return result;
  }

  async function listTechnicalVersions(result) {
    if (typeof dependencies.opportunityTechnicalDraftRepository.listByOpportunity === 'function') {
      return dependencies.opportunityTechnicalDraftRepository.listByOpportunity(result.opportunity.id);
    }
    if (!result.technicalDraft?.id) return [];
    const detail = await dependencies.opportunityTechnicalDraftRepository.getDraftDetail(result.technicalDraft.id);
    return detail ? [detail] : [];
  }

  async function listCommercialVersions(result) {
    if (typeof dependencies.opportunityCommercialDraftRepository.listByWorkspace === 'function') {
      return dependencies.opportunityCommercialDraftRepository.listByWorkspace(result.id);
    }
    if (!result.commercialDraft?.id) return [];
    const detail = await dependencies.opportunityCommercialDraftRepository.getDraftDetail(result.commercialDraft.id);
    return detail ? [detail] : [];
  }

  async function packageContext(actor, workspaceId, packageType) {
    if (!PACKAGE_TYPES.has(packageType)) fail('Package type is invalid');
    const result = await workspace(actor, workspaceId);
    if (packageType === 'commercial' && !commercialViewer(actor, result.opportunity)) {
      fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    }
    const versions = packageType === 'technical'
      ? await listTechnicalVersions(result)
      : await listCommercialVersions(result);
    const source = versions[0];
    if (!source) fail('Package draft not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const detail = packageType === 'technical'
      ? await dependencies.opportunityTechnicalDraftRepository.getDraftDetail(source.id)
      : await dependencies.opportunityCommercialDraftRepository.getDraftDetail(source.id);
    return { workspace: result, source: detail, versions };
  }

  async function quoteContext(result) {
    const quoteId = Number(result.sourceMetadata?.opportunity?.approvedCommercialQuoteId);
    if (!Number.isInteger(quoteId) || quoteId < 1) return null;
    return dependencies.quotationPackageRepository.getCommercialQuoteContext({
      opportunityId: result.opportunity.id,
      commercialQuoteId: quoteId
    });
  }

  async function computeDraftCheck(result, packageType, source) {
    const sourceIds = packageSource(packageType, source);
    const [changes, attachments] = await Promise.all([
      dependencies.bidPackageEditorRepository.listChanges({
        workspaceId: result.id, packageType, ...sourceIds
      }),
      dependencies.bidPackageEditorRepository.listAttachments({
        workspaceId: result.id, packageType, ...sourceIds
      })
    ]);
    const issues = [...variableIssues(source), ...sectionIssues(source, changes, attachments)];
    let quote = null;
    if (packageType === 'commercial') {
      quote = await quoteContext(result);
      issues.push(...quoteConsistencyIssues(source, quote));
    }
    return {
      passed: issues.length === 0,
      issues,
      snapshotSha256: snapshotHash({ ...baseSnapshot(packageType, source, attachments), quote }),
      attachments,
      quote
    };
  }

  async function recordCheck(actor, result, packageType, source, check) {
    const input = {
      workspaceId: result.id,
      packageType,
      ...packageSource(packageType, source),
      passed: check.passed,
      issues: check.issues,
      snapshotSha256: check.snapshotSha256,
      actorUserId: Number(actor.id)
    };
    const saved = await dependencies.bidPackageApprovalRepository.createCompletenessCheck(input);
    await dependencies.bidPackageEditorRepository.insertEvent({
      ...input,
      eventType: 'completeness_checked',
      details: { passed: check.passed, issueCount: check.issues.length, snapshotSha256: check.snapshotSha256 }
    });
    return saved;
  }

  async function checkPackage(actor, workspaceId, packageType) {
    const context = await packageContext(actor, workspaceId, packageType);
    const check = await computeDraftCheck(context.workspace, packageType, context.source);
    const saved = await recordCheck(actor, context.workspace, packageType, context.source, check);
    return { ...saved, label: packageLabel(packageType, context.source) };
  }

  async function runTransaction(callback) {
    if (typeof dependencies.workflowTransaction !== 'function') return callback(dependencies);
    return dependencies.workflowTransaction((repositories) => callback({
      ...dependencies, ...repositories, workflowTransaction: null
    }));
  }

  async function createTodoAndEvent(repositories, {
    opportunityId, assigneeUserId, title, eventType, actorUserId, targetUserId, comment,
    fromStatus, toStatus
  }) {
    if (assigneeUserId) await repositories.todoRepository.create({ opportunityId, assigneeUserId, title });
    await repositories.workflowEventRepository.create({
      opportunityId, eventType, fromStatus, toStatus, actorUserId, targetUserId, comment
    });
  }

  async function submitPackage(actor, workspaceId, packageType, input = {}) {
    const initial = await packageContext(actor, workspaceId, packageType);
    if (!canSubmit(actor, initial.workspace.opportunity, packageType)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    const check = await computeDraftCheck(initial.workspace, packageType, initial.source);
    await recordCheck(actor, initial.workspace, packageType, initial.source, check);
    if (!check.passed) fail('Package completeness check failed', 409, BID_CENTER_ERROR_CODES.CONFLICT, check.issues);
    return runTransaction(async (repositories) => {
      const scoped = createBidPackageApprovalService({ enabled, dependencies: repositories });
      const context = await scoped._packageContext(actor, workspaceId, packageType);
      const reviewer = positiveInteger(reviewerId(context.workspace.opportunity, packageType), 'Assigned reviewer');
      if (reviewer === Number(actor.id)) {
        fail('Reviewer must be different from submitter', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      let submitted;
      if (packageType === 'technical') {
        if (!['draft', 'ready'].includes(context.source.status)) fail('Technical package is not open for submission', 409, BID_CENTER_ERROR_CODES.CONFLICT);
        let ready = context.source;
        if (ready.status === 'draft') ready = await repositories.opportunityTechnicalDraftRepository.markReady({
          draftId: ready.id, validationIssues: [], actorUserId: Number(actor.id)
        });
        submitted = await repositories.opportunityTechnicalDraftRepository.submitForApproval({
          draftId: ready.id, actorUserId: Number(actor.id)
        });
      } else {
        if (context.source.status !== 'draft') fail('Commercial package is not open for submission', 409, BID_CENTER_ERROR_CODES.CONFLICT);
        const id = await repositories.bidPackageApprovalRepository.submitCommercial({
          workspaceId: context.workspace.id,
          commercialDraftId: context.source.id,
          actorUserId: Number(actor.id)
        });
        submitted = id && await repositories.opportunityCommercialDraftRepository.getDraftDetail(id);
      }
      if (!submitted) fail('Package submission was not accepted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType, ...packageSource(packageType, submitted),
        eventType: 'submitted', actorUserId: Number(actor.id),
        details: { label: packageLabel(packageType, submitted), reviewerUserId: reviewer }
      });
      await repositories.todoRepository.closePendingForOpportunityAssigneeAndTitle(
        context.workspace.opportunity.id, Number(actor.id),
        todoTitle('Revise', packageType, submitted), 'completed'
      );
      await createTodoAndEvent(repositories, {
        opportunityId: context.workspace.opportunity.id,
        assigneeUserId: reviewer,
        title: todoTitle('Review', packageType, submitted),
        eventType: `submit_bid_${packageType}_package`,
        actorUserId: Number(actor.id), targetUserId: reviewer,
        comment: optionalText(input.comment), fromStatus: 'draft', toStatus: 'review_pending'
      });
      return submitted;
    });
  }

  async function reviewPackage(actor, workspaceId, packageType, input = {}) {
    const decision = String(input.decision || '').trim();
    if (!['approve', 'reject'].includes(decision)) fail('Review decision is invalid');
    const comment = decision === 'reject' ? requiredText(input.comment, 'Rejection reason') : optionalText(input.comment);
    return runTransaction(async (repositories) => {
      const scoped = createBidPackageApprovalService({ enabled, dependencies: repositories });
      const context = await scoped._packageContext(actor, workspaceId, packageType);
      if (context.source.status !== (packageType === 'technical' ? 'pending' : 'review_pending')
          || !canReview(actor, context.workspace.opportunity, packageType, context.source)) {
        fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
      }
      const reviewTask = todoTitle('Review', packageType, context.source);
      let reviewed;
      let revision = null;
      if (packageType === 'technical') {
        reviewed = decision === 'approve'
          ? await repositories.opportunityTechnicalDraftRepository.approveLatestPending({
            opportunityId: context.workspace.opportunity.id, actorUserId: Number(actor.id), reviewComment: comment
          })
          : await repositories.opportunityTechnicalDraftRepository.rejectLatestPending({
            opportunityId: context.workspace.opportunity.id, actorUserId: Number(actor.id), reviewComment: comment
          });
        if (decision === 'reject' && reviewed) revision = await repositories.opportunityTechnicalDraftRepository.cloneRejectedDraft({
          sourceDraftId: reviewed.id, actorUserId: Number(actor.id)
        });
      } else if (decision === 'approve') {
        const row = await repositories.bidPackageApprovalRepository.approveCommercial({
          workspaceId: context.workspace.id, commercialDraftId: context.source.id,
          actorUserId: Number(actor.id), reviewComment: comment
        });
        reviewed = row && await repositories.opportunityCommercialDraftRepository.getDraftDetail(row.id);
      } else {
        const id = await repositories.bidPackageApprovalRepository.rejectCommercial({
          workspaceId: context.workspace.id, commercialDraftId: context.source.id,
          actorUserId: Number(actor.id), reviewComment: comment
        });
        reviewed = id && await repositories.opportunityCommercialDraftRepository.getDraftDetail(id);
        const row = reviewed && await repositories.bidPackageApprovalRepository.cloneRejectedCommercial({
          workspaceId: context.workspace.id, commercialDraftId: reviewed.id,
          actorUserId: Number(actor.id), reviewComment: comment
        });
        revision = row && await repositories.opportunityCommercialDraftRepository.getDraftDetail(row.id);
      }
      if (!reviewed) fail('Package review was not accepted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType, ...packageSource(packageType, reviewed),
        eventType: decision === 'approve' ? 'approved' : 'rejected', actorUserId: Number(actor.id),
        details: { label: packageLabel(packageType, reviewed), comment }
      });
      if (revision) await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType, ...packageSource(packageType, revision),
        eventType: 'revision_created', actorUserId: Number(actor.id),
        details: { sourceId: reviewed.id, label: packageLabel(packageType, revision) }
      });
      if (revision) await repositories.bidPackageApprovalRepository.copyDraftArtifacts({
        workspaceId: context.workspace.id,
        packageType,
        sourceDraftId: reviewed.id,
        targetDraftId: revision.id,
        actorUserId: Number(actor.id)
      });
      await repositories.todoRepository.closePendingForOpportunityAssigneeAndTitle(
        context.workspace.opportunity.id, Number(actor.id), reviewTask,
        decision === 'approve' ? 'completed' : 'rejected'
      );
      if (revision) await repositories.todoRepository.create({
        opportunityId: context.workspace.opportunity.id,
        assigneeUserId: reviewed.submittedBy,
        title: todoTitle('Revise', packageType, revision)
      });
      await repositories.workflowEventRepository.create({
        opportunityId: context.workspace.opportunity.id,
        eventType: `${decision}_bid_${packageType}_package`,
        fromStatus: 'review_pending', toStatus: decision === 'approve' ? 'approved' : 'rejected',
        actorUserId: Number(actor.id), targetUserId: reviewed.submittedBy, comment
      });
      return { reviewed, revision };
    });
  }

  async function completeContext(actor, workspaceId, packageId = null) {
    const result = await workspace(actor, workspaceId);
    if (!commercialViewer(actor, result.opportunity)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    const versions = (await dependencies.quotationPackageRepository.listByOpportunity(result.opportunity.id))
      .filter((item) => Number(item.workspaceId) === Number(result.id));
    const selected = packageId
      ? versions.find((item) => item.id === positiveInteger(packageId, 'Complete bid'))
      : versions[0];
    if (!selected) fail('Complete bid draft not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const source = await dependencies.quotationPackageRepository.getPackageDetail(selected.id);
    return { workspace: result, source, versions };
  }

  async function componentDetails(result, source) {
    const [technical, commercial, quote] = await Promise.all([
      dependencies.opportunityTechnicalDraftRepository.getDraftDetail(source.technicalSolutionVersionId),
      dependencies.opportunityCommercialDraftRepository.getDraftDetail(source.commercialDraftId),
      dependencies.quotationPackageRepository.getCommercialQuoteContext({
        opportunityId: result.opportunity.id, commercialQuoteId: source.commercialQuoteId
      })
    ]);
    return { technical, commercial, quote };
  }

  async function computeCompleteCheck(result, source) {
    const components = await componentDetails(result, source);
    const issues = [];
    if (components.technical?.status !== 'approved' || !components.technical.formalVersionNo) {
      issues.push(issue('technical_version_not_approved', 'An approved technical package version is required'));
    }
    if (components.commercial?.status !== 'approved' || !components.commercial.formalVersionNo) {
      issues.push(issue('commercial_version_not_approved', 'An approved commercial package version is required'));
    }
    if (components.quote?.status !== 'approved' || !components.quote.versionNo) {
      issues.push(issue('quote_not_approved', 'An approved commercial quote is required'));
    }
    if (!moneyEqual(source.totalPrice, components.quote?.totalPrice)) {
      issues.push(issue('complete_total_mismatch', 'Complete bid total does not match the approved quote'));
    }
    for (const [key, label] of [['currency', 'Currency'], ['deliveryPeriod', 'Delivery period'],
      ['paymentTerms', 'Payment terms'], ['validUntil', 'Validity date']]) {
      if (blank(source[key])) issues.push(issue(`${key}_missing`, `${label} is required`));
    }
    if (components.technical) {
      const check = await computeDraftCheck(result, 'technical', components.technical);
      issues.push(...check.issues.map((item) => ({ ...item, component: 'technical' })));
    }
    if (components.commercial) {
      const check = await computeDraftCheck(result, 'commercial', components.commercial);
      issues.push(...check.issues.map((item) => ({ ...item, component: 'commercial' })));
    }
    return {
      passed: issues.length === 0,
      issues,
      snapshotSha256: snapshotHash({
        ...baseSnapshot('complete', source, []),
        technicalHash: components.technical && snapshotHash(baseSnapshot('technical', components.technical, [])),
        commercialHash: components.commercial && snapshotHash(baseSnapshot('commercial', components.commercial, [])),
        quote: components.quote
      }),
      components
    };
  }

  async function checkComplete(actor, workspaceId, packageId) {
    const context = await completeContext(actor, workspaceId, packageId);
    const check = await computeCompleteCheck(context.workspace, context.source);
    const saved = await recordCheck(actor, context.workspace, 'complete', context.source, check);
    return { ...saved, label: packageLabel('complete', context.source) };
  }

  async function createCompleteDraft(actor, workspaceId, input = {}) {
    const result = await workspace(actor, workspaceId);
    if (!completeAssembler(actor, result.opportunity)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    const [technicalVersions, commercialVersions, packageVersions, quote, currentSent] = await Promise.all([
      listTechnicalVersions(result),
      listCommercialVersions(result),
      dependencies.quotationPackageRepository.listByOpportunity(result.opportunity.id),
      quoteContext(result),
      dependencies.quotationPackageRepository.findCurrentSentByOpportunity(result.opportunity.id)
    ]);
    if (packageVersions.some((item) => ['draft', 'pending', 'approved', 'accepted'].includes(item.status))) {
      fail('Finish or send the current complete bid before creating another revision', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
    const technical = technicalVersions.find((item) => item.status === 'approved');
    const commercial = commercialVersions.find((item) => item.status === 'approved');
    if (!technical || !commercial || quote?.status !== 'approved') {
      fail('Approved technical and commercial package versions are required', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
    requiredText(quote.paymentTerms, 'Approved quote payment terms');
    if (blank(quote.validityDate)) fail('Approved quote validity date is required');
    const requestedSourceId = input.sourcePackageId ? positiveInteger(input.sourcePackageId, 'Source package') : null;
    if (Number(currentSent?.id || 0) !== Number(requestedSourceId || 0)) {
      fail('A customer revision must start from the current sent package', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
    const revisionReason = currentSent ? requiredText(input.revisionReason, 'Internal revision reason') : '';
    const changeSummaryText = currentSent ? requiredText(input.changeSummary, 'Customer-readable change summary') : '';
    const currency = String(sourceFieldValue(commercial, 'currency')
      || input.currency || currentSent?.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail('Currency is required as a three-letter ISO code');
    const deliveryPeriod = String(sourceFieldValue(commercial, 'delivery_period')
      || result.sourceMetadata?.opportunity?.deliveryCycle || input.deliveryPeriod || '').trim();
    if (!deliveryPeriod) fail('Delivery period is required');
    const created = await runTransaction(async (repositories) => {
      const row = await repositories.bidPackageApprovalRepository.createCompleteDraft({
        workspaceId: result.id,
        opportunityId: result.opportunity.id,
        technicalDraftId: technical.id,
        commercialQuoteId: quote.id,
        commercialDraftId: commercial.id,
        sourcePackageId: currentSent?.id || null,
        currency,
        totalPrice: quote.totalPrice,
        deliveryPeriod,
        paymentTerms: quote.paymentTerms,
        validUntil: quote.validityDate,
        commercialLineItems: quote.items,
        inclusions: sourceFieldValue(commercial, 'inclusions') || '',
        exclusions: sourceFieldValue(commercial, 'exclusions') || '',
        technicalAssumptions: sourceFieldValue(commercial, 'technical_assumptions') || '',
        revisionReason,
        changeSummary: changeSummaryText,
        actorUserId: Number(actor.id)
      });
      if (!row) fail('Complete bid draft could not be created', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: result.id, packageType: 'complete', quotationPackageId: row.id,
        eventType: 'complete_draft_created', actorUserId: Number(actor.id),
        details: { label: `QP-D${row.draftRevisionNo}`, sourcePackageId: currentSent?.id || null }
      });
      return repositories.quotationPackageRepository.getPackageDetail(row.id);
    });
    return created;
  }

  async function submitComplete(actor, workspaceId, packageId, input = {}) {
    const initial = await completeContext(actor, workspaceId, packageId);
    if (!completeAssembler(actor, initial.workspace.opportunity)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    const check = await computeCompleteCheck(initial.workspace, initial.source);
    await recordCheck(actor, initial.workspace, 'complete', initial.source, check);
    if (!check.passed) fail('Complete bid completeness check failed', 409, BID_CENTER_ERROR_CODES.CONFLICT, check.issues);
    return runTransaction(async (repositories) => {
      const scoped = createBidPackageApprovalService({ enabled, dependencies: repositories });
      const context = await scoped._completeContext(actor, workspaceId, packageId);
      if (context.source.status !== 'draft') fail('Complete bid is not open for submission', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      const reviewer = positiveInteger(context.workspace.opportunity.salesManagerId, 'Assigned Sales Manager');
      if (reviewer === Number(actor.id)) {
        fail('Reviewer must be different from submitter', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      const id = await repositories.bidPackageApprovalRepository.submitComplete({
        workspaceId: context.workspace.id, quotationPackageId: context.source.id,
        actorUserId: Number(actor.id), comment: optionalText(input.comment)
      });
      if (!id) fail('Complete bid submission was not accepted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      await repositories.bidPackageApprovalRepository.setWorkspaceStatus({
        workspaceId: context.workspace.id, status: 'review_pending', actorUserId: Number(actor.id)
      });
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType: 'complete', quotationPackageId: id,
        eventType: 'submitted', actorUserId: Number(actor.id),
        details: { label: packageLabel('complete', context.source), reviewerUserId: reviewer }
      });
      await repositories.todoRepository.closePendingForOpportunityAssigneeAndTitle(
        context.workspace.opportunity.id, Number(actor.id),
        todoTitle('Revise', 'complete', context.source), 'completed'
      );
      await createTodoAndEvent(repositories, {
        opportunityId: context.workspace.opportunity.id, assigneeUserId: reviewer,
        title: todoTitle('Review', 'complete', context.source),
        eventType: 'submit_bid_complete_package', actorUserId: Number(actor.id),
        targetUserId: reviewer, comment: optionalText(input.comment),
        fromStatus: 'draft', toStatus: 'review_pending'
      });
      return repositories.quotationPackageRepository.getPackageDetail(id);
    });
  }

  async function reviewComplete(actor, workspaceId, packageId, input = {}) {
    const decision = String(input.decision || '').trim();
    if (!['approve', 'reject'].includes(decision)) fail('Review decision is invalid');
    const comment = decision === 'reject' ? requiredText(input.comment, 'Rejection reason') : optionalText(input.comment);
    return runTransaction(async (repositories) => {
      const scoped = createBidPackageApprovalService({ enabled, dependencies: repositories });
      const context = await scoped._completeContext(actor, workspaceId, packageId);
      if (context.source.status !== 'pending'
          || !canReview(actor, context.workspace.opportunity, 'complete', context.source)) {
        fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
      }
      const reviewed = decision === 'approve'
        ? await repositories.quotationPackageRepository.approvePending({
          packageId: context.source.id, actorUserId: Number(actor.id), comment
        })
        : await repositories.quotationPackageRepository.rejectPending({
          packageId: context.source.id, actorUserId: Number(actor.id), comment
        });
      if (!reviewed) fail('Complete bid review was not accepted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      let revision = null;
      if (decision === 'reject') {
        const row = await repositories.bidPackageApprovalRepository.cloneRejectedComplete({
          workspaceId: context.workspace.id, quotationPackageId: reviewed.id,
          actorUserId: Number(actor.id), reviewComment: comment
        });
        revision = row && await repositories.quotationPackageRepository.getPackageDetail(row.id);
      }
      await repositories.bidPackageApprovalRepository.setWorkspaceStatus({
        workspaceId: context.workspace.id,
        status: decision === 'approve' ? 'approved' : 'rejected',
        actorUserId: Number(actor.id)
      });
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType: 'complete', quotationPackageId: reviewed.id,
        eventType: decision === 'approve' ? 'approved' : 'rejected', actorUserId: Number(actor.id),
        details: { label: packageLabel('complete', reviewed), comment }
      });
      if (revision) await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType: 'complete', quotationPackageId: revision.id,
        eventType: 'revision_created', actorUserId: Number(actor.id),
        details: { sourceId: reviewed.id, label: packageLabel('complete', revision) }
      });
      await repositories.todoRepository.closePendingForOpportunityAssigneeAndTitle(
        context.workspace.opportunity.id, Number(actor.id), todoTitle('Review', 'complete', context.source),
        decision === 'approve' ? 'completed' : 'rejected'
      );
      if (revision) await repositories.todoRepository.create({
        opportunityId: context.workspace.opportunity.id,
        assigneeUserId: reviewed.submittedBy,
        title: todoTitle('Revise', 'complete', revision)
      });
      await repositories.workflowEventRepository.create({
        opportunityId: context.workspace.opportunity.id,
        eventType: `${decision}_bid_complete_package`,
        fromStatus: 'review_pending', toStatus: decision === 'approve' ? 'approved' : 'rejected',
        actorUserId: Number(actor.id), targetUserId: reviewed.submittedBy, comment
      });
      return { reviewed, revision };
    });
  }

  async function getPackageApproval(actor, workspaceId, packageType) {
    const context = await packageContext(actor, workspaceId, packageType);
    const checks = await dependencies.bidPackageApprovalRepository.listCompletenessChecks({
      workspaceId: context.workspace.id, packageType, ...packageSource(packageType, context.source)
    });
    const previous = context.versions.find((item) => item.id !== context.source.id) || null;
    let comparison = null;
    if (previous) {
      const previousDetail = packageType === 'technical'
        ? await dependencies.opportunityTechnicalDraftRepository.getDraftDetail(previous.id)
        : await dependencies.opportunityCommercialDraftRepository.getDraftDetail(previous.id);
      const [currentAttachments, previousAttachments] = await Promise.all([
        dependencies.bidPackageEditorRepository.listAttachments({
          workspaceId: context.workspace.id, packageType, ...packageSource(packageType, context.source)
        }),
        dependencies.bidPackageEditorRepository.listAttachments({
          workspaceId: context.workspace.id, packageType, ...packageSource(packageType, previousDetail)
        })
      ]);
      comparison = changeSummary(
        context.source, previousDetail, currentAttachments, previousAttachments, packageType
      );
    }
    return {
      label: packageLabel(packageType, context.source),
      status: context.source.status,
      checks,
      versions: context.versions,
      comparison,
      canCheck: canSubmit(actor, context.workspace.opportunity, packageType),
      canSubmit: canSubmit(actor, context.workspace.opportunity, packageType)
        && (packageType === 'technical' ? ['draft', 'ready'].includes(context.source.status) : context.source.status === 'draft'),
      canReview: canReview(actor, context.workspace.opportunity, packageType, context.source),
      reviewerUserId: reviewerId(context.workspace.opportunity, packageType)
    };
  }

  async function getDashboard(actor, workspaceId) {
    const result = await workspace(actor, workspaceId);
    const [technicalVersions, commercialVersions, completeVersions] = await Promise.all([
      listTechnicalVersions(result),
      commercialViewer(actor, result.opportunity)
        ? listCommercialVersions(result) : Promise.resolve([]),
      commercialViewer(actor, result.opportunity)
        ? dependencies.quotationPackageRepository.listByOpportunity(result.opportunity.id) : Promise.resolve([])
    ]);
    const workspaceCompleteVersions = completeVersions.filter((item) => Number(item.workspaceId) === Number(result.id));
    const complete = workspaceCompleteVersions[0] || null;
    let completeChecks = [];
    if (complete) completeChecks = await dependencies.bidPackageApprovalRepository.listCompletenessChecks({
      workspaceId: result.id, packageType: 'complete', quotationPackageId: complete.id
    });
    let completeComparison = null;
    if (complete && workspaceCompleteVersions[1]) {
      const [currentDetail, previousDetail] = await Promise.all([
        dependencies.quotationPackageRepository.getPackageDetail(complete.id),
        dependencies.quotationPackageRepository.getPackageDetail(workspaceCompleteVersions[1].id)
      ]);
      completeComparison = changeSummary(
        currentDetail, previousDetail,
        currentDetail?.attachments || [], previousDetail?.attachments || [], 'complete'
      );
    }
    return {
      technicalVersions,
      commercialVersions,
      completeVersions: workspaceCompleteVersions,
      completeChecks,
      completeComparison,
      canCreateComplete: completeAssembler(actor, result.opportunity)
        && technicalVersions.some((item) => item.status === 'approved')
        && commercialVersions.some((item) => item.status === 'approved')
        && !workspaceCompleteVersions.some((item) => ['draft', 'pending', 'approved', 'accepted'].includes(item.status)),
      canCheckComplete: Boolean(complete && completeAssembler(actor, result.opportunity)),
      canSubmitComplete: Boolean(complete && complete.status === 'draft' && completeAssembler(actor, result.opportunity)),
      canReviewComplete: Boolean(complete && complete.status === 'pending'
        && canReview(actor, result.opportunity, 'complete', complete)),
      currentSentPackage: completeVersions.find((item) => item.status === 'sent') || null
    };
  }

  return Object.freeze({
    checkPackage,
    submitPackage,
    reviewPackage,
    checkComplete,
    createCompleteDraft,
    submitComplete,
    reviewComplete,
    getPackageApproval,
    getDashboard,
    _packageContext: packageContext,
    _completeContext: completeContext
  });
}

export const bidPackageApprovalInternals = Object.freeze({
  snapshotHash,
  sectionIssues,
  variableIssues,
  quoteConsistencyIssues,
  changeSummary
});
