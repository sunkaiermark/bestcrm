import { ROLES, hasRole } from '../domain/roles.mjs';
import {
  DEFAULT_TECHNICAL_AGREEMENT_SCHEMA,
  TECHNICAL_TEMPLATE_LANGUAGES,
  TECHNICAL_TEMPLATE_VARIABLE_SOURCES,
  TECHNICAL_TEMPLATE_VARIABLE_TYPES
} from '../domain/technicalTemplates.mjs';

const languageSet = new Set(TECHNICAL_TEMPLATE_LANGUAGES);
const variableTypeSet = new Set(TECHNICAL_TEMPLATE_VARIABLE_TYPES);
const variableSourceSet = new Set(TECHNICAL_TEMPLATE_VARIABLE_SOURCES);
const codePattern = /^[A-Z][A-Z0-9-]{0,31}$/;
const variableKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const unsafeTemplateSyntax = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function forbidden() {
  throw serviceError('Forbidden', 403);
}

function notFound(message) {
  throw serviceError(message, 404);
}

function invalid(message) {
  throw serviceError(message, 400);
}

function conflict(message) {
  throw serviceError(message, 409);
}

function text(value) {
  return String(value ?? '').trim();
}

function requiredText(value, field, maxLength = 500) {
  const normalized = text(value);
  if (!normalized) {
    invalid(`${field} is required`);
  }
  if (normalized.length > maxLength) {
    invalid(`${field} is too long`);
  }
  return normalized;
}

function optionalText(value, field, maxLength = 500) {
  const normalized = text(value);
  if (normalized.length > maxLength) {
    invalid(`${field} is too long`);
  }
  return normalized || null;
}

function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    invalid(`${field} is invalid`);
  }
  return normalized;
}

function checkbox(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function safeTemplateText(value, field, maxLength = 2000) {
  const normalized = optionalText(value, field, maxLength);
  if (normalized && unsafeTemplateSyntax.test(normalized)) {
    invalid(`${field} contains unsupported template or script syntax`);
  }
  return normalized;
}

function normalizeCode(value, field) {
  const normalized = requiredText(value, field, 32).toUpperCase();
  if (!codePattern.test(normalized)) {
    invalid(`${field} must use uppercase letters, numbers, and hyphens`);
  }
  return normalized;
}

function normalizeLanguage(value) {
  const normalized = text(value);
  if (!languageSet.has(normalized)) {
    invalid('Template language is invalid');
  }
  return normalized;
}

function numberOrNull(value, field) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    invalid(`${field} must be a number`);
  }
  return normalized;
}

function normalizeAllowedValues(value) {
  const values = text(value)
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length > 50 || values.some((item) => item.length > 120)) {
    invalid('Allowed values are invalid');
  }
  if (values.some((item) => unsafeTemplateSyntax.test(item))) {
    invalid('Allowed values contain unsupported template or script syntax');
  }
  return [...new Set(values)];
}

function ensureTemplateViewer(user) {
  if (!canViewTechnicalTemplateLibrary(user)) {
    forbidden();
  }
}

function ensureTemplateAuthor(user) {
  if (!canAuthorTechnicalTemplates(user)) {
    forbidden();
  }
}

function ensureVariableAdministrator(user) {
  if (!canManageTechnicalVariableCatalog(user)) {
    forbidden();
  }
}

export function canViewTechnicalTemplateLibrary(user) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || hasRole(user, ROLES.TECHNICAL_MANAGER)
    || hasRole(user, ROLES.QUOTATION_ENGINEER);
}

export function canAuthorTechnicalTemplates(user) {
  return hasRole(user, ROLES.TECHNICAL_MANAGER);
}

export function canManageTechnicalVariableCatalog(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

export function canViewTechnicalTemplate(user, template) {
  if (hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.TECHNICAL_MANAGER)) {
    return true;
  }
  return hasRole(user, ROLES.QUOTATION_ENGINEER)
    && template?.isActive === true
    && template?.currentPublishedRevisionId !== null
    && template?.currentPublishedRevisionId !== undefined
    && Number.isInteger(Number(template.currentPublishedRevisionId))
    && Number(template.currentPublishedRevisionId) > 0;
}

export function normalizeTechnicalTemplateInput(input) {
  return {
    templateCode: normalizeCode(input.templateCode, 'Template code'),
    name: requiredText(input.name, 'Template name', 200),
    productFamily: requiredText(input.productFamily, 'Product family', 200),
    productModel: optionalText(input.productModel, 'Product model', 200),
    application: optionalText(input.application, 'Application', 300),
    language: normalizeLanguage(input.language),
    changeSummary: requiredText(input.changeSummary, 'Change summary', 2000),
    contentSchema: DEFAULT_TECHNICAL_AGREEMENT_SCHEMA
  };
}

export function normalizeTechnicalTemplateMetadataInput(input) {
  return {
    name: requiredText(input.name, 'Template name', 200),
    productFamily: requiredText(input.productFamily, 'Product family', 200),
    productModel: optionalText(input.productModel, 'Product model', 200),
    application: optionalText(input.application, 'Application', 300)
  };
}

