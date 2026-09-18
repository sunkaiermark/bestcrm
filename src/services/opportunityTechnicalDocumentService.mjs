import { createHash } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import {
  TECHNICAL_DOCUMENT_TYPES,
  TECHNICAL_PRODUCT_CATEGORIES,
  localizedTechnicalField,
  opportunityTechnicalDocumentCode,
  technicalContentLanguage,
  technicalDocumentType,
  technicalDocumentTypeLabel,
  technicalProductCategory
} from '../domain/technicalTemplates.mjs';
import { canViewOpportunity, isProjectLeadEngineer } from './opportunityService.mjs';
import { renderTechnicalDraftContent } from './opportunityTechnicalDraftService.mjs';

const safeParameterKey = /^[a-z][a-z0-9_]{0,63}$/;
const unsafeStructuredText = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function forbidden() {
  throw serviceError('Forbidden', 403);
}

function invalid(message) {
  throw serviceError(message, 400);
}

function notFound(message) {
  throw serviceError(message, 404);
}

function conflict(message) {
  throw serviceError(message, 409);
}

function text(value) {
  return String(value ?? '').trim();
}

function safeText(value, field, { required = false, maxLength = 500 } = {}) {
  const normalized = text(value);
  if (required && !normalized) invalid(`${field} is required`);
  if (normalized.length > maxLength) invalid(`${field} is too long`);
  if (normalized && unsafeStructuredText.test(normalized)) invalid(`${field} contains unsupported syntax`);
  return normalized;
}

function positiveInteger(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    invalid(`${field} is invalid`);
  }
  return normalized;
}

function uniquePositiveIds(value, field) {
  const raw = Array.isArray(value) ? value : [value];
  const ids = raw.filter((item) => text(item)).map((item) => positiveInteger(item, field));
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100) invalid(`${field} selection is invalid`);
  return unique;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function outputLanguage(value) {
  if (!['en', 'zh'].includes(text(value))) invalid('Login language is invalid');
  return technicalContentLanguage(value);
}

function ensureViewer(actor, opportunity) {
  if (!canViewOpportunity(actor, opportunity)) forbidden();
}

function ensureManager(actor, opportunity) {
  if (!canManageOpportunityTechnicalDocuments(actor, opportunity)) forbidden();
}

export function canViewOpportunityTechnicalDocuments(actor, opportunity) {
  return canViewOpportunity(actor, opportunity);
}

export function canManageOpportunityTechnicalDocuments(actor, opportunity) {
  return !opportunity?.archivedAt && isProjectLeadEngineer(actor, opportunity);
}

export function parseEquipmentTechnicalParameters(value) {
  const normalized = text(value);
  if (!normalized) return [];
  const parameters = normalized.split(/\r?\n/).map((line, index) => {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 2 || cells.length > 3) {
      invalid(`Technical parameter line ${index + 1} must use key | value or key | label | value`);
    }
    const [key, labelOrValue, explicitValue] = cells;
    if (!safeParameterKey.test(key)) {
      invalid(`Technical parameter key on line ${index + 1} is invalid`);
    }
    const label = cells.length === 3
      ? safeText(labelOrValue, `Technical parameter label on line ${index + 1}`, { maxLength: 200 })
      : '';
    const parameterValue = safeText(cells.length === 3 ? explicitValue : labelOrValue, `Technical parameter value on line ${index + 1}`, { maxLength: 2000 });
    return { key, label, value: parameterValue };
  });
  if (parameters.length > 100) invalid('Too many technical parameters');
  if (new Set(parameters.map((item) => item.key)).size !== parameters.length) {
    invalid('Technical parameter keys must be unique');
  }
  return parameters;
}

export function equipmentTechnicalParametersText(parameters) {
  return (parameters || []).map((parameter) => (
    parameter.label
      ? `${parameter.key} | ${parameter.label} | ${parameter.value ?? ''}`
      : `${parameter.key} | ${parameter.value ?? ''}`
  )).join('\n');
}

