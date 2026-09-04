import { ROLES, hasRole } from '../domain/roles.mjs';
import { opportunityTechnicalDraftLabel } from '../domain/technicalTemplates.mjs';
import {
  canViewOpportunity,
  isProjectLeadEngineer,
  isSupportingEngineer
} from './opportunityService.mjs';

const unsafeStructuredText = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;
const sectionKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;

function serviceError(message, statusCode, details = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  return error;
}

function forbidden() {
  throw serviceError('Forbidden', 403);
}

function invalid(message, details) {
  throw serviceError(message, 400, details);
}

function conflict(message, details) {
  throw serviceError(message, 409, details);
}

function notFound(message) {
  throw serviceError(message, 404);
}

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) invalid(`${field} is invalid`);
  return normalized;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeText(value, field, maxLength = 100000) {
  const normalized = text(value);
  if (normalized.length > maxLength) invalid(`${field} is too long`);
  if (normalized && unsafeStructuredText.test(normalized)) {
    invalid(`${field} contains unsupported template or script syntax`);
  }
  return normalized;
}

function normalizeTableRows(value) {
  const rows = text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((cell) => safeText(cell, 'Table cell', 500)));
  if (rows.length > 200 || rows.some((row) => row.length > 12)) invalid('Section table rows are invalid');
  return rows;
}

