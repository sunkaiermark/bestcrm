import { BID_LIBRARY_TYPES } from '../domain/bidCenterLibrary.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { canViewBidContentBlock } from './bidContentBlockService.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';
import {
  applyCommercialVariableOverrides,
  validateCommercialDraftVariables
} from './opportunityCommercialDraftService.mjs';
import {
  assignOpportunityTechnicalDraftSection,
  canEditOpportunityTechnicalDraftSection,
  removeOpportunityTechnicalDraftSectionAssignment,
  updateOpportunityTechnicalDraftSection,
  updateOpportunityTechnicalDraftVariables,
  validateTechnicalDraftVariables
} from './opportunityTechnicalDraftService.mjs';
import { isProjectLeadEngineer } from './opportunityService.mjs';

const packageTypes = new Set(['technical', 'commercial']);
const sectionKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const unsafeStructuredText = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;
const salespersonCommercialSections = new Set([
  'commercial_cover', 'bid_or_quotation_letter', 'bidder_information', 'company_profile',
  'references', 'commercial_response', 'delivery_terms', 'packing_transport_insurance',
  'validity', 'warranty_service', 'commercial_attachments'
]);

function fail(message, statusCode = 400, code = BID_CENTER_ERROR_CODES.VALIDATION) {
  throw new BidCenterServiceError(message, { statusCode, code });
}

function forbidden() {
  fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`${field} is invalid`);
  return number;
}

function safeText(value, field, maxLength = 100000, { required = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) fail(`${field} is required`);
  if (normalized.length > maxLength) fail(`${field} is too long`);
  if (normalized && unsafeStructuredText.test(normalized)) fail(`${field} contains unsupported template or script syntax`);
  return normalized;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function packageTypeValue(value) {
  const normalized = String(value || '').trim();
  if (!packageTypes.has(normalized)) fail('Bid package type is invalid');
  return normalized;
}

function sectionKeyValue(value) {
  const normalized = String(value || '').trim();
  if (!sectionKeyPattern.test(normalized)) fail('Bid package section is invalid');
  return normalized;
}

function parseTableRows(value) {
  if (Array.isArray(value)) return deepClone(value);
  const rows = String(value ?? '').split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split('|').map((cell) => safeText(cell, 'Table cell', 500)));
  if (rows.length > 200 || rows.some((row) => row.length > 12)) fail('Section table rows are invalid');
  return rows;
}

function normalizeIdList(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(/[\r\n,]+/);
  const ids = items.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length > 200) fail('Content selection is invalid');
  return [...new Set(ids)];
}

function summarizeSection(section) {
  const bodyEn = String(section?.bodyEn || '').replace(/\s+/g, ' ').trim();
  const bodyZh = String(section?.bodyZh || '').replace(/\s+/g, ' ').trim();
  const rows = Array.isArray(section?.tableRows) ? section.tableRows.length : 0;
  const blocks = Array.isArray(section?.contentBlocks) ? section.contentBlocks.length : 0;
  return [bodyEn, bodyZh, rows ? `${rows} table row(s)` : '', blocks ? `${blocks} content block(s)` : '']
    .filter(Boolean).join(' | ').slice(0, 2000);
}

function baselineSection(draft, sectionKey) {
  return (draft.contentSchemaSnapshot?.sections || []).find((section) => section.key === sectionKey) || null;
}

function comparisonBaseline(draft, packageType, sectionKey, workspace = null) {
  const source = baselineSection(draft, sectionKey);
  if (!source) return null;
  const baseline = deepClone(source);
  baseline.included = baseline.enabled !== false;
  if (packageType === 'commercial') {
    const snapshots = draft.sourceMetadata?.contentComponentSnapshots || [];
    baseline.contentBlocks = (baseline.contentBlockIds || [])
      .map((id) => snapshots.find((snapshot) => Number(snapshot.blockId) === Number(id)))
      .filter(Boolean)
      .map(deepClone);
  } else {
    const frozenClauses = workspace?.sourceMetadata?.technicalClauseSnapshots || draft.selectedClauses || [];
    baseline.clauses = frozenClauses
      .filter((clause) => clause.sectionKey === sectionKey && clause.isTemplateDefault)
      .map(deepClone);
  }
  return baseline;
}

function currentSection(draft, sectionKey) {
  return (draft.renderedContent?.sections || []).find((section) => section.key === sectionKey) || null;
}

function sameSectionContent(left, right) {
  return String(left?.bodyEn || '') === String(right?.bodyEn || '')
    && String(left?.bodyZh || '') === String(right?.bodyZh || '')
    && JSON.stringify(left?.tableRows || []) === JSON.stringify(right?.tableRows || [])
    && JSON.stringify(left?.contentBlocks || []) === JSON.stringify(right?.contentBlocks || [])
    && (left?.included !== false) === (right?.enabled !== false);
}

