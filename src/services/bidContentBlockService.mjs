import { BID_CONTENT_CATEGORIES, BID_CONTENT_CATEGORY_VALUES } from '../domain/bidCenter.mjs';
import {
  BID_CONTENT_COMPONENT_TYPES,
  BID_CONTENT_OWNER_ROLES,
  BID_CONTENT_SENSITIVITIES,
  BID_LIBRARY_TYPES,
  BID_LIBRARY_TYPE_VALUES,
  BID_TEMPLATE_LANGUAGES
} from '../domain/bidCenterLibrary.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';

const codePattern = /^[A-Z][A-Z0-9-]{0,31}$/;
const variablePattern = /^[a-z][a-z0-9_]{0,63}$/;
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

function valueList(value, field, { pattern, maxItems = 100 } = {}) {
  const values = (Array.isArray(value) ? value : String(value ?? '').split(/[\r\n,]+/))
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (values.length > maxItems || values.some((item) => item.length > 200 || unsafeSyntax.test(item) || (pattern && !pattern.test(item)))) {
    fail(`${field} is invalid`);
  }
  return [...new Set(values)];
}

function normalizeDate(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    fail(`${field} is invalid`);
  }
  return normalized;
}

function normalizeTableRows(value) {
  const rows = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => line.split('|').map((cell) => cell.trim()));
  if (rows.length > 200 || rows.some((row) => row.length > 12 || row.some((cell) => cell.length > 500 || unsafeSyntax.test(cell)))) {
    fail('Table rows are invalid');
  }
  return rows;
}

function ownerRoleFor(category, requestedOwnerRole) {
  if (category === BID_CONTENT_CATEGORIES.TECHNICAL) return ROLES.TECHNICAL_MANAGER;
  if (category === BID_CONTENT_CATEGORIES.COMMERCIAL) return ROLES.COMMERCIAL_MANAGER;
  if (BID_CONTENT_OWNER_ROLES.includes(requestedOwnerRole)) return requestedOwnerRole;
  fail('Common content requires a technical or commercial owner');
}

function ensureLibraryComponent(libraryType, componentType) {
  if (libraryType === BID_LIBRARY_TYPES.STANDARD_CLAUSE
      && !['narrative', 'deviation_table'].includes(componentType)) {
    fail('Standard clauses must use narrative or deviation-table content');
  }
  if (libraryType === BID_LIBRARY_TYPES.PUBLIC_MATERIAL
      && !['narrative', 'image', 'controlled_attachment'].includes(componentType)) {
    fail('Public materials must use narrative, image, or controlled-attachment content');
  }
}

function ensureAttachment(componentType, attachment) {
  if (['image', 'controlled_attachment'].includes(componentType) && !attachment?.sha256) {
    fail('This content type requires a controlled attachment');
  }
  if (attachment?.sha256 && !/^[0-9a-f]{64}$/.test(attachment.sha256)) fail('Attachment hash is invalid');
}

function availableCategories(actor) {
  const categories = [];
  if ([ROLES.ADMINISTRATOR, ROLES.TECHNICAL_MANAGER, ROLES.QUOTATION_ENGINEER, ROLES.GENERAL_MANAGER]
    .some((role) => hasRole(actor, role))) categories.push(BID_CONTENT_CATEGORIES.TECHNICAL);
  if ([
    ROLES.ADMINISTRATOR,
    ROLES.COMMERCIAL_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.SALESPERSON,
    ROLES.QUOTATION_ENGINEER,
    ROLES.LEGAL_REVIEWER,
    ROLES.FINANCE_REVIEWER,
    ROLES.GENERAL_MANAGER
  ].some((role) => hasRole(actor, role))) categories.push(BID_CONTENT_CATEGORIES.COMMERCIAL);
  if (Array.isArray(actor?.roles) && actor.roles.length) categories.push(BID_CONTENT_CATEGORIES.COMMON);
  return [...new Set(categories)];
}

function isOwner(actor, block) {
  return hasRole(actor, block?.ownerRoleCode);
}