function normalizeIdList(value) {
  const values = (Array.isArray(value) ? value : text(value).split(/[\r\n,]+/))
    .map((item) => Number(String(item).trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  if (values.length > 100) invalid('Clause selection is invalid');
  return [...new Set(values)];
}

function actorSectionKeys(actor, draft) {
  const actorId = Number(actor.id);
  return new Set((draft.assignments || [])
    .filter((assignment) => assignment.isActive !== false && Number(assignment.assigneeUserId) === actorId)
    .map((assignment) => assignment.sectionKey));
}

export function canViewOpportunityTechnicalDraft(actor, opportunity) {
  return canViewOpportunity(actor, opportunity);
}

export function canCreateOpportunityTechnicalDraft(actor, opportunity) {
  return isProjectLeadEngineer(actor, opportunity);
}

export function canReviewOpportunityTechnicalDraft(actor, opportunity, draft) {
  return draft?.status === 'pending'
    && hasRole(actor, ROLES.TECHNICAL_MANAGER)
    && Number(opportunity.technicalManagerId) === Number(actor.id);
}

export function canEditOpportunityTechnicalDraftSection(actor, opportunity, draft, sectionKey) {
  if (!['draft', 'ready'].includes(draft?.status)) return false;
  if (isProjectLeadEngineer(actor, opportunity)) return true;
  return isSupportingEngineer(actor, opportunity) && actorSectionKeys(actor, draft).has(sectionKey);
}

function ensureViewer(actor, opportunity) {
  if (!canViewOpportunityTechnicalDraft(actor, opportunity)) forbidden();
}

function ensureLead(actor, opportunity) {
  if (!canCreateOpportunityTechnicalDraft(actor, opportunity)) forbidden();
}

function ensureEditableDraft(draft) {
  if (!['draft', 'ready'].includes(draft?.status)) {
    conflict('Submitted technical solution versions are read-only');
  }
}

function sourceValue(variable, context, template) {
  const values = {
    manual: '',
    customer_name: context.customerName,
    contact_name: context.contactName,
    opportunity_title: context.opportunityTitle,
    requirement_summary: context.requirementSummary,
    product_name: context.productName,
    product_model: template.productModel,
    capacity: context.capacity,
    medium: context.medium,
    temperature: context.temperature,
    pressure: context.pressure,
    material: context.material,
    motor: context.motor,
    voltage_frequency: context.voltageFrequency,
    hazardous_area_rating: context.hazardousAreaRating,
    standards: context.standards,
    delivery_destination: context.deliveryDestination,
    opportunity_owner: context.opportunityOwner
  };
  return values[variable.sourceField] ?? '';
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function validIsoDate(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized;
}

function normalizeVariableValue(variable, rawValue, { strict = true } = {}) {
  if (isBlank(rawValue)) return '';
  if (variable.dataType === 'number' || variable.dataType === 'integer') {
    const normalized = Number(rawValue);
    if (!Number.isFinite(normalized) || (variable.dataType === 'integer' && !Number.isInteger(normalized))) {
      if (strict) invalid(`${variable.variableKey} has an invalid ${variable.dataType} value`);
      return String(rawValue);
    }
    return normalized;
  }
  if (variable.dataType === 'boolean') {
    if (rawValue === true || rawValue === 'true' || rawValue === '1' || rawValue === 'on') return true;
    if (rawValue === false || rawValue === 'false' || rawValue === '0' || rawValue === 'off') return false;
    if (strict) invalid(`${variable.variableKey} has an invalid boolean value`);
  }
  if (variable.dataType === 'date') {
    const normalized = text(rawValue);
    if (!validIsoDate(normalized) && strict) invalid(`${variable.variableKey} has an invalid date value`);
    return normalized;
  }
  return safeText(rawValue, variable.variableKey, 5000);
}

export function prefillTechnicalDraftVariables(variableSchema, context, template) {
  const values = {};
  for (const variable of variableSchema) {
    const sourced = sourceValue(variable, context, template);
    values[variable.variableKey] = normalizeVariableValue(
      variable,
      isBlank(sourced) ? variable.defaultValue : sourced,
      { strict: false }
    );
  }
  return values;
}

export function validateTechnicalDraftVariables(variableSchema, variableValues) {
  const issues = [];
  for (const variable of variableSchema) {
    const value = variableValues?.[variable.variableKey];
    if (variable.isRequired && isBlank(value)) {
      issues.push({
        variableKey: variable.variableKey,
        sectionKey: variable.sectionKey,
        code: 'required',
        labelEn: variable.labelEn,
        labelZh: variable.labelZh
      });
      continue;
    }
    if (isBlank(value)) continue;
    const rules = variable.validationRules || {};
    if (['number', 'integer'].includes(variable.dataType)) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue) || (variable.dataType === 'integer' && !Number.isInteger(numericValue))) {
        issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'type', labelEn: variable.labelEn, labelZh: variable.labelZh });
        continue;
      }
      if (rules.min !== undefined && numericValue < Number(rules.min)) {
        issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'minimum', expected: rules.min, labelEn: variable.labelEn, labelZh: variable.labelZh });
      }
      if (rules.max !== undefined && numericValue > Number(rules.max)) {
        issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'maximum', expected: rules.max, labelEn: variable.labelEn, labelZh: variable.labelZh });
      }
    } else if (variable.dataType === 'boolean' && typeof value !== 'boolean') {
      issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'type', labelEn: variable.labelEn, labelZh: variable.labelZh });
    } else if (variable.dataType === 'date' && !validIsoDate(value)) {
      issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'type', labelEn: variable.labelEn, labelZh: variable.labelZh });
    }
    if (Array.isArray(rules.allowedValues)
        && rules.allowedValues.length
        && !rules.allowedValues.map(String).includes(String(value))) {
      issues.push({
        variableKey: variable.variableKey,
        sectionKey: variable.sectionKey,
        code: 'allowed_values',
        expected: rules.allowedValues,
        labelEn: variable.labelEn,
        labelZh: variable.labelZh
      });
    }
  }
  return issues;
}

function conditionMatches(condition, values) {
  const operator = condition?.operator || 'always';
  if (operator === 'always') return true;
  const actual = values?.[condition.variableKey];
  if (operator === 'truthy') return Boolean(actual) && String(actual).toLowerCase() !== 'false';
  if (operator === 'equals') return String(actual ?? '') === String(condition.value ?? '');
  if (operator === 'not_equals') return String(actual ?? '') !== String(condition.value ?? '');
  if (operator === 'contains') return String(actual ?? '').includes(String(condition.value ?? ''));
  return false;
}

