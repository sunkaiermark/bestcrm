import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import { getQuotationSellerEntity, QUOTATION_SELLER_EMAIL } from '../domain/quotationSellerEntities.mjs';
import { inspectStoredAttachmentFile, removeStoredAttachmentFile, storeAttachmentBuffer } from './attachmentFileService.mjs';
import { canViewOpportunity } from './opportunityService.mjs';

export class SalesCommercialQuotationFormalError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SalesCommercialQuotationFormalError';
    this.statusCode = statusCode;
  }
}

function fail(message, statusCode = 409) {
  throw new SalesCommercialQuotationFormalError(message, statusCode);
}

export function canSubmitSalesCommercialQuotation(user, opportunity) {
  return !opportunity.archivedAt && hasRole(user, ROLES.SALESPERSON)
    && Number(opportunity.salespersonId) === Number(user.id);
}

export function canReviewSalesCommercialQuotation(user, opportunity, version) {
  return !opportunity.archivedAt && version?.status === 'pending'
    && hasRole(user, ROLES.COMMERCIAL_MANAGER)
    && Number(opportunity.commercialManagerId) === Number(user.id)
    && Number(version.submittedBy) !== Number(user.id);
}

export function canSignSalesCommercialQuotation(user, opportunity, version) {
  return !opportunity.archivedAt && version?.status === 'approved'
    && user?.isActive === true && user?.username === 'MarkYang'
    && Number.isSafeInteger(Number(user.id)) && Number(user.id) > 0
    && canViewOpportunity(user, opportunity);
}

function requiredText(value, label, max = 500) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
    fail(`${label} is missing or invalid`);
  }
  return result;
}

function optionalText(value, label, max = 500) {
  const result = String(value ?? '').trim();
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
    fail(`${label} is invalid`);
  }
  return result;
}

function requireVersion(repository, opportunityId, id) {
  return repository.getFormalVersion(id).then((version) => {
    if (!version || Number(version.opportunityId) !== Number(opportunityId)) fail('Quotation version not found', 404);
    return version;
  });
}

function validateLineItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) fail('At least one complete quoted item is required');
  let included = 0;
  for (const item of items) {
    requiredText(item.description, 'Quoted item description', 2000);
    requiredText(item.unit, 'Quoted item unit', 40);
    if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(String(item.quantity || ''))
      || Number(item.quantity) <= 0) fail('Each quoted item requires a positive quantity');
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(String(item.unitPrice || ''))) {
      fail('Each quoted item requires a valid unit price');
    }
    if (!['included', 'excluded'].includes(item.includeInTotal)) fail('Choose whether each item is included in the total');
    if (item.includeInTotal === 'included') included += 1;
  }
  if (!included) fail('At least one quoted item must be included in the total');
}

function validatePublishedSelections(draft, publishedTerms, allowIncomplete = false) {
  const byId = new Map(publishedTerms.map((term) => [Number(term.id), term]));
  for (const section of QUOTATION_COMMERCIAL_TERM_SECTIONS) {
    const selection = draft.termSelections?.[section.key];
    if (selection == null && allowIncomplete) continue;
    const current = byId.get(Number(selection?.id));
    if (!selection || !current || current.key !== section.key
      || current.language !== draft.language || current.revisionNo !== selection.revisionNo
      || current.title !== selection.title || current.body !== selection.body) {
      fail(`A current published standard wording is required for ${section.en}`);
    }
  }
}

async function sellerProfile(settings, entity) {
  if (!settings.sellerProfilesFile && !settings.allowIncompleteFormal) {
    fail('Approved seller contact details are not configured');
  }
  let profiles = {};
  if (settings.sellerProfilesFile) {
    try {
      profiles = JSON.parse(await readFile(settings.sellerProfilesFile, 'utf8'));
    } catch {
      fail('Approved seller contact details are unavailable');
    }
  }
  const profile = profiles?.[entity.code] || {};
  return validatedSeller({ code: entity.code, legalName: entity.legalName,
    address: profile.address, phone: profile.phone, website: profile.website,
    email: QUOTATION_SELLER_EMAIL }, settings.allowIncompleteFormal);
}

