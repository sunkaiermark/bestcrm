import { ROLES, hasRole } from '../domain/roles.mjs';
import {
  DEFAULT_TECHNICAL_AGREEMENT_SCHEMA,
  TECHNICAL_DOCUMENT_DEFAULT_SCHEMAS,
  TECHNICAL_DOCUMENT_TYPES,
  TECHNICAL_PRODUCT_CATEGORIES,
  TECHNICAL_SECTION_CONDITION_OPERATORS,
  TECHNICAL_SECTION_TYPES,
  TECHNICAL_IMAGE_ALIGNMENTS,
  TECHNICAL_TABLE_ALIGNMENTS,
  TECHNICAL_TEMPLATE_LANGUAGES,
  TECHNICAL_TEMPLATE_VARIABLE_SOURCES,
  TECHNICAL_TEMPLATE_VARIABLE_TYPES,
  localizedTechnicalField,
  technicalContentLanguage,
  technicalProductCategory
} from '../domain/technicalTemplates.mjs';

const languageSet = new Set(TECHNICAL_TEMPLATE_LANGUAGES);
const variableTypeSet = new Set(TECHNICAL_TEMPLATE_VARIABLE_TYPES);
const variableSourceSet = new Set(TECHNICAL_TEMPLATE_VARIABLE_SOURCES);
const sectionTypeSet = new Set(TECHNICAL_SECTION_TYPES);
const sectionConditionOperatorSet = new Set(TECHNICAL_SECTION_CONDITION_OPERATORS);
const tableAlignmentSet = new Set(TECHNICAL_TABLE_ALIGNMENTS);
const imageAlignmentSet = new Set(TECHNICAL_IMAGE_ALIGNMENTS);
const documentTypeSet = new Set(TECHNICAL_DOCUMENT_TYPES.map((item) => item.value));
const productCategorySet = new Set(TECHNICAL_PRODUCT_CATEGORIES.map((item) => item.code));
const codePattern = /^[A-Z][A-Z0-9-]{0,31}$/;
const variableKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const sectionKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const unsafeTemplateSyntax = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;
const MAX_SECTION_IMAGE_BYTES = 2 * 1024 * 1024;

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
  if (Array.isArray(value)) return value.some((item) => checkbox(item));
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

function normalizeContentLanguage(value) {
  const normalized = text(value);
  if (!['en', 'zh'].includes(normalized)) {
    invalid('Login language is invalid');
  }
  return technicalContentLanguage(normalized);
}

function localizedTemplate(template, language) {
  const contentLanguage = normalizeContentLanguage(language);
  return {
    ...template,
    name: localizedTechnicalField(template, 'name', contentLanguage) || template.templateCode,
    application: localizedTechnicalField(template, 'application', contentLanguage),
    contentLanguage
  };
}

function normalizeDocumentType(value) {
  const normalized = text(value) || 'technical_agreement';
  if (!documentTypeSet.has(normalized)) {
    invalid('Technical document type is invalid');
  }
  return normalized;
}

