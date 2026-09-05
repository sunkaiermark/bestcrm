import { ROLES, hasRole } from '../domain/roles.mjs';
import { DEFAULT_COMMERCIAL_PACKAGE_SCHEMA, BID_TEMPLATE_LANGUAGES } from '../domain/bidCenterLibrary.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';

const languageSet = new Set(BID_TEMPLATE_LANGUAGES);
const codePattern = /^[A-Z][A-Z0-9-]{0,31}$/;
const sectionKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const unsafeSyntax = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;

function fail(message, statusCode = 400, code = BID_CENTER_ERROR_CODES.VALIDATION) {
  throw new BidCenterServiceError(message, { statusCode, code });
}

function requiredText(value, field, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail(`${field} is required`);
  if (normalized.length > maxLength) fail(`${field} is too long`);
  if (unsafeSyntax.test(normalized)) fail(`${field} contains unsupported template or script syntax`);
  return normalized;
}

function optionalText(value, field, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > maxLength) fail(`${field} is too long`);
  if (normalized && unsafeSyntax.test(normalized)) fail(`${field} contains unsupported template or script syntax`);
  return normalized;
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`${field} is invalid`);
  return number;
}

function checkbox(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function list(value, field, maxItems = 100) {
  const values = (Array.isArray(value) ? value : String(value ?? '').split(/[\r\n,]+/))
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (values.length > maxItems || values.some((item) => item.length > 200 || unsafeSyntax.test(item))) {
    fail(`${field} is invalid`);
  }
  return [...new Set(values)];
}

function idList(value, field) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\r\n,]+/);
  const values = raw.filter((item) => String(item).trim() !== '').map((item) => Number(item));
  if (values.some((item) => !Number.isInteger(item) || item < 1) || values.length > 100) {
    fail(`${field} is invalid`);
  }
  return [...new Set(values)];
}

function tableRows(value) {
  const rows = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split('|').map((cell) => cell.trim()));
  if (rows.length > 200 || rows.some((row) => row.length > 12 || row.some((cell) => cell.length > 500 || unsafeSyntax.test(cell)))) {
    fail('Section table rows are invalid');
  }
  return rows;
}

function cloneDefaultSchema() {
  return {
    schemaVersion: 1,
    sections: DEFAULT_COMMERCIAL_PACKAGE_SCHEMA.sections.map((section) => ({
      ...section,
      tableRows: [...section.tableRows],
      contentBlockIds: [...section.contentBlockIds]
    }))
  };
}

export function canViewCommercialTemplateLibrary(user) {
  return [
    ROLES.ADMINISTRATOR,
    ROLES.COMMERCIAL_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.SALESPERSON,
    ROLES.QUOTATION_ENGINEER,
    ROLES.LEGAL_REVIEWER,
    ROLES.FINANCE_REVIEWER,
    ROLES.GENERAL_MANAGER
  ].some((role) => hasRole(user, role));
}

export function canAuthorCommercialTemplates(user) {
  return hasRole(user, ROLES.COMMERCIAL_MANAGER);
}

export function canViewCommercialTemplate(user, template) {
  if (hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.COMMERCIAL_MANAGER)) return true;
  return canViewCommercialTemplateLibrary(user)
    && template?.isActive === true
    && Number(template?.currentPublishedRevisionId) > 0;
}

export function normalizeCommercialTemplateInput(input, { includeCode = true } = {}) {
  const language = String(input.language ?? '').trim();
  if (!languageSet.has(language)) fail('Template language is invalid');
  const normalized = {
    nameEn: requiredText(input.nameEn, 'English template name', 200),
    nameZh: requiredText(input.nameZh, 'Chinese template name', 200),
    language,
    applicableCountries: list(input.applicableCountries, 'Applicable countries'),
    applicableIndustries: list(input.applicableIndustries, 'Applicable industries'),
    applicableCustomerTypes: list(input.applicableCustomerTypes, 'Applicable customer types')
  };
  if (includeCode) {
    normalized.templateCode = requiredText(input.templateCode, 'Template code', 32).toUpperCase();
    if (!codePattern.test(normalized.templateCode)) fail('Template code is invalid');
    normalized.changeSummary = requiredText(input.changeSummary, 'Change summary', 2000);
    normalized.contentSchema = cloneDefaultSchema();
  }
  return normalized;
}

export function normalizeCommercialSectionInput(sectionKey, input) {
  const key = String(sectionKey ?? '').trim();
  if (!sectionKeyPattern.test(key)) fail('Template section is invalid');
  const sectionType = String(input.sectionType ?? '').trim();
  const defaultSection = DEFAULT_COMMERCIAL_PACKAGE_SCHEMA.sections.find((section) => section.key === key);
  if (!defaultSection || sectionType !== defaultSection.sectionType) fail('Template section type is invalid');
  const sortOrder = positiveInteger(input.sortOrder || 1, 'Section sort order');
  return {
    key,
    labelEn: requiredText(input.labelEn, 'English section label', 200),
    labelZh: requiredText(input.labelZh, 'Chinese section label', 200),
    enabled: checkbox(input.enabled),
    sortOrder,
    sectionType,
    bodyEn: optionalText(input.bodyEn, 'English section body', 100000),
    bodyZh: optionalText(input.bodyZh, 'Chinese section body', 100000),
    tableRows: tableRows(input.tableRows),
    contentBlockIds: idList(input.contentBlockIds, 'Content blocks')
  };
}