function validatedSeller(seller, allowIncomplete = false) {
  const entity = getQuotationSellerEntity(seller?.code);
  if (!entity || seller.legalName !== entity.legalName || seller.email !== QUOTATION_SELLER_EMAIL) {
    fail('Seller identity mismatch');
  }
  const field = allowIncomplete ? optionalText : requiredText;
  const address = field(seller.address, 'Seller address', 1000);
  const phone = field(seller.phone, 'Seller telephone', 100);
  const website = field(seller.website, 'Seller website', 300);
  if (website && !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(website)) fail('Seller website must be an HTTPS URL');
  return { code: entity.code, legalName: entity.legalName, address, phone, website,
    email: QUOTATION_SELLER_EMAIL };
}

function missingFormalFields(snapshot) {
  const missing = ['address', 'phone', 'website']
    .filter((key) => !snapshot.seller[key]).map((key) => `seller.${key}`);
  for (const section of QUOTATION_COMMERCIAL_TERM_SECTIONS) {
    if (!snapshot.termSelections?.[section.key]) missing.push(`term.${section.key}`);
  }
  return missing;
}

async function currentApprovedSource(repository, versionOrDraft, opportunityId) {
  const source = await repository.getTechnicalSource(opportunityId, versionOrDraft.sourceAttachmentId);
  if (!source || source.technicalStatus !== 'approved'
    || source.technicalDraftId !== versionOrDraft.sourceTechnicalDraftId
    || source.sha256 !== versionOrDraft.sourceSha256) {
    fail('The exact approved technical source is no longer available');
  }
  const allSources = await repository.listTechnicalSources(opportunityId);
  if (allSources.some((item) => item.technicalDraftRevisionNo > source.technicalDraftRevisionNo)) {
    fail('A newer technical source revision exists; refresh the quotation');
  }
  return source;
}

export async function submitSalesCommercialQuotation(repository, user, opportunity, expectedRevisionNo, settings = {}) {
  if (!canSubmitSalesCommercialQuotation(user, opportunity)) fail('Forbidden', 403);
  const draft = await repository.getByOpportunity(opportunity.id);
  if (!draft) fail('Quotation draft not found', 404);
  if (Number(expectedRevisionNo) !== draft.draftRevisionNo) fail('Draft revision changed; reload before submitting');
  const entity = getQuotationSellerEntity(draft.sellerEntityCode);
  if (!entity || draft.sellerEntityName !== entity.legalName) fail('Choose a valid seller entity');
  if (!/^[A-Z]{3}$/.test(draft.currency)) fail('Currency is required');
  validateLineItems(draft.lineItems);
  await currentApprovedSource(repository, draft, opportunity.id);
  const publishedTerms = await repository.listPublishedStandardTerms(draft.language);
  validatePublishedSelections(draft, publishedTerms, settings.allowIncompleteFormal);
  const profile = await sellerProfile(settings, entity);
  const snapshot = {
    opportunityNo: requiredText(opportunity.opportunityNo, 'Opportunity reference', 100),
    project: requiredText(opportunity.title, 'Project', 2000),
    customerName: requiredText(opportunity.customerName, 'Customer', 500),
    attention: requiredText(opportunity.primaryContactName, 'Customer contact', 500),
    seller: profile,
    sellerContact: requiredText(opportunity.salespersonDisplayName, 'Seller contact', 500),
    language: draft.language, currency: draft.currency,
    sourceFileName: draft.sourceFileName,
    lineItems: structuredClone(draft.lineItems),
    termSelections: structuredClone(draft.termSelections || {})
  };
  snapshot.missingFields = missingFormalFields(snapshot);
  try {
    const version = await repository.submitFormalVersion({
      opportunityId: opportunity.id, expectedRevisionNo: draft.draftRevisionNo,
      actorUserId: user.id, snapshot
    });
    if (!version) fail('Draft changed before submission; reload');
    return version;
  } catch (error) {
    if (error.code === '23505' || error.code === 'P0001') fail('This draft revision has already been submitted or its technical source changed');
    throw error;
  }
}