export function normalizeOpportunityEquipmentInput(input) {
  const category = technicalProductCategory(input.productCategoryCode);
  if (!category) invalid('Product category is invalid');
  return {
    productCategoryCode: category.code,
    equipmentName: safeText(input.equipmentName, 'Equipment name', { required: true, maxLength: 300 }),
    model: safeText(input.model, 'Equipment model', { maxLength: 200 }) || null,
    quantity: positiveInteger(input.quantity || 1, 'Equipment quantity', 100000),
    technicalParameters: parseEquipmentTechnicalParameters(input.technicalParameters)
  };
}

export async function listOpportunityTechnicalDocumentWorkspace(repository, actor, opportunity) {
  ensureViewer(actor, opportunity);
  const [equipmentItems, documents] = await Promise.all([
    repository.listEquipmentByOpportunity(opportunity.id),
    repository.listDocumentsByOpportunity(opportunity.id)
  ]);
  return { equipmentItems, documents };
}

export async function createOpportunityEquipment(repository, actor, opportunity, input) {
  ensureManager(actor, opportunity);
  return repository.createEquipment({
    opportunityId: Number(opportunity.id),
    ...normalizeOpportunityEquipmentInput(input),
    actorUserId: Number(actor.id)
  });
}

export async function getOpportunityEquipment(repository, actor, opportunity, equipmentItemId) {
  ensureViewer(actor, opportunity);
  const item = await repository.findEquipmentItem(
    Number(opportunity.id),
    positiveInteger(equipmentItemId, 'Equipment item')
  );
  if (!item) notFound('Equipment item not found');
  return item;
}

export async function updateOpportunityEquipment(repository, actor, opportunity, equipmentItemId, input) {
  ensureManager(actor, opportunity);
  const updated = await repository.updateEquipment({
    opportunityId: Number(opportunity.id),
    equipmentItemId: positiveInteger(equipmentItemId, 'Equipment item'),
    ...normalizeOpportunityEquipmentInput(input),
    actorUserId: Number(actor.id)
  });
  if (!updated) conflict('Only an active equipment item can be updated');
  return updated;
}

export async function archiveOpportunityEquipment(repository, actor, opportunity, equipmentItemId) {
  ensureManager(actor, opportunity);
  const archived = await repository.archiveEquipment({
    opportunityId: Number(opportunity.id),
    equipmentItemId: positiveInteger(equipmentItemId, 'Equipment item'),
    actorUserId: Number(actor.id)
  });
  if (!archived) conflict('Only an active equipment item can be archived');
  return archived;
}

function selectedClauseSnapshots(contentSchema, publishedClauses, language) {
  const publishedById = new Map((publishedClauses || [])
    .filter((clause) => clause.language === language)
    .map((clause) => [Number(clause.id), clause]));
  const snapshots = [];
  for (const section of contentSchema?.sections || []) {
    for (const clauseId of section.defaultClauseIds || []) {
      const clause = publishedById.get(Number(clauseId));
      if (!clause || snapshots.some((item) => Number(item.id) === Number(clause.id))) continue;
      snapshots.push({
        id: Number(clause.id),
        clauseCode: clause.clauseCode,
        revisionNo: Number(clause.revisionNo),
        revisionLabel: clause.revisionLabel,
        title: clause.title,
        language: clause.language,
        content: clause.content,
        conditionSchema: clone(clause.conditionSchema || {}),
        sectionKey: section.key,
        isTemplateDefault: true,
        standardChanged: false
      });
    }
  }
  return snapshots;
}

function parameterValues(item) {
  return new Map((item.technicalParameters || []).map((parameter) => [parameter.key, parameter.value ?? '']));
}

function variableValue(variable, item, opportunity, template) {
  const parameters = parameterValues(item);
  const sourceValues = {
    customer_name: opportunity.customerName,
    contact_name: opportunity.primaryContactName || opportunity.contactName,
    opportunity_title: opportunity.title,
    requirement_summary: opportunity.requirement,
    product_name: item.equipmentName,
    product_model: item.model || template.productModel,
    delivery_destination: opportunity.deliveryDestination,
    opportunity_owner: opportunity.salespersonDisplayName || opportunity.salespersonUsername
  };
  const sourced = variable.sourceField === 'manual'
    ? parameters.get(variable.variableKey)
    : (sourceValues[variable.sourceField] ?? parameters.get(variable.sourceField) ?? parameters.get(variable.variableKey));
  return sourced === undefined || sourced === null || String(sourced).trim() === ''
    ? (variable.defaultValue ?? '')
    : sourced;
}

