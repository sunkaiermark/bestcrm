import { ROLES, hasRole } from '../domain/roles.mjs';
import { getQuotationSellerEntity } from '../domain/quotationSellerEntities.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import { includeAllQuotationDraftLines } from '../domain/quotationMoney.mjs';
import { withBuiltInQuotationTypicalTerms } from '../domain/quotationTypicalTermTemplates.mjs';
import {
  hasUnresolvedQuotationTermPlaceholder,
  isValidQuotationTermWording,
  normalizeQuotationTermWording
} from '../domain/quotationTermWording.mjs';
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
  const rowCount = Math.max(descriptions.length, quantities.length, units.length, prices.length);
  if (rowCount > 100) throw new SalesCommercialQuotationDraftError('Too many quotation rows');
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const description = String(descriptions[index] ?? '').trim();
    const quantity = String(quantities[index] ?? '').trim();
    const unit = String(units[index] ?? '').trim();
    const unitPrice = String(prices[index] ?? '').trim();
    if (!description && !quantity && !unit && !unitPrice) continue;
    if (description.length > 2000 || unit.length > 40) {
      throw new SalesCommercialQuotationDraftError('Quotation row text is too long');
    }
    if (quantity && !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(quantity)) {
      throw new SalesCommercialQuotationDraftError('Quantity must be a non-negative number with at most four decimal places');
    }
    if (unitPrice && !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(unitPrice)) {
      throw new SalesCommercialQuotationDraftError('Unit price must be a non-negative amount with at most two decimal places');
    }
    rows.push({ description, quantity, unit, unitPrice, includeInTotal: 'included' });
  }
  return rows;
}

function termSelectionsFromInput(input, publishedTerms, language, existingSelections = {}) {
  const termsById = new Map(publishedTerms.map((term) => [String(term.id), term]));
  const selections = {};
  for (const section of QUOTATION_COMMERCIAL_TERM_SECTIONS) {
    const rawId = String(input[`term_${section.key}`] ?? '').trim();
    if (!rawId) continue;
    if (rawId.length > 160) {
      throw new SalesCommercialQuotationDraftError('Selected standard commercial term is invalid');
    }
    const term = termsById.get(rawId);
    if (!term || term.key !== section.key || term.language !== language) {
      throw new SalesCommercialQuotationDraftError('Selected standard commercial term is unavailable or belongs to another section', 409);
    }
    const existing = existingSelections?.[section.key];
    const samePublishedRevision = String(existing?.id ?? '') === String(term.id)
      && Number(existing?.revisionNo) === Number(term.revisionNo)
      && existing?.language === term.language;
    const submittedBody = normalizeQuotationTermWording(input[`term_${section.key}_body`]);
    const body = submittedBody || normalizeQuotationTermWording(
      samePublishedRevision ? existing.body : term.body
    );
    if (!isValidQuotationTermWording(body)) {
      if (hasUnresolvedQuotationTermPlaceholder(body)) {
        throw new SalesCommercialQuotationDraftError(
          `Replace all bracketed placeholders in the quotation wording for ${section.en}`
        );
      }
      throw new SalesCommercialQuotationDraftError(`Quotation wording for ${section.en} is missing or invalid`);
    }
    selections[section.key] = {
      id: term.id, revisionNo: term.revisionNo, language: term.language,
      title: term.title, templateBody: term.body, body
    };
  }
  return selections;
}