export function renderTechnicalDraftContent({
  contentSchema,
  variableSchema,
  variableValues,
  selectedClauses,
  currentSections = []
}) {
  const defaultClauseIds = new Set((contentSchema?.sections || []).flatMap((section) => section.defaultClauseIds || []).map(Number));
  const selectedClauseIds = new Set((selectedClauses || []).map((clause) => Number(clause.id)));
  const clauseSelectionChanged = defaultClauseIds.size !== selectedClauseIds.size
    || [...defaultClauseIds].some((clauseId) => !selectedClauseIds.has(clauseId));
  const currentByKey = new Map(currentSections.map((section) => [section.key, section]));
  const clausesBySection = new Map();
  for (const clause of selectedClauses || []) {
    const key = clause.sectionKey || 'documentation';
    if (!clausesBySection.has(key)) clausesBySection.set(key, []);
    clausesBySection.get(key).push(clause);
  }
  const sections = [...(contentSchema?.sections || [])]
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
    .map((section) => {
      const current = currentByKey.get(section.key);
      return {
        key: section.key,
        labelEn: section.labelEn,
        labelZh: section.labelZh,
        sortOrder: section.sortOrder,
        sectionType: section.sectionType || 'narrative',
        included: section.enabled !== false && conditionMatches(section.condition, variableValues),
        condition: deepClone(section.condition || { operator: 'always', variableKey: '', value: '' }),
        bodyEn: current?.bodyEn ?? section.bodyEn ?? '',
        bodyZh: current?.bodyZh ?? section.bodyZh ?? '',
        tableRows: deepClone(current?.tableRows ?? section.tableRows ?? []),
        standardChanged: Boolean(current?.standardChanged),
        lastEditedBy: current?.lastEditedBy || null,
        lastEditedAt: current?.lastEditedAt || null,
        clauses: deepClone(clausesBySection.get(section.key) || [])
      };
    });
  return {
    schemaVersion: 1,
    clauseSelectionChanged,
    sections,
    variables: (variableSchema || []).map((variable) => ({
      variableKey: variable.variableKey,
      labelEn: variable.labelEn,
      labelZh: variable.labelZh,
      sectionKey: variable.sectionKey,
      value: variableValues?.[variable.variableKey] ?? ''
    }))
  };
}

function clauseSnapshotsForTemplate(contentSchema, clauses) {
  const publishedById = new Map(clauses.filter((clause) => clause.status === 'published').map((clause) => [clause.id, clause]));
  const snapshots = [];
  for (const section of contentSchema.sections || []) {
    for (const clauseId of section.defaultClauseIds || []) {
      const clause = publishedById.get(Number(clauseId));
      if (!clause || snapshots.some((item) => item.id === clause.id)) continue;
      snapshots.push({
        id: clause.id,
        clauseCode: clause.clauseCode,
        revisionNo: clause.revisionNo,
        revisionLabel: clause.revisionLabel,
        title: clause.title,
        language: clause.language,
        content: clause.content,
        conditionSchema: deepClone(clause.conditionSchema),
        sectionKey: section.key,
        isTemplateDefault: true,
        standardChanged: false
      });
    }
  }
  return snapshots;
}

function technicalVariableSourceSnapshots(variableSchema, context, template, variableValues) {
  return Object.fromEntries(variableSchema.map((variable) => {
    const sourced = sourceValue(variable, context, template);
    const hasSourcedValue = !isBlank(sourced);
    const hasDefault = !hasSourcedValue && !isBlank(variable.defaultValue);
    return [variable.variableKey, {
      sourceType: hasSourcedValue ? 'crm' : hasDefault ? 'template_default' : 'manual',
      sourceField: variable.sourceField,
      valueAtCreation: variableValues[variable.variableKey] ?? ''
    }];
  }));
}

function applyTechnicalVariableOverrides(variableSchema, variableValues, variableSources, overrides = {}) {
  const nextValues = { ...variableValues };
  const nextSources = deepClone(variableSources) || {};
  for (const variable of variableSchema) {
    if (!Object.hasOwn(overrides, variable.variableKey)) continue;
    const normalized = normalizeVariableValue(variable, overrides[variable.variableKey]);
    if (String(normalized) === String(variableValues[variable.variableKey] ?? '')) continue;
    nextValues[variable.variableKey] = normalized;
    nextSources[variable.variableKey] = {
      sourceType: 'manual_override',
      sourceField: variable.sourceField,
      previousValue: variableValues[variable.variableKey] ?? '',
      valueAtCreation: normalized
    };
  }
  return { values: nextValues, sources: nextSources };
}