async function resolveVersionItems({
  technicalTemplateRepository,
  items,
  documentType,
  opportunity,
  language
}) {
  const templates = await technicalTemplateRepository.listTemplates({ publishedOnly: true, documentType });
  const templateByCategory = new Map();
  for (const template of templates) {
    if (template.documentType !== documentType || !template.productCategoryCode) continue;
    if (templateByCategory.has(template.productCategoryCode)) {
      conflict(`More than one active published template exists for ${template.productCategoryCode} and ${documentType}`);
    }
    templateByCategory.set(template.productCategoryCode, template);
  }
  const missingCategories = [...new Set(items
    .filter((item) => !templateByCategory.has(item.productCategoryCode))
    .map((item) => {
      const category = technicalProductCategory(item.productCategoryCode);
      return (language === 'zh' ? category?.labelZh : category?.labelEn) || item.productCategoryCode;
    }))];
  if (missingCategories.length) {
    conflict(`Missing current published ${technicalDocumentTypeLabel(documentType, language)} template: ${missingCategories.join(', ')}`);
  }

  const publishedClauses = await technicalTemplateRepository.listClauses({ publishedOnly: true });
  const detailByTemplateId = new Map();
  const versionItems = [];
  for (const [index, item] of items.entries()) {
    const listedTemplate = templateByCategory.get(item.productCategoryCode);
    let template = detailByTemplateId.get(Number(listedTemplate.id));
    if (!template) {
      template = await technicalTemplateRepository.getTemplateDetail(listedTemplate.id);
      detailByTemplateId.set(Number(listedTemplate.id), template);
    }
    const revision = template?.revisions?.find((candidate) => (
      Number(candidate.id) === Number(template.currentPublishedRevisionId)
      && candidate.status === 'published'
    ));
    if (!template || template.isActive !== true || !revision) {
      conflict(`Template ${listedTemplate.templateCode} no longer has the expected current published revision`);
    }
    const variableSchema = clone(revision.variables || []);
    const variableValues = Object.fromEntries(variableSchema.map((variable) => [
      variable.variableKey,
      variableValue(variable, item, opportunity, template)
    ]));
    const clauses = selectedClauseSnapshots(revision.contentSchema, publishedClauses, language);
    const category = technicalProductCategory(item.productCategoryCode);
    versionItems.push({
      equipmentItemId: Number(item.id),
      itemNo: Number(item.itemNo),
      productCategoryCode: item.productCategoryCode,
      productCategoryName: (language === 'zh' ? category?.labelZh : category?.labelEn) || item.productCategoryCode,
      equipmentName: item.equipmentName,
      model: item.model || '',
      quantity: Number(item.quantity),
      technicalParameters: clone(item.technicalParameters || []),
      templateId: Number(template.id),
      templateRevisionId: Number(revision.id),
      templateCode: template.templateCode,
      templateName: localizedTechnicalField(template, 'name', language) || template.templateCode,
      templateRevisionNo: Number(revision.revisionNo),
      outputLanguage: language,
      renderedContent: renderTechnicalDraftContent({
        contentSchema: revision.contentSchema,
        variableSchema,
        variableValues,
        selectedClauses: clauses
      }),
      sortOrder: index + 1
    });
  }
  return versionItems;
}

function normalizeDocumentSelection(input) {
  const documentType = technicalDocumentType(input.documentType)?.value;
  if (!documentType) invalid('Technical document type is invalid');
  const equipmentItemIds = uniquePositiveIds(input.equipmentItemIds, 'Equipment item');
  if (documentType === 'datasheet' && equipmentItemIds.length !== 1) {
    invalid('A Datasheet must contain exactly one equipment item');
  }
  return { documentType, equipmentItemIds, language: outputLanguage(input.language) };
}

function documentTitle(opportunity, documentType, items, language) {
  const typeLabel = technicalDocumentTypeLabel(documentType, language);
  return documentType === 'datasheet'
    ? `${items[0].equipmentName} - ${typeLabel}`
    : `${opportunity.title} - ${typeLabel}`;
}