export function normalizeVariableDefinitionInput(input) {
  const variableKey = requiredText(input.variableKey, 'Variable key', 64).toLowerCase();
  const dataType = text(input.dataType);
  const sourceField = text(input.sourceField);
  if (!variableKeyPattern.test(variableKey)) {
    invalid('Variable key must use lowercase letters, numbers, and underscores');
  }
  if (!variableTypeSet.has(dataType)) {
    invalid('Variable data type is invalid');
  }
  if (!variableSourceSet.has(sourceField)) {
    invalid('Variable source field is not allowed');
  }
  return {
    variableKey,
    labelEn: requiredText(input.labelEn, 'English label', 200),
    labelZh: requiredText(input.labelZh, 'Chinese label', 200),
    dataType,
    sourceField,
    isActive: checkbox(input.isActive)
  };
}

export function normalizeRevisionVariableInput(input) {
  const min = numberOrNull(input.minValue, 'Minimum value');
  const max = numberOrNull(input.maxValue, 'Maximum value');
  if (min !== null && max !== null && min > max) {
    invalid('Minimum value cannot exceed maximum value');
  }
  const allowedValues = normalizeAllowedValues(input.allowedValues);
  const validationRules = {};
  if (min !== null) validationRules.min = min;
  if (max !== null) validationRules.max = max;
  if (allowedValues.length) validationRules.allowedValues = allowedValues;
  return {
    variableDefinitionId: positiveInteger(input.variableDefinitionId, 'Variable definition'),
    isRequired: checkbox(input.isRequired),
    defaultValue: safeTemplateText(input.defaultValue, 'Default value'),
    validationRules,
    sortOrder: positiveInteger(input.sortOrder || 1, 'Sort order')
  };
}

export function normalizeTechnicalClauseInput(input, { includeCode = true } = {}) {
  const normalized = {
    title: requiredText(input.title, 'Clause title', 300),
    language: normalizeLanguage(input.language),
    productFamily: optionalText(input.productFamily, 'Product family', 200),
    productModel: optionalText(input.productModel, 'Product model', 200),
    application: optionalText(input.application, 'Application', 300),
    content: requiredText(input.content, 'Clause content', 100000),
    changeSummary: requiredText(input.changeSummary, 'Change summary', 2000),
    conditionSchema: { all: [] }
  };
  if (includeCode) {
    normalized.clauseCode = normalizeCode(input.clauseCode, 'Clause code');
  }
  return normalized;
}

export async function listTechnicalTemplates(repository, actor) {
  ensureTemplateViewer(actor);
  const publishedOnly = !hasRole(actor, ROLES.ADMINISTRATOR)
    && !hasRole(actor, ROLES.TECHNICAL_MANAGER);
  return repository.listTemplates({ publishedOnly });
}

export async function getTechnicalTemplateDetail(repository, actor, templateId) {
  ensureTemplateViewer(actor);
  const template = await repository.getTemplateDetail(positiveInteger(templateId, 'Template'));
  if (!template) {
    notFound('Technical template not found');
  }
  if (!canViewTechnicalTemplate(actor, template)) {
    forbidden();
  }
  return template;
}

export async function createTechnicalTemplate(repository, actor, input) {
  ensureTemplateAuthor(actor);
  return repository.createTemplate(normalizeTechnicalTemplateInput(input), Number(actor.id));
}

export async function updateTechnicalTemplate(repository, actor, templateId, input) {
  ensureTemplateAuthor(actor);
  const updated = await repository.updateTemplate(
    positiveInteger(templateId, 'Template'),
    normalizeTechnicalTemplateMetadataInput(input),
    Number(actor.id)
  );
  if (!updated) notFound('Technical template not found');
  return updated;
}

export async function createTechnicalTemplateRevision(repository, actor, templateId, input) {
  ensureTemplateAuthor(actor);
  const created = await repository.createRevision(
    positiveInteger(templateId, 'Template'),
    requiredText(input.changeSummary, 'Change summary', 2000),
    Number(actor.id)
  );
  if (!created) conflict('A draft or pending revision already exists');
  return created;
}

export async function submitTechnicalTemplateRevision(repository, actor, revisionId) {
  ensureTemplateAuthor(actor);
  const updated = await repository.submitRevision(positiveInteger(revisionId, 'Template revision'), Number(actor.id));
  if (!updated) conflict('Only a draft revision can be submitted');
  return updated;
}

export async function publishTechnicalTemplateRevision(repository, actor, revisionId) {
  ensureTemplateAuthor(actor);
  const updated = await repository.publishRevision(positiveInteger(revisionId, 'Template revision'), Number(actor.id));
  if (!updated) conflict('Only a pending revision can be published');
  return updated;
}

export async function retireTechnicalTemplateRevision(repository, actor, revisionId) {
  ensureTemplateAuthor(actor);
  const updated = await repository.retireRevision(positiveInteger(revisionId, 'Template revision'), Number(actor.id));
  if (!updated) conflict('Only the current published revision can be retired');
  return updated;
}