export async function buildOpportunityTechnicalDraftSnapshot(
  repositories,
  opportunity,
  template,
  revision,
  {
    language = template?.language,
    actorUserId,
    overrides = {},
    context: providedContext = null,
    snapshotAt = new Date().toISOString()
  } = {}
) {
  if (!template || template.isActive !== true
      || Number(template.currentPublishedRevisionId) !== Number(revision?.id)
      || revision?.status !== 'published'
      || ![language, 'bilingual'].includes(template.language)) {
    conflict('Only a compatible active current published technical template can generate a project draft');
  }
  const context = providedContext
    || await repositories.opportunityTechnicalDraftRepository.getGenerationContext(opportunity.id);
  const clauses = await repositories.technicalTemplateRepository.listClauses({ publishedOnly: true });
  if (!context) notFound('Opportunity generation context not found');
  const variableSchema = deepClone(revision.variables || []);
  const prefilledValues = prefillTechnicalDraftVariables(variableSchema, context, template);
  const prefilledSources = technicalVariableSourceSnapshots(variableSchema, context, template, prefilledValues);
  const resolved = applyTechnicalVariableOverrides(variableSchema, prefilledValues, prefilledSources, overrides);
  const selectedClauses = clauseSnapshotsForTemplate(revision.contentSchema, clauses);
  const validationIssues = validateTechnicalDraftVariables(variableSchema, resolved.values);
  const renderedContent = renderTechnicalDraftContent({
    contentSchema: revision.contentSchema,
    variableSchema,
    variableValues: resolved.values,
    selectedClauses
  });
  return {
    opportunityId: opportunity.id,
    templateRevisionId: revision.id,
    language,
    templateCodeSnapshot: template.templateCode,
    templateNameSnapshot: template.name,
    templateRevisionNoSnapshot: revision.revisionNo,
    contentSchemaSnapshot: deepClone(revision.contentSchema),
    variableSchemaSnapshot: variableSchema,
    variableValues: resolved.values,
    selectedClauses,
    renderedContent,
    sourceMetadata: {
      schemaVersion: 1,
      snapshotAt,
      opportunityId: opportunity.id,
      opportunityNo: opportunity.opportunityNo,
      customerId: opportunity.customerId,
      contactId: opportunity.primaryContactId,
      templateId: template.id,
      templateRevisionId: revision.id,
      prefilledSources: variableSchema
        .filter((variable) => !isBlank(resolved.values[variable.variableKey]))
        .map((variable) => variable.sourceField),
      variableValueSources: resolved.sources
    },
    validationIssues,
    actorUserId: Number(actorUserId)
  };
}

export async function generateOpportunityTechnicalDraft(repositories, actor, opportunity, templateId) {
  ensureLead(actor, opportunity);
  const template = await repositories.technicalTemplateRepository.getTemplateDetail(positiveInteger(templateId, 'Template'));
  if (!template || template.isActive !== true || !template.currentPublishedRevisionId) {
    conflict('Only an active published template can generate a project draft');
  }
  const revision = template.revisions.find((candidate) => candidate.id === template.currentPublishedRevisionId);
  if (!revision || revision.status !== 'published') {
    conflict('Only an active published template can generate a project draft');
  }
  const snapshot = await buildOpportunityTechnicalDraftSnapshot(
    repositories,
    opportunity,
    template,
    revision,
    { language: template.language, actorUserId: actor.id }
  );
  return repositories.opportunityTechnicalDraftRepository.createDraft(snapshot);
}

export async function listOpportunityTechnicalDrafts(repository, actor, opportunity) {
  ensureViewer(actor, opportunity);
  return repository.listByOpportunity(opportunity.id);
}