export async function getOpportunityTechnicalDocumentCreationOptions(
  repositories,
  actor,
  opportunity,
  requestedDocumentType = 'technical_agreement'
) {
  ensureManager(actor, opportunity);
  const documentType = technicalDocumentType(requestedDocumentType)?.value || 'technical_agreement';
  const [equipmentItems, templates] = await Promise.all([
    repositories.opportunityTechnicalDocumentRepository.listEquipmentByOpportunity(opportunity.id, { includeArchived: false }),
    repositories.technicalTemplateRepository.listTemplates({ publishedOnly: true, documentType })
  ]);
  const coveredCategories = new Set(templates
    .filter((template) => template.documentType === documentType && template.productCategoryCode)
    .map((template) => template.productCategoryCode));
  return {
    documentType,
    documentTypes: TECHNICAL_DOCUMENT_TYPES,
    equipmentItems,
    coveredCategories
  };
}

export async function createOpportunityTechnicalDocumentVersionOne(repositories, actor, opportunity, input) {
  ensureManager(actor, opportunity);
  const selection = normalizeDocumentSelection(input);
  const allEquipment = await repositories.opportunityTechnicalDocumentRepository.listEquipmentByOpportunity(
    opportunity.id,
    { includeArchived: false }
  );
  const equipmentById = new Map(allEquipment.map((item) => [Number(item.id), item]));
  const items = selection.equipmentItemIds.map((id) => equipmentById.get(id));
  if (items.some((item) => !item)) invalid('Selected equipment must be active and belong to this Opportunity');
  const primaryEquipmentItemId = selection.documentType === 'datasheet' ? Number(items[0].id) : null;
  const existing = await repositories.opportunityTechnicalDocumentRepository.findDocumentByIdentity(
    opportunity.id,
    selection.documentType,
    primaryEquipmentItemId
  );
  if (existing) conflict(`Document already exists as ${existing.currentVersionLabel || existing.documentCode}`);

  const documentCode = opportunityTechnicalDocumentCode(
    opportunity.opportunityNo,
    selection.documentType,
    selection.documentType === 'datasheet' ? items[0].itemNo : null
  );
  if (!documentCode) conflict('Opportunity number cannot produce a controlled document code');
  const versionItems = await resolveVersionItems({
    technicalTemplateRepository: repositories.technicalTemplateRepository,
    items,
    documentType: selection.documentType,
    opportunity,
    language: selection.language
  });
  const title = documentTitle(opportunity, selection.documentType, items, selection.language);
  const sourceSnapshot = {
    schemaVersion: 2,
    snapshotAt: new Date().toISOString(),
    opportunity: {
      id: Number(opportunity.id),
      opportunityNo: opportunity.opportunityNo,
      title: opportunity.title,
      customerId: Number(opportunity.customerId),
      customerName: opportunity.customerName || ''
    },
    documentType: selection.documentType,
    documentCode,
    language: selection.language,
    equipment: versionItems.map((item) => ({
      equipmentItemId: item.equipmentItemId,
      itemNo: item.itemNo,
      productCategoryCode: item.productCategoryCode,
      technicalParameters: clone(item.technicalParameters),
      templateId: item.templateId,
      templateRevisionId: item.templateRevisionId,
      templateRevisionNo: item.templateRevisionNo
    }))
  };
  const files = await repositories.technicalMaterialDocumentService.generateVersionOne({
    opportunity,
    document: { documentType: selection.documentType, documentCode, title },
    versionNo: 1,
    items: versionItems,
    actor,
    language: selection.language
  });
  const created = await repositories.opportunityTechnicalDocumentRepository.createDocumentVersionOne({
    opportunityId: Number(opportunity.id),
    documentType: selection.documentType,
    primaryEquipmentItemId,
    documentCode,
    title,
    actorUserId: Number(actor.id),
    changeSummary: 'Initial generated version',
    sourceSnapshot,
    versionItems,
    files
  });
  if (!created) conflict('The initial technical document version could not be created');
  return created;
}

export async function getOpportunityTechnicalDocument(repository, actor, opportunity, documentId) {
  ensureViewer(actor, opportunity);
  const document = await repository.getDocumentDetail(
    Number(opportunity.id),
    positiveInteger(documentId, 'Technical document')
  );
  if (!document) notFound('Technical document not found');
  return document;
}

