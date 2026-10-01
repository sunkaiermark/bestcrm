import { ROLES, hasRole } from '../domain/roles.mjs';
import { getQuotationSellerEntity } from '../domain/quotationSellerEntities.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import { canViewOpportunity } from './opportunityService.mjs';

export class SalesCommercialQuotationDraftError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SalesCommercialQuotationDraftError';
    this.statusCode = statusCode;
  }
}

export function canEditSalesCommercialQuotationDraft(user, opportunity) {
  return !opportunity.archivedAt
    && hasRole(user, ROLES.SALESPERSON)
    && Number(opportunity.salespersonId) === Number(user.id);
}

function assertView(user, opportunity) {
  if (!canViewOpportunity(user, opportunity)) {
    throw new SalesCommercialQuotationDraftError('Forbidden', 403);
  }
}

function assertEdit(user, opportunity) {
  if (!canEditSalesCommercialQuotationDraft(user, opportunity)) {
    throw new SalesCommercialQuotationDraftError('Forbidden', 403);
  }
}

function values(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function lineItemsFromInput(input) {
  const descriptions = values(input.description);
  const quantities = values(input.quantity);
  const units = values(input.unit);
  const prices = values(input.unitPrice);
  const inclusions = values(input.includeInTotal);
  const rowCount = Math.max(descriptions.length, quantities.length, units.length, prices.length, inclusions.length);
  if (rowCount > 100) throw new SalesCommercialQuotationDraftError('Too many quotation rows');
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const description = String(descriptions[index] ?? '').trim();
    const quantity = String(quantities[index] ?? '').trim();
    const unit = String(units[index] ?? '').trim();
    const unitPrice = String(prices[index] ?? '').trim();
    const includeInTotal = String(inclusions[index] ?? '').trim();
    if (!description && !quantity && !unit && !unitPrice && !includeInTotal) continue;
    if (description.length > 2000 || unit.length > 40) {
      throw new SalesCommercialQuotationDraftError('Quotation row text is too long');
    }
    if (quantity && !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(quantity)) {
      throw new SalesCommercialQuotationDraftError('Quantity must be a non-negative number with at most four decimal places');
    }
    if (unitPrice && !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(unitPrice)) {
      throw new SalesCommercialQuotationDraftError('Unit price must be a non-negative amount with at most two decimal places');
    }
    if (includeInTotal && !['included', 'excluded'].includes(includeInTotal)) {
      throw new SalesCommercialQuotationDraftError('Quotation row total inclusion is invalid');
    }
    rows.push({ description, quantity, unit, unitPrice, includeInTotal: includeInTotal || null });
  }
  return rows;
}

function termSelectionsFromInput(input, publishedTerms, language) {
  const termsById = new Map(publishedTerms.map((term) => [Number(term.id), term]));
  const selections = {};
  for (const section of QUOTATION_COMMERCIAL_TERM_SECTIONS) {
    const rawId = String(input[`term_${section.key}`] ?? '').trim();
    if (!rawId) continue;
    if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) {
      throw new SalesCommercialQuotationDraftError('Selected standard commercial term is invalid');
    }
    const term = termsById.get(Number(rawId));
    if (!term || term.key !== section.key || term.language !== language) {
      throw new SalesCommercialQuotationDraftError('Selected standard commercial term is unavailable or belongs to another section', 409);
    }
    selections[section.key] = {
      id: term.id, revisionNo: term.revisionNo, language: term.language,
      title: term.title, body: term.body
    };
  }
  return selections;
}

export async function loadSalesCommercialQuotationDraft(repository, user, opportunity, language = 'en') {
  assertView(user, opportunity);
  const [draft, sources] = await Promise.all([
    repository.getByOpportunity(opportunity.id),
    repository.listTechnicalSources(opportunity.id)
  ]);
  const standardTerms = await repository.listPublishedStandardTerms(draft?.language || (language === 'zh' ? 'zh' : 'en'));
  const source = draft && sources.find((item) => item.attachmentId === draft.sourceAttachmentId) || null;
  return {
    draft,
    sources,
    standardTerms,
    sourceChanged: Boolean(draft && (!source || source.sha256 !== draft.sourceSha256
      || sources.some((item) => item.technicalDraftRevisionNo > source.technicalDraftRevisionNo)))
  };
}

export async function saveSalesCommercialQuotationDraft(repository, user, opportunity, language, input) {
  assertEdit(user, opportunity);
  const attachmentId = Number(input.sourceAttachmentId);
  const expectedRevisionNo = Number(input.expectedRevisionNo);
  if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0
      || !Number.isSafeInteger(expectedRevisionNo) || expectedRevisionNo < 0) {
    throw new SalesCommercialQuotationDraftError('Technical source or draft revision is invalid');
  }
  const source = await repository.getTechnicalSource(opportunity.id, attachmentId);
  if (!source) {
    throw new SalesCommercialQuotationDraftError('The selected uploaded technical file is unavailable', 409);
  }
  if (!['on', 'true', '1'].includes(String(input.confirmSourceVersion || '').toLowerCase())) {
    throw new SalesCommercialQuotationDraftError('Confirm the exact technical file version before saving');
  }
  const currency = String(input.currency || '').trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new SalesCommercialQuotationDraftError('Currency must be a three-letter code');
  }
  const sellerEntityCode = String(input.sellerEntityCode || '').trim();
  const sellerEntity = sellerEntityCode ? getQuotationSellerEntity(sellerEntityCode) : null;
  if (sellerEntityCode && !sellerEntity) {
    throw new SalesCommercialQuotationDraftError('Selected seller entity is invalid');
  }
  const existingDraft = await repository.getByOpportunity(opportunity.id);
  const draftLanguage = existingDraft?.language || (language === 'zh' ? 'zh' : 'en');
  const publishedTerms = await repository.listPublishedStandardTerms(draftLanguage);
  const termSelections = termSelectionsFromInput(input, publishedTerms, draftLanguage);
  const lineItems = lineItemsFromInput(input);
  const saved = await repository.saveDraft({
    opportunityId: opportunity.id,
    source,
    language: draftLanguage,
    currency,
    sellerEntityCode,
    sellerEntityName: sellerEntity?.legalName || '',
    termSelections,
    lineItems,
    actorUserId: user.id,
    expectedRevisionNo
  });
  if (!saved) {
    throw new SalesCommercialQuotationDraftError('The draft changed in another session; reload before saving', 409);
  }
  return saved;
}