export async function getOpportunityTechnicalDraft(repository, actor, opportunity, draftId) {
  ensureViewer(actor, opportunity);
  const draft = await repository.getDraftDetail(positiveInteger(draftId, 'Technical draft'));
  if (!draft || draft.opportunityId !== Number(opportunity.id)) notFound('Technical draft not found');
  return draft;
}

export async function updateOpportunityTechnicalDraftVariables(repository, actor, opportunity, draft, submittedValues) {
  ensureViewer(actor, opportunity);
  ensureEditableDraft(draft);
  const lead = isProjectLeadEngineer(actor, opportunity);
  const allowedSections = actorSectionKeys(actor, draft);
  if (!lead && !isSupportingEngineer(actor, opportunity)) forbidden();
  const nextValues = { ...(draft.variableValues || {}) };
  for (const variable of draft.variableSchemaSnapshot || []) {
    if (!Object.hasOwn(submittedValues, variable.variableKey)) continue;
    if (!lead && !allowedSections.has(variable.sectionKey)) forbidden();
    nextValues[variable.variableKey] = normalizeVariableValue(variable, submittedValues[variable.variableKey]);
  }
  const validationIssues = validateTechnicalDraftVariables(draft.variableSchemaSnapshot, nextValues);
  const renderedContent = renderTechnicalDraftContent({
    contentSchema: draft.contentSchemaSnapshot,
    variableSchema: draft.variableSchemaSnapshot,
    variableValues: nextValues,
    selectedClauses: draft.selectedClauses,
    currentSections: draft.renderedContent?.sections
  });
  return repository.updateVariables({
    draftId: draft.id,
    variableValues: nextValues,
    renderedContent,
    validationIssues,
    actorUserId: Number(actor.id)
  });
}

export async function updateOpportunityTechnicalDraftSection(repository, actor, opportunity, draft, sectionKey, input) {
  ensureViewer(actor, opportunity);
  ensureEditableDraft(draft);
  if (!sectionKeyPattern.test(text(sectionKey))) invalid('Technical section is invalid');
  if (!canEditOpportunityTechnicalDraftSection(actor, opportunity, draft, sectionKey)) forbidden();
  const sourceSection = (draft.contentSchemaSnapshot?.sections || []).find((section) => section.key === sectionKey);
  const currentSection = (draft.renderedContent?.sections || []).find((section) => section.key === sectionKey);
  if (!sourceSection || !currentSection) notFound('Technical section not found');
  const bodyEn = safeText(input.bodyEn, 'English section content');
  const bodyZh = safeText(input.bodyZh, 'Chinese section content');
  const tableRows = normalizeTableRows(input.tableRows);
  const standardChanged = bodyEn !== (sourceSection.bodyEn || '')
    || bodyZh !== (sourceSection.bodyZh || '')
    || JSON.stringify(tableRows) !== JSON.stringify(sourceSection.tableRows || []);
  const nextSections = draft.renderedContent.sections.map((section) => section.key === sectionKey ? {
    ...section,
    bodyEn,
    bodyZh,
    tableRows,
    standardChanged,
    lastEditedBy: Number(actor.id),
    lastEditedAt: new Date().toISOString()
  } : section);
  return repository.updateSection({
    draftId: draft.id,
    sectionKey,
    renderedContent: { ...draft.renderedContent, sections: nextSections },
    standardChanged,
    actorUserId: Number(actor.id)
  });
}