export function canViewBidContentBlock(actor, block) {
  if (!block || !availableCategories(actor).includes(block.category)) return false;
  const owner = isOwner(actor, block);
  const administrator = hasRole(actor, ROLES.ADMINISTRATOR);
  if (!owner && !administrator && !(block.isActive === true && Number(block.currentPublishedRevisionId) > 0)) return false;
  const sensitivity = owner || administrator
    ? block.sensitivity
    : (block.currentSensitivity || block.sensitivity);
  if (sensitivity === 'restricted') return owner || administrator;
  if (sensitivity === 'confidential') {
    if (owner || administrator) return true;
    if (block.category === BID_CONTENT_CATEGORIES.COMMERCIAL) {
      return [ROLES.SALES_MANAGER, ROLES.LEGAL_REVIEWER, ROLES.FINANCE_REVIEWER, ROLES.GENERAL_MANAGER]
        .some((role) => hasRole(actor, role));
    }
    return hasRole(actor, ROLES.TECHNICAL_MANAGER) || hasRole(actor, ROLES.GENERAL_MANAGER);
  }
  return true;
}

export function canAuthorBidContentBlock(actor, block) {
  return Boolean(block && isOwner(actor, block) && !hasRole(actor, ROLES.ADMINISTRATOR));
}

export function normalizeBidContentBlockInput(input, { libraryType, existingRevision = null, attachment = null } = {}) {
  if (!BID_LIBRARY_TYPE_VALUES.includes(libraryType)) fail('Content library type is invalid');
  const category = String(input.category ?? '').trim();
  if (!BID_CONTENT_CATEGORY_VALUES.includes(category)) fail('Content category is invalid');
  const ownerRoleCode = ownerRoleFor(category, String(input.ownerRoleCode ?? '').trim());
  const language = String(input.language ?? '').trim();
  if (!BID_TEMPLATE_LANGUAGES.includes(language)) fail('Content language is invalid');
  const componentType = String(input.componentType ?? '').trim();
  if (!BID_CONTENT_COMPONENT_TYPES.includes(componentType)) fail('Content component type is invalid');
  ensureLibraryComponent(libraryType, componentType);
  const sensitivity = String(input.sensitivity ?? '').trim();
  if (!BID_CONTENT_SENSITIVITIES.includes(sensitivity)) fail('Content sensitivity is invalid');
  const effectiveDate = normalizeDate(input.effectiveDate, 'Effective date');
  const expiresAt = normalizeDate(input.expiresAt, 'Expiry date');
  const reviewDueAt = normalizeDate(input.reviewDueAt, 'Review due date');
  if (effectiveDate && expiresAt && expiresAt < effectiveDate) fail('Expiry date cannot precede effective date');
  const retainedAttachment = attachment || (existingRevision?.attachmentSha256 ? {
    storedPath: existingRevision.attachmentStoredPath,
    originalName: existingRevision.attachmentOriginalName,
    mimeType: existingRevision.attachmentMimeType,
    byteSize: existingRevision.attachmentByteSize,
    sha256: existingRevision.attachmentSha256
  } : null);
  ensureAttachment(componentType, retainedAttachment);
  const blockCode = requiredText(input.blockCode, 'Content code', 32).toUpperCase();
  if (!codePattern.test(blockCode)) fail('Content code is invalid');
  return {
    blockCode,
    category,
    nameEn: requiredText(input.nameEn, 'English name', 200),
    nameZh: requiredText(input.nameZh, 'Chinese name', 200),
    applicableCountries: valueList(input.applicableCountries, 'Applicable countries'),
    applicableIndustries: valueList(input.applicableIndustries, 'Applicable industries'),
    applicableProductFamilies: valueList(input.applicableProductFamilies, 'Applicable product families'),
    applicableCustomerTypes: valueList(input.applicableCustomerTypes, 'Applicable customer types'),
    applicableSections: valueList(input.applicableSections, 'Applicable sections'),
    ownerRoleCode,
    language,
    componentType,
    titleEn: optionalText(input.titleEn, 'English title', 300),
    titleZh: optionalText(input.titleZh, 'Chinese title', 300),
    contentSchema: {
      bodyEn: optionalText(input.bodyEn, 'English body', 100000),
      bodyZh: optionalText(input.bodyZh, 'Chinese body', 100000),
      tableRows: normalizeTableRows(input.tableRows)
    },
    conditionSchema: { all: [] },
    allowedVariables: valueList(input.allowedVariables, 'Allowed variables', { pattern: variablePattern }),
    sourceMetadata: {
      libraryType,
      sourceReference: optionalText(input.sourceReference, 'Source reference', 1000)
    },
    attachment: retainedAttachment,
    effectiveDate,
    expiresAt,
    reviewDueAt,
    sensitivity,
    changeSummary: requiredText(input.changeSummary, 'Change summary', 2000)
  };
}