function visibleUserId(actor) {
  return hasRole(actor, ROLES.ADMINISTRATOR) ? null : positiveInteger(actor.id, 'User');
}

function commercialViewer(actor, opportunity) {
  if (hasRole(actor, ROLES.ADMINISTRATOR)) return true;
  const actorId = Number(actor.id);
  if (hasRole(actor, ROLES.SALESPERSON) && Number(opportunity.salespersonId) === actorId) return true;
  if (hasRole(actor, ROLES.SALES_MANAGER) && Number(opportunity.salesManagerId) === actorId) return true;
  if (hasRole(actor, ROLES.COMMERCIAL_MANAGER) && Number(opportunity.commercialManagerId) === actorId) return true;
  if (hasRole(actor, ROLES.QUOTATION_ENGINEER) && Number(opportunity.quotationEngineerId) === actorId) return true;
  return [ROLES.LEGAL_REVIEWER, ROLES.FINANCE_REVIEWER, ROLES.GENERAL_MANAGER]
    .some((role) => hasRole(actor, role));
}

function commercialEditor(actor, opportunity, sectionKey) {
  const actorId = Number(actor.id);
  if (hasRole(actor, ROLES.COMMERCIAL_MANAGER) && Number(opportunity.commercialManagerId) === actorId) return true;
  if (hasRole(actor, ROLES.QUOTATION_ENGINEER) && Number(opportunity.quotationEngineerId) === actorId) return true;
  return hasRole(actor, ROLES.SALESPERSON)
    && Number(opportunity.salespersonId) === actorId
    && salespersonCommercialSections.has(sectionKey);
}

function packageLead(actor, opportunity, packageType) {
  if (packageType === 'technical') return isProjectLeadEngineer(actor, opportunity);
  const actorId = Number(actor.id);
  return (hasRole(actor, ROLES.COMMERCIAL_MANAGER)
      && Number(opportunity.commercialManagerId) === actorId)
    || (hasRole(actor, ROLES.QUOTATION_ENGINEER)
      && Number(opportunity.quotationEngineerId) === actorId);
}

function sourceIds(packageType, draft) {
  return packageType === 'technical'
    ? { technicalDraftId: draft.id, commercialDraftId: null }
    : { technicalDraftId: null, commercialDraftId: draft.id };
}

function mergeTechnicalRenderedSections(originalSections, newlyRenderedSections) {
  const originalByKey = new Map((originalSections || []).map((section) => [section.key, section]));
  const merged = (newlyRenderedSections || []).map((section) => {
    const original = originalByKey.get(section.key);
    return original ? {
      ...section,
      included: original.included,
      projectAdded: original.projectAdded,
      modificationStatus: original.modificationStatus,
      lastEditedBy: original.lastEditedBy,
      lastEditedAt: original.lastEditedAt
    } : section;
  });
  for (const original of originalSections || []) {
    if (original.projectAdded && !merged.some((section) => section.key === original.key)) merged.push(deepClone(original));
  }
  return merged.sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
}

function baseMutationContext(workspace, packageType, draft, actor, sectionKey) {
  return {
    workspaceId: workspace.id,
    packageType,
    ...sourceIds(packageType, draft),
    sectionKey,
    actorUserId: Number(actor.id)
  };
}