export async function reviewSalesCommercialQuotation(repository, user, opportunity, id, decision, comment = '', settings = {}) {
  const version = await requireVersion(repository, opportunity.id, id);
  if (!canReviewSalesCommercialQuotation(user, opportunity, version)) fail('Forbidden', 403);
  if (!['approved', 'rejected'].includes(decision)) fail('Invalid review decision', 400);
  if (decision === 'approved') {
    await currentApprovedSource(repository, version, opportunity.id);
    const terms = await repository.listPublishedStandardTerms(version.snapshot.language);
    validatePublishedSelections(version.snapshot, terms, settings.allowIncompleteFormal);
    validatedSeller(version.snapshot.seller, settings.allowIncompleteFormal);
  }
  const result = await repository.reviewFormalVersion({
    id: version.id, opportunityId: opportunity.id, decision, actorUserId: user.id,
    comment: String(comment || '').trim().slice(0, 2000)
  });
  if (!result) fail('Quotation review state changed; reload');
  return result;
}

async function privatePng(uploadDir, configuredPath, label) {
  if (!configuredPath) fail(`${label} image is not configured`);
  const root = await realpath(path.resolve(uploadDir, 'quotation-signing-assets')).catch(() => null);
  const resolved = await realpath(configuredPath).catch(() => null);
  if (!root || !resolved || path.dirname(resolved) !== root) fail(`${label} must be stored in the private quotation-signing-assets directory`);
  const bytes = await readFile(resolved);
  if (bytes.length < 32 || bytes.length > 5 * 1024 * 1024
    || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`${label} must be a valid PNG under 5 MB`);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function signSalesCommercialQuotation(repository, user, opportunity, id, options) {
  const version = await requireVersion(repository, opportunity.id, id);
  if (!canSignSalesCommercialQuotation(user, opportunity, version)) fail('Only the active MarkYang account may personally sign an approved quotation', 403);
  await currentApprovedSource(repository, version, opportunity.id);
  const terms = await repository.listPublishedStandardTerms(version.snapshot.language);
  validatePublishedSelections(version.snapshot, terms, options.allowIncompleteFormal);
  const seller = validatedSeller(version.snapshot.seller, options.allowIncompleteFormal);
  const signature = await privatePng(options.uploadDir, options.signatureFile, 'Mark Yang signature');
  const seal = seller.code === 'sunkaier_apac'
    ? await privatePng(options.uploadDir, options.apacSealFile, 'Singapore company seal')
    : null;
  const signedAt = new Date().toISOString();
  const pdf = await options.renderPdf({ version, signedAt, signature: signature.bytes,
    seal: seal?.bytes || null, fontPath: options.fontPath });
  if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') fail('Formal PDF generation failed');
  const file = await storeAttachmentBuffer({
    uploadDir: options.uploadDir, originalName: `${version.quotationNo}.pdf`, content: pdf,
    prefix: 'signed-sales-quotations'
  });
  try {
    const result = await repository.signFormalVersion({
      id: version.id, opportunityId: opportunity.id, actorUserId: user.id, signedAt,
      signatureSha256: signature.sha256, sealSha256: seal?.sha256 || null,
      pdfStoredPath: file.storedPath, pdfSha256: file.sha256, pdfFileSize: file.fileSize,
      sourceAttachmentId: version.sourceAttachmentId
    });
    if (!result) fail('Quotation or technical approval changed before signing; reload');
    return result;
  } catch (error) {
    await removeStoredAttachmentFile(file.absolutePath);
    throw error;
  }
}

export async function readSignedSalesCommercialQuotationPdf(version, uploadDir) {
  if (!version || version.status !== 'signed' || !version.pdfStoredPath) fail('Signed quotation PDF not found', 404);
  const file = await inspectStoredAttachmentFile({ uploadDir, storedPath: version.pdfStoredPath });
  if (file.fileSize !== version.pdfFileSize || file.sha256 !== version.pdfSha256) {
    fail('Signed quotation PDF integrity check failed');
  }
  const bytes = await readFile(file.absolutePath);
  if (bytes.length !== version.pdfFileSize
    || createHash('sha256').update(bytes).digest('hex') !== version.pdfSha256) {
    fail('Signed quotation PDF changed while it was being read');
  }
  return bytes;
}