export function createBidContentBlockService({ enabled = false, repository }) {
  function assertEnabled() {
    if (enabled !== true) fail('Bid center is disabled', 404, BID_CENTER_ERROR_CODES.DISABLED);
  }

  async function loadRaw(blockId) {
    const block = await repository.getBlockDetail(positiveInteger(blockId, 'Content block'));
    if (!block) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    return block;
  }

  function assertView(actor, block) {
    if (!canViewBidContentBlock(actor, block)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
  }

  function assertAuthor(actor, block) {
    if (!canAuthorBidContentBlock(actor, block)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
  }

  return Object.freeze({
    assertEnabled,
    assertAnyAuthor(actor) {
      assertEnabled();
      if (hasRole(actor, ROLES.ADMINISTRATOR)
          || !BID_CONTENT_OWNER_ROLES.some((role) => hasRole(actor, role))) {
        fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
      }
      return true;
    },
    assertCanAuthor(actor, block) {
      assertEnabled();
      assertAuthor(actor, block);
      return true;
    },

    async list(actor, libraryType, filters = {}) {
      assertEnabled();
      if (!BID_LIBRARY_TYPE_VALUES.includes(libraryType)) fail('Content library type is invalid');
      let categories = availableCategories(actor);
      if (filters.category) {
        if (!BID_CONTENT_CATEGORY_VALUES.includes(filters.category)) fail('Content category is invalid');
        categories = categories.filter((category) => category === filters.category);
      }
      if (!categories.length) return [];
      const manager = hasRole(actor, ROLES.TECHNICAL_MANAGER) || hasRole(actor, ROLES.COMMERCIAL_MANAGER);
      const blocks = await repository.listBlocks({
        categories,
        libraryType,
        publishedOnly: !manager && !hasRole(actor, ROLES.ADMINISTRATOR)
      });
      return blocks.filter((block) => canViewBidContentBlock(actor, block));
    },

    async listPublishedSelectable(actor) {
      assertEnabled();
      const categories = availableCategories(actor).filter((category) => category !== BID_CONTENT_CATEGORIES.TECHNICAL);
      const results = await Promise.all(BID_LIBRARY_TYPE_VALUES.map((libraryType) => repository.listBlocks({
        categories,
        libraryType,
        publishedOnly: true
      })));
      return results.flat().filter((block) => canViewBidContentBlock(actor, {
        ...block,
        latestRevisionStatus: 'published'
      }));
    },

    async get(actor, blockId, expectedLibraryType) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (expectedLibraryType && block.libraryType !== expectedLibraryType) {
        fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      }
      assertView(actor, block);
      if (!isOwner(actor, block) && !hasRole(actor, ROLES.ADMINISTRATOR)) {
        block.revisions = block.revisions.filter((revision) => revision.status === 'published');
      }
      return block;
    },

    async create(actor, libraryType, input, attachment) {
      assertEnabled();
      const normalized = normalizeBidContentBlockInput(input, { libraryType, attachment });
      if (!hasRole(actor, normalized.ownerRoleCode) || hasRole(actor, ROLES.ADMINISTRATOR)) {
        fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
      }
      return repository.createBlock(normalized, Number(actor.id));
    },

    async update(actor, libraryType, blockId, revisionId, input, attachment) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (block.libraryType !== libraryType) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      assertAuthor(actor, block);
      const revision = block.revisions.find((candidate) => candidate.id === positiveInteger(revisionId, 'Content revision'));
      if (!revision || revision.status !== 'draft') fail('Only a draft revision can be edited', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      const normalized = normalizeBidContentBlockInput({ ...input, blockCode: block.blockCode }, {
        libraryType,
        existingRevision: revision,
        attachment
      });
      if (normalized.category !== block.category || normalized.ownerRoleCode !== block.ownerRoleCode) {
        fail('Content category and owner cannot change after creation', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      const metadata = {
        nameEn: normalized.nameEn,
        nameZh: normalized.nameZh,
        applicableCountries: normalized.applicableCountries,
        applicableIndustries: normalized.applicableIndustries,
        applicableProductFamilies: normalized.applicableProductFamilies,
        applicableCustomerTypes: normalized.applicableCustomerTypes,
        applicableSections: normalized.applicableSections
      };
      const updated = await repository.updateDraft(block.id, revision.id, metadata, normalized, Number(actor.id));
      if (!updated) fail('Only a draft revision can be edited', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return { updated, previousAttachment: revision.attachmentSha256 && attachment ? revision : null };
    },

    async createRevision(actor, libraryType, blockId, input) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (block.libraryType !== libraryType) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      assertAuthor(actor, block);
      const created = await repository.createRevision(
        block.id,
        requiredText(input.changeSummary, 'Change summary', 2000),
        Number(actor.id)
      );
      if (!created) fail('A draft or pending revision already exists', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return created;
    },

    async submit(actor, libraryType, blockId, revisionId) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (block.libraryType !== libraryType) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      assertAuthor(actor, block);
      const normalizedRevisionId = positiveInteger(revisionId, 'Content revision');
      const revision = block.revisions.find((candidate) => candidate.id === normalizedRevisionId);
      if (!revision) fail('Content revision not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      if (revision.status !== 'draft') fail('Only a draft revision can be submitted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      const updated = await repository.submitRevision(normalizedRevisionId, Number(actor.id));
      if (!updated || updated.contentBlockId !== block.id) fail('Only a draft revision can be submitted', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return updated;
    },

    async publish(actor, libraryType, blockId, revisionId) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (block.libraryType !== libraryType) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      assertAuthor(actor, block);
      const normalizedRevisionId = positiveInteger(revisionId, 'Content revision');
      const revision = block.revisions.find((candidate) => candidate.id === normalizedRevisionId);
      if (!revision) fail('Content revision not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      if (revision.status !== 'review_pending') fail('Only a pending revision can be published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      const updated = await repository.publishRevision(normalizedRevisionId, Number(actor.id));
      if (!updated || updated.contentBlockId !== block.id) fail('Only a pending revision can be published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return updated;
    },

    async retire(actor, libraryType, blockId, revisionId) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (block.libraryType !== libraryType) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      assertAuthor(actor, block);
      const normalizedRevisionId = positiveInteger(revisionId, 'Content revision');
      const revision = block.revisions.find((candidate) => candidate.id === normalizedRevisionId);
      if (!revision) fail('Content revision not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      if (revision.status !== 'published') fail('Only the current published revision can be retired', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      const updated = await repository.retireRevision(normalizedRevisionId, Number(actor.id));
      if (!updated || updated.contentBlockId !== block.id) fail('Only the current published revision can be retired', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      return updated;
    },

    async getAttachment(actor, libraryType, blockId, revisionId) {
      assertEnabled();
      const block = await loadRaw(blockId);
      if (block.libraryType !== libraryType) fail('Content block not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      assertView(actor, block);
      const visibleRevisions = isOwner(actor, block) || hasRole(actor, ROLES.ADMINISTRATOR)
        ? block.revisions
        : block.revisions.filter((candidate) => candidate.status === 'published');
      const revision = visibleRevisions.find((candidate) => candidate.id === positiveInteger(revisionId, 'Content revision'));
      if (!revision || !revision.attachmentSha256) fail('Attachment not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      return revision;
    }
  });
}