export function createBidPackageEditorService({ enabled = false, dependencies }) {
  function assertEnabled() {
    if (enabled !== true) fail('Bid center is disabled', 404, BID_CENTER_ERROR_CODES.DISABLED);
  }

  async function loadOpportunity(workspace) {
    const detail = await dependencies.opportunityRepository.getOpportunityDetail(workspace.opportunity.id);
    if (!detail) fail('Opportunity not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
      ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(detail.id)
      : [];
    return { ...detail, teamMembers };
  }

  async function load(actor, workspaceId, rawPackageType) {
    assertEnabled();
    const packageType = packageTypeValue(rawPackageType);
    const workspace = await dependencies.bidWorkspaceRepository.getWorkspaceDetail(
      positiveInteger(workspaceId, 'Bid workspace'),
      { visibleToUserId: visibleUserId(actor) }
    );
    if (!workspace) fail('Bid workspace not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const opportunity = await loadOpportunity(workspace);
    if (packageType === 'commercial' && !commercialViewer(actor, opportunity)) forbidden();
    const draft = packageType === 'technical'
      ? await dependencies.opportunityTechnicalDraftRepository.getDraftDetail(workspace.technicalDraft?.id)
      : await dependencies.opportunityCommercialDraftRepository.getDraftDetail(workspace.commercialDraft?.id);
    if (!draft) fail('Bid package draft not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    return { packageType, workspace, opportunity, draft };
  }

  function ensureDraftEditable(packageType, draft) {
    const editable = packageType === 'technical'
      ? ['draft', 'ready'].includes(draft.status)
      : draft.status === 'draft';
    if (!editable) fail('Submitted bid package drafts are read-only', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }

  function ensureSectionEditor(actor, opportunity, packageType, draft, sectionKey) {
    if (packageType === 'technical') {
      if (!canEditOpportunityTechnicalDraftSection(actor, opportunity, draft, sectionKey)
          && !(currentSection(draft, sectionKey)?.projectAdded && packageLead(actor, opportunity, packageType))) forbidden();
      return;
    }
    if (!commercialEditor(actor, opportunity, sectionKey)) forbidden();
  }

  async function inTransaction(method, args) {
    if (typeof dependencies.workflowTransaction !== 'function') return method(...args);
    return dependencies.workflowTransaction((repositories) => {
      const scoped = createBidPackageEditorService({
        enabled,
        dependencies: { ...dependencies, ...repositories, workflowTransaction: null }
      });
      return scoped[method.name](...args);
    });
  }

  async function persistDraft(context, next, audit) {
    const common = {
      workspaceId: context.workspace.id,
      packageType: context.packageType,
      ...sourceIds(context.packageType, context.draft),
      actorUserId: audit.actorUserId
    };
    const saved = context.packageType === 'technical'
      ? await dependencies.bidPackageEditorRepository.updateTechnicalDraft({
        ...common,
        variableValues: next.variableValues,
        selectedClauses: next.selectedClauses,
        renderedContent: next.renderedContent,
        validationIssues: next.validationIssues
      })
      : await dependencies.bidPackageEditorRepository.updateCommercialDraft({
        ...common,
        variableValues: next.variableValues,
        renderedContent: next.renderedContent,
        validationIssues: next.validationIssues
      });
    if (!saved) fail('Bid package changed before this save completed', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    for (const change of audit.changes) {
      await dependencies.bidPackageEditorRepository.insertChange({ ...common, ...change });
    }
    await dependencies.bidPackageEditorRepository.insertEvent({ ...common, ...audit.event });
    await dependencies.bidPackageEditorRepository.touchWorkspace(context.workspace.id, audit.actorUserId);
  }

  async function getEditor(actor, workspaceId, rawPackageType, requestedSectionKey = '') {
    const context = await load(actor, workspaceId, rawPackageType);
    const ids = { workspaceId: context.workspace.id, packageType: context.packageType, ...sourceIds(context.packageType, context.draft) };
    const changes = await dependencies.bidPackageEditorRepository.listChanges(ids);
    const events = await dependencies.bidPackageEditorRepository.listEvents(ids);
    const attachments = await dependencies.bidPackageEditorRepository.listAttachments(ids);
    const suggestions = await dependencies.bidPackageEditorRepository.listSuggestions(ids);
    const latestChangeBySection = new Map();
    for (const change of changes) {
      if (!latestChangeBySection.has(change.sectionKey)) latestChangeBySection.set(change.sectionKey, change);
    }
    const sections = [...(context.draft.renderedContent?.sections || [])]
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
      .map((section) => {
        const baseline = comparisonBaseline(context.draft, context.packageType, section.key, context.workspace);
        const lastChange = latestChangeBySection.get(section.key) || null;
        const status = lastChange?.modificationStatus
          || (section.projectAdded ? 'project_added' : section.included === false ? 'omitted' : sameSectionContent(section, baseline) ? 'standard' : 'customized');
        const validationIssueCount = (context.draft.validationIssues || [])
          .filter((issue) => issue.sectionKey === section.key).length;
        const assignments = context.packageType === 'technical'
          ? (context.draft.assignments || []).filter((assignment) => assignment.isActive !== false && assignment.sectionKey === section.key)
          : [];
        const responsibleNames = context.packageType === 'technical'
          ? (assignments.length ? assignments.map((assignment) => assignment.assigneeDisplayName) : [context.opportunity.quotationEngineerName || context.opportunity.quotationEngineer?.displayName || 'Project Lead Engineer'])
          : [context.opportunity.commercialManagerName || context.opportunity.commercialManager?.displayName || 'Commercial Manager'];
        return {
          ...section,
          modificationStatus: status,
          completionStatus: section.included === false ? 'omitted'
            : status === 'needs_review' || validationIssueCount > 0 ? 'needs_review' : 'complete',
          validationIssueCount,
          baseline,
          lastChange,
          assignments,
          responsibleNames,
          canEdit: ensureCanEditSection(actor, context, section.key),
          attachments: attachments.filter((attachment) => attachment.sectionKey === section.key && !attachment.removedAt),
          diff: {
            bodyEnChanged: String(section.bodyEn || '') !== String(baseline?.bodyEn || ''),
            bodyZhChanged: String(section.bodyZh || '') !== String(baseline?.bodyZh || ''),
            tableRowsChanged: JSON.stringify(section.tableRows || []) !== JSON.stringify(baseline?.tableRows || []),
            contentBlocksChanged: JSON.stringify(section.contentBlocks || []) !== JSON.stringify(baseline?.contentBlocks || []),
            inclusionChanged: section.included === false
          }
        };
      });
    const requested = String(requestedSectionKey || '');
    const activeSection = sections.find((section) => section.key === requested) || sections[0] || null;
    const variables = (context.draft.variableSchemaSnapshot || [])
      .filter((variable) => !activeSection || variable.sectionKey === activeSection.key)
      .map((variable) => ({ ...variable, value: context.draft.variableValues?.[variable.variableKey] ?? '' }));
    let libraryItems = [];
    if (context.packageType === 'technical') {
      libraryItems = await dependencies.technicalTemplateRepository.listClauses({ publishedOnly: true });
    } else if (dependencies.bidContentBlockRepository) {
      libraryItems = await dependencies.bidContentBlockRepository.listBlocks({
        categories: ['commercial', 'common'],
        libraryType: BID_LIBRARY_TYPES.PUBLIC_MATERIAL,
        publishedOnly: true
      });
      libraryItems = libraryItems.filter((item) => canViewBidContentBlock(actor, item));
    }
    return {
      ...context,
      sections,
      activeSection,
      variables,
      changes,
      events,
      attachments,
      suggestions,
      libraryItems,
      isPackageLead: packageLead(actor, context.opportunity, context.packageType),
      canEditActiveSection: Boolean(activeSection?.canEdit),
      canManageAssignments: context.packageType === 'technical' && isProjectLeadEngineer(actor, context.opportunity),
      supportingEngineers: context.packageType === 'technical'
        ? (context.opportunity.teamMembers || []).filter((member) => member.roleCode === ROLES.QUOTATION_ENGINEER
          && member.isActive !== false && Number(member.userId) !== Number(context.opportunity.quotationEngineerId))
        : []
    };
  }

  function ensureCanEditSection(actor, context, sectionKey) {
    try {
      ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
      return true;
    } catch {
      return false;
    }
  }

  async function saveSection(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(saveSection, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
    const before = currentSection(context.draft, sectionKey);
    if (!before) fail('Bid package section not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const reason = safeText(input.reason, 'Change reason', 2000, { required: true });
    const bodyEn = safeText(input.bodyEn, 'English section content');
    const bodyZh = safeText(input.bodyZh, 'Chinese section content');
    const tableRows = parseTableRows(input.tableRows);
    let renderedContent;
    if (context.packageType === 'technical' && !before.projectAdded) {
      let captured;
      await updateOpportunityTechnicalDraftSection({
        async updateSection(update) { captured = update; return context.draft; }
      }, actor, context.opportunity, context.draft, sectionKey, { bodyEn, bodyZh, tableRows });
      renderedContent = captured.renderedContent;
    } else {
      const now = new Date().toISOString();
      renderedContent = {
        ...context.draft.renderedContent,
        sections: context.draft.renderedContent.sections.map((section) => section.key === sectionKey ? {
          ...section, bodyEn, bodyZh, tableRows, lastEditedBy: Number(actor.id), lastEditedAt: now
        } : section)
      };
    }
    const after = renderedContent.sections.find((section) => section.key === sectionKey);
    const baseline = comparisonBaseline(context.draft, context.packageType, sectionKey, context.workspace);
    const requestedStatus = String(input.modificationStatus || 'customized');
    const modificationStatus = before.projectAdded ? 'project_added'
      : sameSectionContent(after, baseline) ? 'standard'
        : requestedStatus === 'needs_review' ? 'needs_review' : 'customized';
    after.modificationStatus = modificationStatus;
    await persistDraft(context, {
      variableValues: context.draft.variableValues,
      selectedClauses: context.draft.selectedClauses,
      renderedContent,
      validationIssues: context.draft.validationIssues
    }, {
      actorUserId: Number(actor.id),
      changes: [{ sectionKey, modificationStatus, changeType: 'content_changed', beforeSummary: summarizeSection(before), afterSummary: summarizeSection(after), reason }],
      event: { eventType: 'section_saved', sectionKey, details: { modificationStatus } }
    });
  }

  async function saveVariables(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(saveVariables, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
    const reason = safeText(input.reason, 'Change reason', 2000, { required: true });
    const overrides = {};
    for (const variable of context.draft.variableSchemaSnapshot || []) {
      if (variable.sectionKey === sectionKey && Object.hasOwn(input, variable.variableKey)) overrides[variable.variableKey] = input[variable.variableKey];
    }
    let variableValues;
    let renderedContent;
    let validationIssues;
    if (context.packageType === 'technical') {
      let captured;
      await updateOpportunityTechnicalDraftVariables({
        async updateVariables(update) { captured = update; return context.draft; }
      }, actor, context.opportunity, context.draft, overrides);
      variableValues = captured.variableValues;
      renderedContent = {
        ...captured.renderedContent,
        sections: mergeTechnicalRenderedSections(context.draft.renderedContent?.sections, captured.renderedContent.sections)
      };
      validationIssues = captured.validationIssues;
    } else {
      const resolved = applyCommercialVariableOverrides(
        context.draft.variableSchemaSnapshot || [],
        context.draft.variableValues || {},
        {},
        overrides
      );
      variableValues = resolved.values;
      validationIssues = validateCommercialDraftVariables(context.draft.variableSchemaSnapshot || [], variableValues);
      renderedContent = {
        ...context.draft.renderedContent,
        variables: (context.draft.variableSchemaSnapshot || []).map((variable) => ({
          variableKey: variable.variableKey,
          labelEn: variable.labelEn,
          labelZh: variable.labelZh,
          sectionKey: variable.sectionKey,
          value: variableValues[variable.variableKey] ?? ''
        }))
      };
    }
    const changedKeys = Object.keys(overrides).filter((key) => String(variableValues[key] ?? '') !== String(context.draft.variableValues?.[key] ?? ''));
    await persistDraft(context, { variableValues, selectedClauses: context.draft.selectedClauses, renderedContent, validationIssues }, {
      actorUserId: Number(actor.id),
      changes: [{
        sectionKey,
        modificationStatus: changedKeys.length ? 'customized' : (currentSection(context.draft, sectionKey)?.modificationStatus || 'standard'),
        changeType: 'content_changed',
        beforeSummary: changedKeys.map((key) => `${key}=${context.draft.variableValues?.[key] ?? ''}`).join('; ').slice(0, 2000),
        afterSummary: changedKeys.map((key) => `${key}=${variableValues[key] ?? ''}`).join('; ').slice(0, 2000),
        reason
      }],
      event: { eventType: 'variables_saved', sectionKey, details: { changedKeys } }
    });
  }

  async function addSection(actor, workspaceId, rawPackageType, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(addSection, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    if (!packageLead(actor, context.opportunity, context.packageType)) forbidden();
    const sectionKey = sectionKeyValue(input.sectionKey);
    if (currentSection(context.draft, sectionKey) || baselineSection(context.draft, sectionKey)) fail('Section key already exists', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    const reason = safeText(input.reason, 'Change reason', 2000, { required: true });
    const sections = [...(context.draft.renderedContent?.sections || [])];
    const sortOrder = sections.reduce((maximum, section) => Math.max(maximum, Number(section.sortOrder || 0)), 0) + 1;
    const section = {
      key: sectionKey,
      labelEn: safeText(input.labelEn, 'English section label', 200, { required: true }),
      labelZh: safeText(input.labelZh, 'Chinese section label', 200),
      sectionType: 'narrative', sortOrder, included: true, projectAdded: true,
      bodyEn: safeText(input.bodyEn, 'English section content'), bodyZh: safeText(input.bodyZh, 'Chinese section content'),
      tableRows: [], contentBlocks: [], modificationStatus: 'project_added',
      lastEditedBy: Number(actor.id), lastEditedAt: new Date().toISOString()
    };
    sections.push(section);
    await persistDraft(context, {
      variableValues: context.draft.variableValues, selectedClauses: context.draft.selectedClauses,
      renderedContent: { ...context.draft.renderedContent, sections }, validationIssues: context.draft.validationIssues
    }, {
      actorUserId: Number(actor.id),
      changes: [{ sectionKey, modificationStatus: 'project_added', changeType: 'added', beforeSummary: '', afterSummary: summarizeSection(section), reason }],
      event: { eventType: 'section_added', sectionKey, details: { sortOrder } }
    });
    return sectionKey;
  }

  async function omitSection(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(omitSection, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    if (!packageLead(actor, context.opportunity, context.packageType)) forbidden();
    const sectionKey = sectionKeyValue(rawSectionKey);
    const before = currentSection(context.draft, sectionKey);
    if (!before) fail('Bid package section not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    if (baselineSection(context.draft, sectionKey)?.required === true) fail('Required template sections cannot be omitted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    const reason = safeText(input.reason, 'Change reason', 2000, { required: true });
    const sections = before.projectAdded
      ? context.draft.renderedContent.sections.filter((section) => section.key !== sectionKey)
      : context.draft.renderedContent.sections.map((section) => section.key === sectionKey ? { ...section, included: false, modificationStatus: 'omitted' } : section);
    await persistDraft(context, {
      variableValues: context.draft.variableValues, selectedClauses: context.draft.selectedClauses,
      renderedContent: { ...context.draft.renderedContent, sections }, validationIssues: context.draft.validationIssues
    }, {
      actorUserId: Number(actor.id),
      changes: [{ sectionKey, modificationStatus: 'omitted', changeType: 'omitted', beforeSummary: summarizeSection(before), afterSummary: before.projectAdded ? 'Project-added section removed' : 'Section omitted', reason }],
      event: { eventType: 'section_omitted', sectionKey, details: { removedProjectSection: Boolean(before.projectAdded) } }
    });
  }

  async function restoreSection(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(restoreSection, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
    const before = currentSection(context.draft, sectionKey);
    const baseline = comparisonBaseline(context.draft, context.packageType, sectionKey, context.workspace);
    if (!before || !baseline) fail('Only template sections can be restored', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    const reason = safeText(input.reason, 'Restore reason', 2000, { required: true });
    const restored = {
      ...deepClone(baseline), included: baseline.enabled !== false, standardChanged: false,
      modificationStatus: 'standard', lastEditedBy: Number(actor.id), lastEditedAt: new Date().toISOString()
    };
    const sections = context.draft.renderedContent.sections.map((section) => section.key === sectionKey ? restored : section);
    const selectedClauses = context.packageType === 'technical'
      ? [
        ...(context.draft.selectedClauses || []).filter((clause) => clause.sectionKey !== sectionKey),
        ...(baseline.clauses || []).map(deepClone)
      ]
      : context.draft.selectedClauses;
    await persistDraft(context, {
      variableValues: context.draft.variableValues, selectedClauses,
      renderedContent: { ...context.draft.renderedContent, sections }, validationIssues: context.draft.validationIssues
    }, {
      actorUserId: Number(actor.id),
      changes: [{ sectionKey, modificationStatus: 'standard', changeType: 'restored', beforeSummary: summarizeSection(before), afterSummary: summarizeSection(restored), reason }],
      event: { eventType: 'section_restored', sectionKey, details: { templateRevisionId: context.draft.templateRevisionId } }
    });
  }

  async function reorderSection(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(reorderSection, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    if (!packageLead(actor, context.opportunity, context.packageType)) forbidden();
    const sectionKey = sectionKeyValue(rawSectionKey);
    const direction = input.direction === 'up' ? -1 : input.direction === 'down' ? 1 : 0;
    if (!direction) fail('Reorder direction is invalid');
    const sections = [...context.draft.renderedContent.sections].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
    const index = sections.findIndex((section) => section.key === sectionKey);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sections.length) return;
    [sections[index], sections[targetIndex]] = [sections[targetIndex], sections[index]];
    sections.forEach((section, position) => { section.sortOrder = position + 1; });
    const section = sections.find((candidate) => candidate.key === sectionKey);
    const status = section.projectAdded ? 'project_added' : section.modificationStatus === 'needs_review' ? 'needs_review' : 'customized';
    const reason = safeText(input.reason || 'Project section order adjusted', 'Change reason', 2000, { required: true });
    await persistDraft(context, {
      variableValues: context.draft.variableValues, selectedClauses: context.draft.selectedClauses,
      renderedContent: { ...context.draft.renderedContent, sections }, validationIssues: context.draft.validationIssues
    }, {
      actorUserId: Number(actor.id),
      changes: [{ sectionKey, modificationStatus: status, changeType: 'reordered', beforeSummary: `Position ${index + 1}`, afterSummary: `Position ${targetIndex + 1}`, reason }],
      event: { eventType: 'sections_reordered', sectionKey, details: { from: index + 1, to: targetIndex + 1 } }
    });
  }

  async function selectContent(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(selectContent, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
    const before = currentSection(context.draft, sectionKey);
    if (!before) fail('Bid package section not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const reason = safeText(input.reason, 'Change reason', 2000, { required: true });
    let selectedClauses = context.draft.selectedClauses || [];
    let renderedContent = context.draft.renderedContent;
    let selectedIds;
    if (context.packageType === 'technical') {
      if (!isProjectLeadEngineer(actor, context.opportunity)) forbidden();
      selectedIds = normalizeIdList(input.contentIds);
      const publishedClauses = await dependencies.technicalTemplateRepository.listClauses({ publishedOnly: true });
      const publishedById = new Map(publishedClauses.map((clause) => [Number(clause.id), clause]));
      if (selectedIds.some((id) => !publishedById.has(id))) fail('Only published standard clauses can be selected');
      const defaultIds = new Set((baselineSection(context.draft, sectionKey)?.defaultClauseIds || []).map(Number));
      const sectionClauses = selectedIds.map((id) => {
        const clause = publishedById.get(id);
        return {
          id: Number(clause.id), clauseCode: clause.clauseCode, revisionNo: clause.revisionNo,
          revisionLabel: clause.revisionLabel, title: clause.title, language: clause.language,
          content: clause.content, conditionSchema: deepClone(clause.conditionSchema || {}),
          sectionKey, isTemplateDefault: defaultIds.has(id), standardChanged: !defaultIds.has(id)
        };
      });
      selectedClauses = [
        ...(context.draft.selectedClauses || []).filter((clause) => clause.sectionKey !== sectionKey),
        ...sectionClauses
      ];
      const selectedIdSet = new Set(selectedClauses.map((clause) => Number(clause.id)));
      const allDefaultIds = new Set((context.draft.contentSchemaSnapshot?.sections || [])
        .flatMap((section) => section.defaultClauseIds || []).map(Number));
      renderedContent = {
        ...context.draft.renderedContent,
        clauseSelectionChanged: selectedIdSet.size !== allDefaultIds.size
          || [...allDefaultIds].some((id) => !selectedIdSet.has(id)),
        sections: context.draft.renderedContent.sections.map((section) => ({
          ...section,
          clauses: selectedClauses.filter((clause) => clause.sectionKey === section.key)
        }))
      };
    } else {
      selectedIds = normalizeIdList(input.contentIds);
      const snapshots = [];
      for (const blockId of selectedIds) {
        const block = await dependencies.bidContentBlockRepository.getBlockDetail(blockId);
        const revision = block?.revisions?.find((candidate) => Number(candidate.id) === Number(block.currentPublishedRevisionId));
        if (!block || !revision || revision.status !== 'published' || !canViewBidContentBlock(actor, block)) {
          fail('Only accessible published public materials can be selected', 400, BID_CENTER_ERROR_CODES.VALIDATION);
        }
        if (revision.libraryType !== BID_LIBRARY_TYPES.PUBLIC_MATERIAL) fail('Only public materials can be selected');
        snapshots.push({
          blockId: block.id, blockCode: block.blockCode, category: block.category,
          ownerRoleCode: block.ownerRoleCode, nameEn: block.nameEn, nameZh: block.nameZh,
          revisionId: revision.id, revisionNo: revision.revisionNo, revisionLabel: revision.revisionLabel,
          language: revision.language, componentType: revision.componentType,
          titleEn: revision.titleEn, titleZh: revision.titleZh, contentSchema: deepClone(revision.contentSchema),
          sensitivity: revision.sensitivity, attachmentStoredPath: revision.attachmentStoredPath,
          attachmentOriginalName: revision.attachmentOriginalName, attachmentMimeType: revision.attachmentMimeType,
          attachmentByteSize: revision.attachmentByteSize, attachmentSha256: revision.attachmentSha256
        });
      }
      renderedContent = {
        ...context.draft.renderedContent,
        sections: context.draft.renderedContent.sections.map((section) => section.key === sectionKey
          ? { ...section, contentBlocks: snapshots, modificationStatus: 'customized' }
          : section)
      };
    }
    const after = renderedContent.sections.find((section) => section.key === sectionKey);
    await persistDraft(context, {
      variableValues: context.draft.variableValues, selectedClauses, renderedContent,
      validationIssues: context.packageType === 'technical'
        ? validateTechnicalDraftVariables(context.draft.variableSchemaSnapshot || [], context.draft.variableValues || {})
        : context.draft.validationIssues
    }, {
      actorUserId: Number(actor.id),
      changes: [{ sectionKey, modificationStatus: 'customized', changeType: 'source_changed', beforeSummary: summarizeSection(before), afterSummary: summarizeSection(after), reason }],
      event: { eventType: 'content_selected', sectionKey, details: { selectedIds } }
    });
  }

  async function addAttachment(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(addAttachment, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
    if (!currentSection(context.draft, sectionKey)) fail('Bid package section not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const reason = safeText(input.reason, 'Attachment reason', 2000, { required: true });
    const common = baseMutationContext(context.workspace, context.packageType, context.draft, actor, sectionKey);
    const attachment = await dependencies.bidPackageEditorRepository.createAttachment({ ...common, ...input });
    await dependencies.bidPackageEditorRepository.insertChange({
      ...common, modificationStatus: 'customized', changeType: 'source_changed',
      beforeSummary: '', afterSummary: `${attachment.originalName} (${attachment.byteSize} bytes)`, reason
    });
    await dependencies.bidPackageEditorRepository.insertEvent({
      ...common, eventType: 'attachment_added', details: { attachmentId: attachment.id, sha256: attachment.sha256 }
    });
    await dependencies.bidPackageEditorRepository.touchWorkspace(context.workspace.id, Number(actor.id));
    return attachment;
  }

  async function removeAttachment(actor, workspaceId, rawPackageType, attachmentId, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(removeAttachment, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const attachment = await dependencies.bidPackageEditorRepository.findAttachment(positiveInteger(attachmentId, 'Attachment'));
    if (!attachment || attachment.workspaceId !== context.workspace.id || attachment.packageType !== context.packageType || attachment.removedAt) {
      fail('Attachment not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    }
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, attachment.sectionKey);
    const reason = safeText(input.reason, 'Removal reason', 2000, { required: true });
    const common = baseMutationContext(context.workspace, context.packageType, context.draft, actor, attachment.sectionKey);
    await dependencies.bidPackageEditorRepository.removeAttachment({ workspaceId: context.workspace.id, attachmentId: attachment.id, actorUserId: Number(actor.id) });
    await dependencies.bidPackageEditorRepository.insertChange({
      ...common, modificationStatus: 'customized', changeType: 'source_changed',
      beforeSummary: attachment.originalName, afterSummary: 'Attachment removed from project draft', reason
    });
    await dependencies.bidPackageEditorRepository.insertEvent({ ...common, eventType: 'attachment_removed', details: { attachmentId: attachment.id } });
    await dependencies.bidPackageEditorRepository.touchWorkspace(context.workspace.id, Number(actor.id));
  }

  async function getAttachment(actor, workspaceId, rawPackageType, attachmentId) {
    const context = await load(actor, workspaceId, rawPackageType);
    const attachment = await dependencies.bidPackageEditorRepository.findAttachment(positiveInteger(attachmentId, 'Attachment'));
    if (!attachment || attachment.workspaceId !== context.workspace.id || attachment.packageType !== context.packageType || attachment.removedAt) {
      fail('Attachment not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    }
    return attachment;
  }

  async function suggestLibrary(actor, workspaceId, rawPackageType, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(suggestLibrary, arguments);
    const context = await load(actor, workspaceId, rawPackageType);
    ensureDraftEditable(context.packageType, context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    ensureSectionEditor(actor, context.opportunity, context.packageType, context.draft, sectionKey);
    const section = currentSection(context.draft, sectionKey);
    if (!section) fail('Bid package section not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const reason = safeText(input.reason, 'Suggestion reason', 2000, { required: true });
    const title = safeText(input.title || section.labelEn || section.labelZh || section.key, 'Suggestion title', 300, { required: true });
    const targetKind = input.targetKind === 'template_revision' ? 'template_revision' : 'content_block';
    const common = baseMutationContext(context.workspace, context.packageType, context.draft, actor, sectionKey);
    const suggestion = await dependencies.bidPackageEditorRepository.createSuggestion({
      ...common, targetKind, title, reason,
      contentSnapshot: { schemaVersion: 1, section: deepClone(section), sourceChangeId: section.lastChange?.id || null }
    });
    await dependencies.bidPackageEditorRepository.insertChange({
      ...common, modificationStatus: section.modificationStatus || 'customized', changeType: 'source_changed',
      beforeSummary: '', afterSummary: `Library suggestion draft #${suggestion.id}`, reason
    });
    await dependencies.bidPackageEditorRepository.insertEvent({
      ...common, eventType: 'library_suggestion_created', details: { suggestionId: suggestion.id, targetKind }
    });
    await dependencies.bidPackageEditorRepository.touchWorkspace(context.workspace.id, Number(actor.id));
    return suggestion;
  }

  async function assignSection(actor, workspaceId, rawSectionKey, input) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(assignSection, arguments);
    const context = await load(actor, workspaceId, 'technical');
    ensureDraftEditable('technical', context.draft);
    const sectionKey = sectionKeyValue(rawSectionKey);
    const assignment = await assignOpportunityTechnicalDraftSection(
      dependencies.opportunityTechnicalDraftRepository, actor, context.opportunity, context.draft,
      { sectionKey, assigneeUserId: input.assigneeUserId, dueDate: input.dueDate }
    );
    await dependencies.bidPackageEditorRepository.insertEvent({
      ...baseMutationContext(context.workspace, 'technical', context.draft, actor, sectionKey),
      eventType: 'assignment_added', details: { assignmentId: assignment.id, assigneeUserId: assignment.assigneeUserId }
    });
    return assignment;
  }

  async function removeAssignment(actor, workspaceId, assignmentId) {
    if (typeof dependencies.workflowTransaction === 'function') return inTransaction(removeAssignment, arguments);
    const context = await load(actor, workspaceId, 'technical');
    ensureDraftEditable('technical', context.draft);
    const existing = (context.draft.assignments || []).find((item) => item.id === Number(assignmentId) && item.isActive !== false);
    if (!existing) fail('Section assignment not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    await removeOpportunityTechnicalDraftSectionAssignment(
      dependencies.opportunityTechnicalDraftRepository, actor, context.opportunity, context.draft, assignmentId
    );
    await dependencies.bidPackageEditorRepository.insertEvent({
      ...baseMutationContext(context.workspace, 'technical', context.draft, actor, existing.sectionKey),
      eventType: 'assignment_removed', details: { assignmentId: existing.id, assigneeUserId: existing.assigneeUserId }
    });
  }

  return Object.freeze({
    getEditor,
    saveSection,
    saveVariables,
    addSection,
    omitSection,
    restoreSection,
    reorderSection,
    selectContent,
    addAttachment,
    removeAttachment,
    getAttachment,
    suggestLibrary,
    assignSection,
    removeAssignment
  });
}