export async function updateOpportunityTechnicalDraftClauses(repositories, actor, opportunity, draft, clauseIds) {
  ensureLead(actor, opportunity);
  ensureEditableDraft(draft);
  const requestedIds = normalizeIdList(clauseIds);
  const clauses = await repositories.technicalTemplateRepository.listClauses({ publishedOnly: true });
  const clausesById = new Map(clauses.map((clause) => [clause.id, clause]));
  if (requestedIds.some((clauseId) => !clausesById.has(clauseId))) {
    invalid('Only published standard clauses can be selected');
  }
  const defaultSectionByClauseId = new Map();
  for (const section of draft.contentSchemaSnapshot.sections || []) {
    for (const clauseId of section.defaultClauseIds || []) defaultSectionByClauseId.set(Number(clauseId), section.key);
  }
  const selectedClauses = requestedIds.map((clauseId) => {
    const clause = clausesById.get(clauseId);
    const isDefault = defaultSectionByClauseId.has(clauseId);
    return {
      id: clause.id,
      clauseCode: clause.clauseCode,
      revisionNo: clause.revisionNo,
      revisionLabel: clause.revisionLabel,
      title: clause.title,
      language: clause.language,
      content: clause.content,
      conditionSchema: deepClone(clause.conditionSchema),
      sectionKey: defaultSectionByClauseId.get(clauseId) || 'documentation',
      isTemplateDefault: isDefault,
      standardChanged: !isDefault
    };
  });
  const renderedContent = renderTechnicalDraftContent({
    contentSchema: draft.contentSchemaSnapshot,
    variableSchema: draft.variableSchemaSnapshot,
    variableValues: draft.variableValues,
    selectedClauses,
    currentSections: draft.renderedContent?.sections
  });
  return repositories.opportunityTechnicalDraftRepository.updateClauses({
    draftId: draft.id,
    selectedClauses,
    renderedContent,
    actorUserId: Number(actor.id)
  });
}

export async function assignOpportunityTechnicalDraftSection(repository, actor, opportunity, draft, input) {
  ensureLead(actor, opportunity);
  ensureEditableDraft(draft);
  const sectionKey = text(input.sectionKey);
  if (!sectionKeyPattern.test(sectionKey)
      || !(draft.contentSchemaSnapshot?.sections || []).some((section) => section.key === sectionKey)) {
    invalid('Technical section is invalid');
  }
  const assigneeUserId = positiveInteger(input.assigneeUserId, 'Supporting Engineer');
  const isSupportingMember = (opportunity.teamMembers || []).some((member) => (
    Number(member.userId) === assigneeUserId
    && member.roleCode === ROLES.QUOTATION_ENGINEER
    && member.isActive !== false
    && Number(member.userId) !== Number(opportunity.quotationEngineerId)
  ));
  if (!isSupportingMember) invalid('Section assignee must be an active Supporting Engineer');
  const dueDate = text(input.dueDate);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) invalid('Assignment due date is invalid');
  return repository.addAssignment({
    draftId: draft.id,
    sectionKey,
    assigneeUserId,
    dueDate: dueDate || null,
    actorUserId: Number(actor.id)
  });
}

export async function removeOpportunityTechnicalDraftSectionAssignment(repository, actor, opportunity, draft, assignmentId) {
  ensureLead(actor, opportunity);
  ensureEditableDraft(draft);
  const removed = await repository.removeAssignment({
    draftId: draft.id,
    assignmentId: positiveInteger(assignmentId, 'Section assignment'),
    actorUserId: Number(actor.id)
  });
  if (!removed) notFound('Section assignment not found');
  return removed;
}

export async function markOpportunityTechnicalDraftReady(repository, actor, opportunity, draft) {
  ensureLead(actor, opportunity);
  ensureEditableDraft(draft);
  const validationIssues = validateTechnicalDraftVariables(draft.variableSchemaSnapshot, draft.variableValues);
  if (validationIssues.length) {
    conflict('Required or engineering-range variables must be corrected before submission', validationIssues);
  }
  return repository.markReady({
    draftId: draft.id,
    validationIssues,
    actorUserId: Number(actor.id)
  });
}

export function technicalDraftLabel(draft) {
  return opportunityTechnicalDraftLabel(draft.draftRevisionNo);
}

export function technicalDraftDisplayLabel(draft) {
  return draft.formalVersionLabel || technicalDraftLabel(draft);
}

export function technicalDraftSubmissionSummary(draft) {
  const sections = (draft.renderedContent?.sections || [])
    .filter((section) => section.included !== false)
    .map((section) => section.labelEn || section.labelZh || section.key)
    .filter(Boolean);
  return `${technicalDraftLabel(draft)} generated from ${draft.templateCodeSnapshot} TPL-R${draft.templateRevisionNoSnapshot}; sections: ${sections.join(', ')}`;
}