export function createCommercialPackageTemplateService({ enabled = false, repository }) {
  function assertEnabled() {
    if (enabled !== true) fail('Bid center is disabled', 404, BID_CENTER_ERROR_CODES.DISABLED);
  }

  function assertViewer(actor) {
    assertEnabled();
    if (!canViewCommercialTemplateLibrary(actor)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
  }

  function assertAuthor(actor) {
    assertEnabled();
    if (!canAuthorCommercialTemplates(actor)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
  }

  async function assertRevisionState(templateId, revisionId, expectedStatus) {
    const template = await repository.getTemplateDetail(positiveInteger(templateId, 'Template'));
    if (!template) fail('Commercial template not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const normalizedRevisionId = positiveInteger(revisionId, 'Template revision');
    const revision = template.revisions.find((candidate) => candidate.id === normalizedRevisionId);
    if (!revision) fail('Commercial template revision not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    if (revision.status !== expectedStatus) return null;
    return revision;
  }

  return Object.freeze({
    assertEnabled,
    assertAuthor,

    async list(actor) {
      assertViewer(actor);
      const publishedOnly = !hasRole(actor, ROLES.ADMINISTRATOR) && !hasRole(actor, ROLES.COMMERCIAL_MANAGER);
      return repository.listTemplates({ publishedOnly });
    },

    async get(actor, templateId) {
      assertViewer(actor);
      const template = await repository.getTemplateDetail(positiveInteger(templateId, 'Template'));
      if (!template) fail('Commercial template not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      if (!canViewCommercialTemplate(actor, template)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
      if (!hasRole(actor, ROLES.ADMINISTRATOR) && !hasRole(actor, ROLES.COMMERCIAL_MANAGER)) {
        template.revisions = template.revisions.filter((revision) => revision.status === 'published');
      }
      return template;
    },

    async create(actor, input) {
      assertAuthor(actor);
      return repository.createTemplate(normalizeCommercialTemplateInput(input), Number(actor.id));
    },

    async updateMetadata(actor, templateId, input) {
      assertAuthor(actor);
      const updated = await repository.updateTemplate(
        positiveInteger(templateId, 'Template'),
        normalizeCommercialTemplateInput(input, { includeCode: false }),
        Number(actor.id)
      );
      if (!updated) fail('Commercial template not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      return updated;
    },

    async createRevision(actor, templateId, input) {
      assertAuthor(actor);
      const created = await repository.createRevision(
        positiveInteger(templateId, 'Template'),
        requiredText(input.changeSummary, 'Change summary', 2000),
        Number(actor.id)
      );
      if (!created) fail('A draft or pending revision already exists', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return created;
    },

    async updateSection(actor, templateId, revisionId, sectionKey, input, publishedContentBlocks = []) {
      assertAuthor(actor);
      const template = await repository.getTemplateDetail(positiveInteger(templateId, 'Template'));
      if (!template) fail('Commercial template not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      const revision = template.revisions.find((candidate) => candidate.id === positiveInteger(revisionId, 'Template revision'));
      if (!revision || revision.status !== 'draft') {
        fail('Only draft template revisions can be edited', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      const section = normalizeCommercialSectionInput(sectionKey, input);
      const allowedIds = new Set(publishedContentBlocks.map((block) => Number(block.id)));
      if (section.contentBlockIds.some((id) => !allowedIds.has(id))) {
        fail('Sections may reference only visible published content', 400);
      }
      const sections = (revision.contentSchema?.sections || [])
        .filter((candidate) => candidate.key !== section.key)
        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
      if (!(revision.contentSchema?.sections || []).some((candidate) => candidate.key === section.key)) {
        fail('Template section not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      }
      sections.splice(Math.min(section.sortOrder - 1, sections.length), 0, section);
      const contentSchema = {
        ...revision.contentSchema,
        schemaVersion: 1,
        sections: sections.map((candidate, index) => ({ ...candidate, sortOrder: index + 1 }))
      };
      const saved = await repository.updateRevisionContent(revision.id, contentSchema);
      if (!saved) fail('Only draft template revisions can be edited', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return saved;
    },

    async submit(actor, templateId, revisionId) {
      assertAuthor(actor);
      if (!await assertRevisionState(templateId, revisionId, 'draft')) {
        fail('Only a draft revision can be submitted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      const updated = await repository.submitRevision(positiveInteger(revisionId, 'Template revision'), Number(actor.id));
      if (!updated) fail('Only a draft revision can be submitted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return updated;
    },

    async publish(actor, templateId, revisionId) {
      assertAuthor(actor);
      if (!await assertRevisionState(templateId, revisionId, 'review_pending')) {
        fail('Only a pending revision can be published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      const updated = await repository.publishRevision(positiveInteger(revisionId, 'Template revision'), Number(actor.id));
      if (!updated) fail('Only a pending revision can be published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return updated;
    },

    async retire(actor, templateId, revisionId) {
      assertAuthor(actor);
      if (!await assertRevisionState(templateId, revisionId, 'published')) {
        fail('Only the current published revision can be retired', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      const updated = await repository.retireRevision(positiveInteger(revisionId, 'Template revision'), Number(actor.id));
      if (!updated) fail('Only the current published revision can be retired', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return updated;
    }
  });
}