function safeOriginalName(value, expectedExtension) {
  const name = path.basename(String(value || '').replaceAll('\\', '/'));
  if (!name || name.length > 255 || path.extname(name).toLowerCase() !== expectedExtension) {
    invalid(`A ${expectedExtension} file is required`);
  }
  return name;
}

async function normalizeDocxFile(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length < 4) invalid('An editable DOCX file is required');
  const originalName = safeOriginalName(file.originalname, '.docx');
  if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) invalid('The editable file is not a valid DOCX package');
  let archive;
  try {
    archive = await JSZip.loadAsync(file.buffer);
  } catch {
    invalid('The editable file is not a valid DOCX package');
  }
  if (!archive.file('[Content_Types].xml') || !archive.file('word/document.xml')) {
    invalid('The editable file is not a valid DOCX document');
  }
  if (Object.keys(archive.files).some((name) => /vbaProject\.bin$/i.test(name))) {
    invalid('Macro-enabled Office documents are not accepted');
  }
  return {
    format: 'docx',
    originalName,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content: file.buffer,
    byteSize: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex')
  };
}

function normalizePdfFile(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length < 5) invalid('A matching PDF file is required');
  const originalName = safeOriginalName(file.originalname, '.pdf');
  if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') invalid('The preview file is not a valid PDF');
  return {
    format: 'pdf',
    originalName,
    mimeType: 'application/pdf',
    content: file.buffer,
    byteSize: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex')
  };
}

export async function saveUploadedOpportunityTechnicalDocumentVersion(
  repository,
  actor,
  opportunity,
  documentId,
  input
) {
  ensureManager(actor, opportunity);
  const normalizedDocumentId = positiveInteger(documentId, 'Technical document');
  const document = await repository.getDocumentDetail(opportunity.id, normalizedDocumentId);
  if (!document) notFound('Technical document not found');
  if (!document.currentVersionNo || !document.versions?.length) conflict('The source version is unavailable');
  const currentVersion = document.versions.find((version) => Number(version.versionNo) === Number(document.currentVersionNo));
  if (!currentVersion?.items?.length) conflict('The frozen equipment source for the current version is unavailable');
  const expectedCurrentVersionNo = positiveInteger(input.sourceVersionNo, 'Source version');
  if (expectedCurrentVersionNo !== Number(document.currentVersionNo)) {
    conflict('A newer technical document version already exists; reload before saving again');
  }
  const changeSummary = safeText(input.changeSummary, 'Change summary', { required: true, maxLength: 2000 });
  const files = [await normalizeDocxFile(input.docxFile), normalizePdfFile(input.pdfFile)];
  const docxBase = path.basename(files[0].originalName, '.docx').toLowerCase();
  const pdfBase = path.basename(files[1].originalName, '.pdf').toLowerCase();
  if (docxBase !== pdfBase) invalid('The DOCX and PDF filenames must have the same base name');
  const created = await repository.addUploadedVersion({
    opportunityId: Number(opportunity.id),
    documentId: normalizedDocumentId,
    actorUserId: Number(actor.id),
    expectedCurrentVersionNo,
    changeSummary,
    files
  });
  if (!created) conflict('The next technical document version could not be created');
  return created;
}

export async function getOpportunityTechnicalDocumentFile(repository, actor, opportunity, documentId, fileId) {
  ensureViewer(actor, opportunity);
  const file = await repository.findFile(
    Number(opportunity.id),
    positiveInteger(documentId, 'Technical document'),
    positiveInteger(fileId, 'Technical document file')
  );
  if (!file) notFound('Technical document file not found');
  if (!Buffer.isBuffer(file.content)
      || file.content.length !== Number(file.byteSize)
      || createHash('sha256').update(file.content).digest('hex') !== file.sha256) {
    conflict('Technical document file integrity check failed');
  }
  return file;
}

export const opportunityTechnicalDocumentCatalogues = Object.freeze({
  documentTypes: TECHNICAL_DOCUMENT_TYPES,
  productCategories: TECHNICAL_PRODUCT_CATEGORIES
});