function customerContactFromInput(input, opportunity, existingDraft, availableContacts) {
  const snapshotText = (value, label, max) => {
    const result = String(value ?? '').trim();
    if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
      throw new SalesCommercialQuotationDraftError(`Selected customer contact ${label} is invalid`, 409);
    }
    return result;
  };
  if (!Array.isArray(availableContacts)) {
    const fallbackName = String(existingDraft?.customerContactName
      || opportunity.primaryContactName || '').trim();
    const fallbackId = existingDraft?.customerContactId || opportunity.primaryContactId || null;
    return {
      id: fallbackId,
      name: fallbackName,
      phone: snapshotText(existingDraft?.customerContactPhone, 'telephone', 200),
      email: snapshotText(existingDraft?.customerContactEmail, 'email', 320)
    };
  }
  const contacts = availableContacts.filter((contact) =>
    Number(contact.customerId) === Number(opportunity.customerId) && !contact.archivedAt
  );
  const wasSubmitted = Object.hasOwn(input, 'customerContactId');
  const rawId = String(input.customerContactId ?? '').trim();
  if (rawId && (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)))) {
    throw new SalesCommercialQuotationDraftError('Selected customer contact is invalid');
  }
  const preferredId = rawId ? Number(rawId) : (wasSubmitted ? null
    : (existingDraft?.customerContactId || opportunity.primaryContactId || contacts[0]?.id || null));
  if (!preferredId) {
    if (contacts.length) {
      throw new SalesCommercialQuotationDraftError('Choose an active customer contact');
    }
    return { id: null, name: '', phone: '', email: '' };
  }
  const selected = contacts.find((contact) => Number(contact.id) === Number(preferredId));
  if (!selected) {
    throw new SalesCommercialQuotationDraftError(
      'Selected customer contact is unavailable or belongs to another customer', 409
    );
  }
  const name = String(selected.name || '').trim();
  if (!name || name.length > 500) {
    throw new SalesCommercialQuotationDraftError('Selected customer contact name is invalid', 409);
  }
  return {
    id: Number(selected.id),
    name,
    phone: snapshotText(selected.phone, 'telephone', 200),
    email: snapshotText(selected.email, 'email', 320)
  };
}

export async function loadSalesCommercialQuotationDraft(repository, user, opportunity, language = 'en') {
  assertView(user, opportunity);
  const [draft, sources] = await Promise.all([
    repository.getByOpportunity(opportunity.id),
    repository.listTechnicalSources(opportunity.id)
  ]);
  const draftLanguage = draft?.language || (language === 'zh' ? 'zh' : 'en');
  const standardTerms = withBuiltInQuotationTypicalTerms(
    await repository.listPublishedStandardTerms(draftLanguage), draftLanguage
  );
  const source = draft && sources.find((item) => item.attachmentId === draft.sourceAttachmentId) || null;
  return {
    draft: draft ? { ...draft, lineItems: includeAllQuotationDraftLines(draft.lineItems) } : null,
    sources,
    standardTerms,
    sourceChanged: Boolean(draft && (!source || source.sha256 !== draft.sourceSha256
      || sources.some((item) => item.technicalDraftRevisionNo > source.technicalDraftRevisionNo)))
  };
}

export async function saveSalesCommercialQuotationDraft(
  repository, user, opportunity, language, input, { customerContacts } = {}
) {
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
  const taxRate = String(input.taxRate ?? '0').trim();
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/.test(taxRate)) {
    throw new SalesCommercialQuotationDraftError('Tax rate must be between 0 and 100 with at most two decimal places');
  }
  const sellerEntityCode = String(input.sellerEntityCode || '').trim();
  const sellerEntity = sellerEntityCode ? getQuotationSellerEntity(sellerEntityCode) : null;
  if (sellerEntityCode && !sellerEntity) {
    throw new SalesCommercialQuotationDraftError('Selected seller entity is invalid');
  }
  const existingDraft = await repository.getByOpportunity(opportunity.id);
  const customerContact = customerContactFromInput(
    input, opportunity, existingDraft, customerContacts
  );
  const draftLanguage = existingDraft?.language || (language === 'zh' ? 'zh' : 'en');
  const publishedTerms = withBuiltInQuotationTypicalTerms(
    await repository.listPublishedStandardTerms(draftLanguage), draftLanguage
  );
  const termSelections = termSelectionsFromInput(
    input, publishedTerms, draftLanguage, existingDraft?.termSelections
  );
  const lineItems = lineItemsFromInput(input);
  const saved = await repository.saveDraft({
    opportunityId: opportunity.id,
    source,
    language: draftLanguage,
    currency,
    taxRate,
    sellerEntityCode,
    sellerEntityName: sellerEntity?.legalName || '',
    customerContactId: customerContact.id,
    customerContactName: customerContact.name,
    customerContactPhone: customerContact.phone,
    customerContactEmail: customerContact.email,
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