export async function addTechnicalTemplateRevisionVariable(repository, actor, revisionId, input) {
  ensureTemplateAuthor(actor);
  const variable = normalizeRevisionVariableInput(input);
  const saved = await repository.upsertRevisionVariable(
    positiveInteger(revisionId, 'Template revision'),
    variable,
    Number(actor.id)
  );
  if (!saved) conflict('Variables can only be changed on draft revisions using active catalogue entries');
  return saved;
}

export async function removeTechnicalTemplateRevisionVariable(repository, actor, revisionId, variableId) {
  ensureTemplateAuthor(actor);
  const removed = await repository.removeRevisionVariable(
    positiveInteger(revisionId, 'Template revision'),
    positiveInteger(variableId, 'Template variable'),
    Number(actor.id)
  );
  if (!removed) conflict('Variables can only be removed from draft revisions');
  return removed;
}

export async function listTechnicalVariableDefinitions(repository, actor, options = {}) {
  if (!hasRole(actor, ROLES.ADMINISTRATOR) && !hasRole(actor, ROLES.TECHNICAL_MANAGER)) {
    forbidden();
  }
  return repository.listVariableDefinitions({
    activeOnly: options.forTemplate === true || !hasRole(actor, ROLES.ADMINISTRATOR)
  });
}

export async function createTechnicalVariableDefinition(repository, actor, input) {
  ensureVariableAdministrator(actor);
  return repository.createVariableDefinition(normalizeVariableDefinitionInput(input), Number(actor.id));
}

export async function updateTechnicalVariableDefinition(repository, actor, definitionId, input) {
  ensureVariableAdministrator(actor);
  const updated = await repository.updateVariableDefinition(
    positiveInteger(definitionId, 'Variable definition'),
    normalizeVariableDefinitionInput(input),
    Number(actor.id)
  );
  if (!updated) notFound('Variable definition not found');
  return updated;
}

export async function deactivateTechnicalVariableDefinition(repository, actor, definitionId) {
  ensureVariableAdministrator(actor);
  const updated = await repository.deactivateVariableDefinition(
    positiveInteger(definitionId, 'Variable definition'),
    Number(actor.id)
  );
  if (!updated) notFound('Variable definition not found');
  return updated;
}

export async function listTechnicalClauses(repository, actor) {
  ensureTemplateViewer(actor);
  const publishedOnly = !hasRole(actor, ROLES.ADMINISTRATOR)
    && !hasRole(actor, ROLES.TECHNICAL_MANAGER);
  return repository.listClauses({ publishedOnly });
}

export async function getTechnicalClause(repository, actor, clauseId) {
  ensureTemplateViewer(actor);
  const clause = await repository.findClauseById(positiveInteger(clauseId, 'Clause'));
  if (!clause) notFound('Technical clause not found');
  if (!hasRole(actor, ROLES.ADMINISTRATOR)
      && !hasRole(actor, ROLES.TECHNICAL_MANAGER)
      && clause.status !== 'published') {
    forbidden();
  }
  return clause;
}

export async function createTechnicalClause(repository, actor, input) {
  ensureTemplateAuthor(actor);
  return repository.createClause(normalizeTechnicalClauseInput(input), Number(actor.id));
}

export async function updateTechnicalClause(repository, actor, clauseId, input) {
  ensureTemplateAuthor(actor);
  const updated = await repository.updateClause(
    positiveInteger(clauseId, 'Clause'),
    normalizeTechnicalClauseInput(input, { includeCode: false }),
    Number(actor.id)
  );
  if (!updated) conflict('Only a draft clause can be edited');
  return updated;
}

export async function createTechnicalClauseRevision(repository, actor, clauseId, input) {
  ensureTemplateAuthor(actor);
  const created = await repository.createClauseRevision(
    positiveInteger(clauseId, 'Clause'),
    requiredText(input.changeSummary, 'Change summary', 2000),
    Number(actor.id)
  );
  if (!created) conflict('A draft or pending clause revision already exists');
  return created;
}

export async function submitTechnicalClause(repository, actor, clauseId) {
  ensureTemplateAuthor(actor);
  const updated = await repository.submitClause(positiveInteger(clauseId, 'Clause'), Number(actor.id));
  if (!updated) conflict('Only a draft clause can be submitted');
  return updated;
}

export async function publishTechnicalClause(repository, actor, clauseId) {
  ensureTemplateAuthor(actor);
  const updated = await repository.publishClause(positiveInteger(clauseId, 'Clause'), Number(actor.id));
  if (!updated) conflict('Only a pending clause can be published');
  return updated;
}

export async function retireTechnicalClause(repository, actor, clauseId) {
  ensureTemplateAuthor(actor);
  const updated = await repository.retireClause(positiveInteger(clauseId, 'Clause'), Number(actor.id));
  if (!updated) conflict('Only a published clause can be retired');
  return updated;
}