function normalizeProductCategory(value, { required = false } = {}) {
  const normalized = text(value);
  if (!normalized) {
    if (required) invalid('Product category is required');
    return null;
  }
  if (!productCategorySet.has(normalized)) {
    invalid('Product category is invalid');
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

function normalizeTableRows(value) {
  const rows = text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((cell) => cell.trim()));
  if (rows.length > 200 || rows.some((row) => row.length > 12 || row.some((cell) => cell.length > 500))) {
    invalid('Section table rows are invalid');
  }
  if (rows.some((row) => row.some((cell) => unsafeTemplateSyntax.test(cell)))) {
    invalid('Section table rows contain unsupported template or script syntax');
  }
  return rows;
}

function delimitedValues(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  return text(value).split(/[|,\r\n]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeColumnWidths(value, columnCount) {
  if (!columnCount) return [];
  const values = delimitedValues(value);
  if (!values.length) return [];
  if (values.length !== columnCount) invalid('Table column widths must match the table column count');
  const weights = values.map((item) => Number(item));
  if (weights.some((item) => !Number.isFinite(item) || item <= 0 || item > 1000)) {
    invalid('Table column widths are invalid');
  }
  const total = weights.reduce((sum, item) => sum + item, 0);
  const normalized = weights.map((item) => Number(((item / total) * 100).toFixed(4)));
  normalized[normalized.length - 1] = Number((100 - normalized.slice(0, -1).reduce((sum, item) => sum + item, 0)).toFixed(4));
  if (normalized.some((item) => item < 5)) invalid('Every table column must be at least 5 percent wide');
  return normalized;
}

function normalizeColumnAlignments(value, columnCount) {
  if (!columnCount) return [];
  const values = delimitedValues(value);
  if (!values.length) return [];
  if (values.length !== columnCount || values.some((item) => !tableAlignmentSet.has(item))) {
    invalid('Table column alignments are invalid');
  }
  return values;
}

function normalizeTableMerges(value, rows) {
  if (!rows.length || !text(value) && !Array.isArray(value)) return [];
  const rowCount = rows.length;
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const rawMerges = Array.isArray(value)
    ? value
    : text(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [row, column, span] = line.split(/[,:|]+/).map((item) => Number(item.trim()));
      return { row, column, span };
    });
  if (rawMerges.length > 100) invalid('Too many merged table cells');
  const occupied = new Set();
  const merges = rawMerges.map((merge) => {
    const normalized = {
      row: Number(merge.row),
      column: Number(merge.column),
      span: Number(merge.span)
    };
    if (!Number.isInteger(normalized.row) || normalized.row < 1 || normalized.row > rowCount
        || !Number.isInteger(normalized.column) || normalized.column < 1 || normalized.column > columnCount
        || !Number.isInteger(normalized.span) || normalized.span < 2
        || normalized.column + normalized.span - 1 > columnCount) {
      invalid('Merged table cells are outside the table');
    }
    for (let column = normalized.column; column < normalized.column + normalized.span; column += 1) {
      const key = `${normalized.row}:${column}`;
      if (occupied.has(key)) invalid('Merged table cells cannot overlap');
      occupied.add(key);
    }
    return normalized;
  });
  return merges.sort((left, right) => left.row - right.row || left.column - right.column);
}

function sectionImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return '';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  return '';
}

function normalizeSectionImage(input, currentImage, contentLanguage) {
  if (checkbox(input.removeSectionImage)) return null;
  const activeSuffix = contentLanguage === 'zh' ? 'Zh' : 'En';
  const inactiveSuffix = contentLanguage === 'zh' ? 'En' : 'Zh';
  let image = currentImage ? { ...currentImage } : null;
  if (input.sectionImage) {
    const buffer = input.sectionImage.buffer;
    const mimeType = sectionImageMimeType(buffer);
    if (!mimeType || buffer.length < 16 || buffer.length > MAX_SECTION_IMAGE_BYTES) {
      invalid('Section image must be a PNG or JPEG file no larger than 2 MB');
    }
    image = {
      mimeType,
      originalName: optionalText(input.sectionImage.originalName, 'Section image filename', 240) || 'section-image',
      data: buffer.toString('base64'),
      widthPercent: 60,
      alignment: 'center',
      captionEn: '',
      captionZh: ''
    };
  }
  if (!image) return null;
  const widthPercent = Number(input.imageWidthPercent ?? image.widthPercent ?? 60);
  if (!Number.isFinite(widthPercent) || widthPercent < 20 || widthPercent > 100) {
    invalid('Section image width must be between 20 and 100 percent');
  }
  const alignment = text(input.imageAlignment) || image.alignment || 'center';
  if (!imageAlignmentSet.has(alignment)) invalid('Section image alignment is invalid');
  return {
    mimeType: image.mimeType,
    originalName: text(image.originalName) || 'section-image',
    data: text(image.data),
    widthPercent,
    alignment,
    [`caption${activeSuffix}`]: safeTemplateText(input.imageCaption, 'Section image caption', 500) || '',
    [`caption${inactiveSuffix}`]: text(image[`caption${inactiveSuffix}`])
  };
}

function normalizeIdList(value, field) {
  const rawValues = Array.isArray(value) ? value : text(value).split(/[\r\n,]+/);
  const values = rawValues
    .map((item) => Number(String(item).trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  if (values.length > 100) invalid(`${field} is invalid`);
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

export function normalizeTechnicalTemplateInput(input, language = 'en') {
  const documentType = normalizeDocumentType(input.documentType);
  const productCategoryCode = normalizeProductCategory(input.productCategoryCode, { required: true });
  const contentLanguage = normalizeContentLanguage(language);
  const name = requiredText(input.name, 'Template name', 200);
  const application = optionalText(input.application, 'Application', 300);
  return {
    templateCode: normalizeCode(input.templateCode, 'Template code'),
    name,
    nameEn: contentLanguage === 'en' ? name : null,
    nameZh: contentLanguage === 'zh' ? name : null,
    documentType,
    productCategoryCode,
    productFamily: productCategoryCode
      ? technicalProductCategory(productCategoryCode).labelZh
      : requiredText(input.productFamily, 'Product family', 200),
    productModel: optionalText(input.productModel, 'Product model', 200),
    application,
    applicationEn: contentLanguage === 'en' ? application : null,
    applicationZh: contentLanguage === 'zh' ? application : null,
    language: 'bilingual',
    contentLanguage,
    changeSummary: requiredText(input.changeSummary, 'Change summary', 2000),
    contentSchema: JSON.parse(JSON.stringify(
      TECHNICAL_DOCUMENT_DEFAULT_SCHEMAS[documentType] || DEFAULT_TECHNICAL_AGREEMENT_SCHEMA
    ))
  };
}

export function normalizeTechnicalTemplateMetadataInput(input, language = 'en') {
  const documentType = normalizeDocumentType(input.documentType);
  const productCategoryCode = normalizeProductCategory(input.productCategoryCode, { required: true });
  const contentLanguage = normalizeContentLanguage(language);
  return {
    name: requiredText(input.name, 'Template name', 200),
    contentLanguage,
    documentType,
    productCategoryCode,
    productFamily: productCategoryCode
      ? technicalProductCategory(productCategoryCode).labelZh
      : requiredText(input.productFamily, 'Product family', 200),
    productModel: optionalText(input.productModel, 'Product model', 200),
    application: optionalText(input.application, 'Application', 300)
  };
}

export function normalizeVariableDefinitionInput(input, language = null, currentDefinition = null) {
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
  let labelEn;
  let labelZh;
  if (language) {
    const contentLanguage = normalizeContentLanguage(language);
    const activeLabel = requiredText(
      input.label ?? input[contentLanguage === 'zh' ? 'labelZh' : 'labelEn'],
      'Variable label',
      200
    );
    labelEn = contentLanguage === 'en'
      ? activeLabel
      : text(currentDefinition?.labelEn) || variableKey;
    labelZh = contentLanguage === 'zh'
      ? activeLabel
      : text(currentDefinition?.labelZh) || variableKey;
  } else {
    labelEn = requiredText(input.labelEn, 'English label', 200);
    labelZh = requiredText(input.labelZh, 'Chinese label', 200);
  }
  return {
    variableKey,
    labelEn,
    labelZh,
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
    sectionKey: sectionKeyPattern.test(text(input.sectionKey) || 'design_parameters')
      ? (text(input.sectionKey) || 'design_parameters')
      : invalid('Variable section is invalid'),
    isRequired: checkbox(input.isRequired),
    defaultValue: safeTemplateText(input.defaultValue, 'Default value'),
    validationRules,
    sortOrder: positiveInteger(input.sortOrder || 1, 'Sort order')
  };
}

export function normalizeTechnicalSectionInput(sectionKey, input, language = 'en', currentSection = {}) {
  const normalizedSectionKey = text(sectionKey);
  const contentLanguage = normalizeContentLanguage(language);
  if (!sectionKeyPattern.test(normalizedSectionKey)) {
    invalid('Template section is invalid');
  }
  const sectionType = text(input.sectionType) || 'narrative';
  if (!sectionTypeSet.has(sectionType)) {
    invalid('Template section type is invalid');
  }
  const operator = text(input.conditionOperator) || 'always';
  if (!sectionConditionOperatorSet.has(operator)) {
    invalid('Template section condition is invalid');
  }
  const conditionVariableKey = text(input.conditionVariableKey);
  if (operator !== 'always' && !variableKeyPattern.test(conditionVariableKey)) {
    invalid('Conditional sections require a safe variable key');
  }
  const conditionValue = operator === 'always' || operator === 'truthy'
    ? ''
    : safeTemplateText(input.conditionValue, 'Condition value', 500) || '';
  if (!['always', 'truthy'].includes(operator) && !conditionValue) {
    invalid('Conditional sections require a comparison value');
  }
  const activeSuffix = contentLanguage === 'zh' ? 'Zh' : 'En';
  const inactiveSuffix = contentLanguage === 'zh' ? 'En' : 'Zh';
  const activeLabel = requiredText(
    input.label ?? input[`label${activeSuffix}`],
    'Section name',
    200
  );
  const activeBody = safeTemplateText(
    input.body ?? input[`body${activeSuffix}`],
    'Section content',
    100000
  ) || '';
  const activeTableRows = normalizeTableRows(input.tableRows);
  const columnCount = activeTableRows.length
    ? Math.max(...activeTableRows.map((row) => row.length), 1)
    : 0;
  const currentLayout = currentSection?.layout || {};
  const currentTableLayout = currentLayout.table || {};
  const tableHeaderRow = input.tableHeaderRow === undefined
    ? (currentTableLayout.headerRow ?? activeTableRows.length > 1)
    : checkbox(input.tableHeaderRow);
  const columnWidths = normalizeColumnWidths(
    input.columnWidths === undefined ? currentTableLayout.columnWidths : input.columnWidths,
    columnCount
  );
  const columnAlignments = normalizeColumnAlignments(
    input.columnAlignments === undefined ? currentTableLayout.columnAlignments : input.columnAlignments,
    columnCount
  );
  const merges = normalizeTableMerges(
    input.tableMerges === undefined ? currentTableLayout.merges : input.tableMerges,
    activeTableRows
  );
  const image = normalizeSectionImage(input, currentLayout.image, contentLanguage);
  const { tableRows: _legacyTableRows, ...preservedSection } = currentSection || {};
  return {
    ...preservedSection,
    key: normalizedSectionKey,
    [`label${activeSuffix}`]: activeLabel,
    [`label${inactiveSuffix}`]: text(currentSection?.[`label${inactiveSuffix}`]),
    enabled: checkbox(input.enabled),
    sortOrder: positiveInteger(input.sortOrder || 1, 'Section sort order'),
    sectionType,
    [`body${activeSuffix}`]: activeBody,
    [`body${inactiveSuffix}`]: text(currentSection?.[`body${inactiveSuffix}`]),
    [`tableRows${activeSuffix}`]: activeTableRows,
    [`tableRows${inactiveSuffix}`]: Array.isArray(currentSection?.[`tableRows${inactiveSuffix}`])
      ? currentSection[`tableRows${inactiveSuffix}`]
      : [],
    condition: {
      operator,
      variableKey: operator === 'always' ? '' : conditionVariableKey,
      value: conditionValue
    },
    defaultClauseIds: normalizeIdList(input.defaultClauseIds, 'Default clauses'),
    blocks: Array.isArray(currentSection?.blocks) ? currentSection.blocks : [],
    layout: {
      pageBreakBefore: input.pageBreakBefore === undefined
        ? Boolean(currentLayout.pageBreakBefore)
        : checkbox(input.pageBreakBefore),
      table: {
        headerRow: tableHeaderRow,
        columnWidths,
        columnAlignments,
        merges
      },
      image
    }
  };
}

export async function updateTechnicalTemplateSection(repository, actor, templateId, revisionId, sectionKey, input, language = 'en') {
  ensureTemplateAuthor(actor);
  const contentLanguage = normalizeContentLanguage(language);
  const normalizedTemplateId = positiveInteger(templateId, 'Template');
  const normalizedRevisionId = positiveInteger(revisionId, 'Template revision');
  const template = await repository.getTemplateDetail(normalizedTemplateId);
  if (!template) notFound('Technical template not found');
  const revision = template.revisions.find((candidate) => candidate.id === normalizedRevisionId);
  if (!revision || revision.status !== 'draft') {
    conflict('Only draft template revisions can be edited');
  }
  const currentSection = (revision.contentSchema?.sections || []).find((section) => section.key === text(sectionKey));
  if (!currentSection) notFound('Template section not found');
  const normalizedSection = normalizeTechnicalSectionInput(sectionKey, input, contentLanguage, currentSection);
  if (normalizedSection.condition.operator !== 'always'
      && !revision.variables.some((variable) => variable.variableKey === normalizedSection.condition.variableKey)) {
    invalid('Conditional section variable is not assigned to this revision');
  }
  const publishedClauses = await repository.listClauses({ publishedOnly: true });
  const publishedClauseById = new Map(publishedClauses.map((clause) => [Number(clause.id), clause]));
  if (normalizedSection.defaultClauseIds.some((clauseId) => (
    publishedClauseById.get(Number(clauseId))?.language !== contentLanguage
  ))) {
    invalid('Default clauses must reference published clauses in the login language');
  }
  const inactiveClauseIds = (currentSection.defaultClauseIds || []).map(Number).filter((clauseId) => {
    const clauseLanguage = publishedClauseById.get(clauseId)?.language;
    return ['en', 'zh'].includes(clauseLanguage) && clauseLanguage !== contentLanguage;
  });
  normalizedSection.defaultClauseIds = [...new Set([
    ...inactiveClauseIds,
    ...normalizedSection.defaultClauseIds.map(Number)
  ])];
  const sections = revision.contentSchema.sections
    .filter((section) => section.key !== normalizedSection.key)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
  const insertionIndex = Math.min(normalizedSection.sortOrder - 1, sections.length);
  sections.splice(insertionIndex, 0, normalizedSection);
  const orderedSections = sections.map((section, index) => ({ ...section, sortOrder: index + 1 }));
  const saved = await repository.updateRevisionContent(
    normalizedRevisionId,
    { ...revision.contentSchema, schemaVersion: 1, sections: orderedSections },
    Number(actor.id)
  );
  if (!saved) conflict('Only draft template revisions can be edited');
  return saved;
}

export function normalizeTechnicalClauseInput(input, { includeCode = true, language = null } = {}) {
  const normalized = {
    title: requiredText(input.title, 'Clause title', 300),
    language: language ? normalizeContentLanguage(language) : normalizeLanguage(input.language),
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

export async function listTechnicalTemplates(repository, actor, language = 'en') {
  ensureTemplateViewer(actor);
  const contentLanguage = normalizeContentLanguage(language);
  const publishedOnly = !hasRole(actor, ROLES.ADMINISTRATOR)
    && !hasRole(actor, ROLES.TECHNICAL_MANAGER);
  const templates = await repository.listTemplates({ publishedOnly });
  return templates.map((template) => localizedTemplate(template, contentLanguage));
}

export async function getTechnicalTemplateDetail(repository, actor, templateId, language = 'en') {
  ensureTemplateViewer(actor);
  const template = await repository.getTemplateDetail(positiveInteger(templateId, 'Template'));
  if (!template) {
    notFound('Technical template not found');
  }
  if (!canViewTechnicalTemplate(actor, template)) {
    forbidden();
  }
  return localizedTemplate(template, language);
}

export async function createTechnicalTemplate(repository, actor, input, language = 'en') {
  ensureTemplateAuthor(actor);
  return repository.createTemplate(normalizeTechnicalTemplateInput(input, language), Number(actor.id));
}

export async function updateTechnicalTemplate(repository, actor, templateId, input, language = 'en') {
  ensureTemplateAuthor(actor);
  const updated = await repository.updateTemplate(
    positiveInteger(templateId, 'Template'),
    normalizeTechnicalTemplateMetadataInput(input, language),
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

export async function createTechnicalVariableDefinition(repository, actor, input, language = null) {
  ensureVariableAdministrator(actor);
  return repository.createVariableDefinition(
    normalizeVariableDefinitionInput(input, language),
    Number(actor.id)
  );
}

export async function updateTechnicalVariableDefinition(repository, actor, definitionId, input, language = null) {
  ensureVariableAdministrator(actor);
  const normalizedDefinitionId = positiveInteger(definitionId, 'Variable definition');
  const currentDefinition = language
    ? await repository.findVariableDefinitionById(normalizedDefinitionId)
    : null;
  if (language && !currentDefinition) notFound('Variable definition not found');
  const updated = await repository.updateVariableDefinition(
    normalizedDefinitionId,
    normalizeVariableDefinitionInput(input, language, currentDefinition),
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

export async function listTechnicalClauses(repository, actor, language = 'en') {
  ensureTemplateViewer(actor);
  const contentLanguage = normalizeContentLanguage(language);
  const publishedOnly = !hasRole(actor, ROLES.ADMINISTRATOR)
    && !hasRole(actor, ROLES.TECHNICAL_MANAGER);
  const clauses = await repository.listClauses({ publishedOnly });
  return clauses.filter((clause) => clause.language === contentLanguage);
}

export async function getTechnicalClause(repository, actor, clauseId, language = 'en') {
  ensureTemplateViewer(actor);
  const contentLanguage = normalizeContentLanguage(language);
  const clause = await repository.findClauseById(positiveInteger(clauseId, 'Clause'));
  if (!clause) notFound('Technical clause not found');
  if (clause.language !== contentLanguage) notFound('Technical clause not found');
  if (!hasRole(actor, ROLES.ADMINISTRATOR)
      && !hasRole(actor, ROLES.TECHNICAL_MANAGER)
      && clause.status !== 'published') {
    forbidden();
  }
  return clause;
}

export async function createTechnicalClause(repository, actor, input, language = null) {
  ensureTemplateAuthor(actor);
  return repository.createClause(
    normalizeTechnicalClauseInput(input, { language }),
    Number(actor.id)
  );
}

export async function updateTechnicalClause(repository, actor, clauseId, input, language = null) {
  ensureTemplateAuthor(actor);
  const normalizedClauseId = positiveInteger(clauseId, 'Clause');
  if (language) {
    const existing = await repository.findClauseById(normalizedClauseId);
    if (!existing || existing.language !== normalizeContentLanguage(language)) {
      notFound('Technical clause not found');
    }
  }
  const updated = await repository.updateClause(
    normalizedClauseId,
    normalizeTechnicalClauseInput(input, { includeCode: false, language }),
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
