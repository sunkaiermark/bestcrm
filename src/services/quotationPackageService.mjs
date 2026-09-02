import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { canViewOpportunity } from './opportunityService.mjs';

export class QuotationPackageValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'QuotationPackageValidationError';
    this.statusCode = statusCode;
  }
}

function forbidden() {
  throw new QuotationPackageValidationError('Forbidden', 403);
}

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new QuotationPackageValidationError(`${label} is required`);
  return normalized;
}

function optionalText(value) {
  return String(value || '').trim();
}

function positiveId(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new QuotationPackageValidationError(`${label} is required`);
  }
  return normalized;
}

function normalizeCurrency(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new QuotationPackageValidationError('Currency must be a three-letter ISO code');
  }
  return normalized;
}

function dateText(value, label) {
  const normalized = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new QuotationPackageValidationError(`${label} must be a date`);
  }
  return normalized;
}

function canManage(user, opportunity) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || (hasRole(user, ROLES.SALESPERSON) && Number(opportunity.salespersonId) === Number(user.id));
}

export function canViewQuotationPackages(user, opportunity) {
  return canViewOpportunity(user, opportunity);
}

export function canManageQuotationPackages(user, opportunity) {
  return canManage(user, opportunity);
}

export function canReviewQuotationPackages(user, opportunity) {
  return hasRole(user, ROLES.COMMERCIAL_MANAGER)
    && Number(opportunity.commercialManagerId) === Number(user.id);
}

function assertView(user, opportunity) {
  if (!canViewQuotationPackages(user, opportunity)) forbidden();
}

function assertManage(user, opportunity) {
  if (!canManageQuotationPackages(user, opportunity)) forbidden();
}

function assertReview(user, opportunity) {
  if (!canReviewQuotationPackages(user, opportunity)) forbidden();
}

function transactionDependencies(dependencies, transactionRepositories) {
  return {
    ...dependencies,
    ...transactionRepositories,
    workflowTransaction: null
  };
}

async function sha256File(filePath, fileReader = readFile) {
  const content = await fileReader(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function loadApprovedContext(repository, opportunity, input) {
  const technicalSolutionVersionId = positiveId(input.technicalSolutionVersionId, 'Technical solution version');
  const commercialQuoteId = positiveId(input.commercialQuoteId, 'Commercial quote');
  const context = await repository.getCreationContext({
    opportunityId: opportunity.id,
    technicalSolutionVersionId,
    commercialQuoteId
  });
  if (!context
      || context.technicalSolution.status !== 'approved'
      || !context.technicalSolution.versionNo
      || context.commercialQuote.status !== 'approved'
      || !context.commercialQuote.versionNo) {
    throw new QuotationPackageValidationError('Approved technical solution and commercial quote versions are required');
  }
  if (!context.technicalDocuments.length) {
    throw new QuotationPackageValidationError('The approved technical solution has no generated documents');
  }
  if (!context.commercialAttachments.length) {
    throw new QuotationPackageValidationError('The approved commercial quote has no attachment');
  }
  return context;
}

function normalizedSnapshotInput(input, context, actorUserId, extra = {}) {
  return {
    ...extra,
    technicalSolutionVersionId: context.technicalSolution.id,
    commercialQuoteId: context.commercialQuote.id,
    currency: normalizeCurrency(input.currency),
    totalPrice: context.commercialQuote.totalPrice,
    deliveryPeriod: requiredText(input.deliveryPeriod, 'Delivery period'),
    paymentTerms: requiredText(context.commercialQuote.paymentTerms, 'Approved payment terms'),
    validUntil: dateText(context.commercialQuote.validityDate, 'Approved validity date'),
    commercialLineItems: context.commercialQuote.items,
    inclusions: optionalText(input.inclusions),
    exclusions: optionalText(input.exclusions),
    technicalAssumptions: optionalText(input.technicalAssumptions),
    revisionReason: optionalText(input.revisionReason),
    changeSummary: optionalText(input.changeSummary),
    actorUserId
  };
}

async function saveAttachmentSnapshots(dependencies, packageVersion, context) {
  let displayOrder = 1;
  for (const document of context.technicalDocuments) {
    await dependencies.quotationPackageRepository.addAttachmentSnapshot({
      quotationPackageId: packageVersion.id,
      sourceType: 'technical_solution_document',
      technicalSolutionDocumentId: document.id,
      originalName: document.originalName,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      sha256: document.sha256,
      displayOrder
    });
    displayOrder += 1;
  }
  for (const attachment of context.commercialAttachments) {
    const sha256 = await sha256File(
      attachment.storedPath,
      dependencies.quotationPackageFileReader || readFile
    );
    await dependencies.quotationPackageRepository.addAttachmentSnapshot({
      quotationPackageId: packageVersion.id,
      sourceType: 'commercial_quote_attachment',
      attachmentId: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      sha256,
      displayOrder
    });
    displayOrder += 1;
  }
}

function assertRevisionMetadata(sourcePackageId, revisionReason, changeSummary) {
  if (sourcePackageId && (!revisionReason || !changeSummary)) {
    throw new QuotationPackageValidationError('Revision reason and customer-readable change summary are required');
  }
}

async function validateRevisionSource(repository, opportunityId, sourcePackageId) {
  if (!sourcePackageId) return null;
  const source = await repository.getPackageDetail(sourcePackageId);
  if (!source || source.opportunityId !== Number(opportunityId) || !['sent', 'superseded'].includes(source.status)) {
    throw new QuotationPackageValidationError('A sent quotation package from this opportunity is required as the revision source');
  }
  return source;
}

export async function listQuotationPackages(repository, user, opportunity) {
  assertView(user, opportunity);
  return repository.listByOpportunity(opportunity.id);
}

export async function getQuotationPackage(repository, user, opportunity, packageId) {
  assertView(user, opportunity);
  const packageVersion = await repository.getPackageDetail(positiveId(packageId, 'Quotation package'));
  if (!packageVersion || packageVersion.opportunityId !== Number(opportunity.id)) {
    throw new QuotationPackageValidationError('Quotation package not found', 404);
  }
  return packageVersion;
}

export async function getQuotationPackageCreationOptions(repository, user, opportunity) {
  assertManage(user, opportunity);
  const [technicalSolutions, commercialQuotes, packages] = await Promise.all([
    repository.listApprovedTechnicalSolutions(opportunity.id),
    repository.listApprovedCommercialQuotes(opportunity.id),
    repository.listByOpportunity(opportunity.id)
  ]);
  const sourcePackages = packages.filter((item) => ['sent', 'superseded'].includes(item.status));
  return { technicalSolutions, commercialQuotes, sourcePackages };
}

export async function createQuotationPackageDraft(dependencies, user, opportunity, input) {
  assertManage(user, opportunity);
  if (!['customer_negotiation'].includes(opportunity.status)) {
    throw new QuotationPackageValidationError('Quotation packages can be created during customer negotiation');
  }
  if (typeof dependencies.workflowTransaction === 'function') {
    return dependencies.workflowTransaction((repositories) => createQuotationPackageDraft(
      transactionDependencies(dependencies, repositories), user, opportunity, input
    ));
  }
  const repository = dependencies.quotationPackageRepository;
  const existingPackages = await repository.listByOpportunity(opportunity.id);
  if (existingPackages.some((item) => ['draft', 'pending', 'approved', 'accepted'].includes(item.status))) {
    throw new QuotationPackageValidationError('Finish the current quotation package before creating another revision', 409);
  }
  const context = await loadApprovedContext(repository, opportunity, input);
  const sourcePackageId = input.sourcePackageId ? positiveId(input.sourcePackageId, 'Source package') : null;
  const source = await validateRevisionSource(repository, opportunity.id, sourcePackageId);
  const currentSent = typeof repository.findCurrentSentByOpportunity === 'function'
    ? await repository.findCurrentSentByOpportunity(opportunity.id)
    : existingPackages.find((item) => item.status === 'sent') || null;
  if ((currentSent && source?.id !== currentSent.id) || (!currentSent && source)) {
    throw new QuotationPackageValidationError('The revision must be created from the current sent quotation package');
  }
  const normalized = normalizedSnapshotInput(input, context, user.id, {
    opportunityId: opportunity.id,
    sourcePackageId
  });
  assertRevisionMetadata(sourcePackageId, normalized.revisionReason, normalized.changeSummary);
  const packageVersion = await repository.createDraft(normalized);
  if (!packageVersion) throw new QuotationPackageValidationError('An open quotation package draft already exists', 409);
  await saveAttachmentSnapshots(dependencies, packageVersion, context);
  return repository.getPackageDetail(packageVersion.id);
}

export async function updateQuotationPackageDraft(dependencies, user, opportunity, packageVersion, input) {
  assertManage(user, opportunity);
  if (packageVersion.status !== 'draft') forbidden();
  if (typeof dependencies.workflowTransaction === 'function') {
    return dependencies.workflowTransaction((repositories) => updateQuotationPackageDraft(
      transactionDependencies(dependencies, repositories), user, opportunity, packageVersion, input
    ));
  }
  const repository = dependencies.quotationPackageRepository;
  const context = await loadApprovedContext(repository, opportunity, input);
  const normalized = normalizedSnapshotInput(input, context, user.id, { packageId: packageVersion.id });
  assertRevisionMetadata(packageVersion.sourcePackageId, normalized.revisionReason, normalized.changeSummary);
  const updated = await repository.updateDraft(normalized);
  if (!updated) throw new QuotationPackageValidationError('Only draft quotation packages can be edited', 409);
  await repository.replaceAttachmentSnapshots(updated.id);
  await saveAttachmentSnapshots(dependencies, updated, context);
  return repository.getPackageDetail(updated.id);
}

export async function submitQuotationPackage(repository, user, opportunity, packageVersion, comment) {
  assertManage(user, opportunity);
  if (packageVersion.status !== 'draft') forbidden();
  assertRevisionMetadata(packageVersion.sourcePackageId, packageVersion.revisionReason, packageVersion.changeSummary);
  const submitted = await repository.submitDraft({
    packageId: packageVersion.id,
    actorUserId: user.id,
    comment: optionalText(comment)
  });
  if (!submitted) throw new QuotationPackageValidationError('Quotation package must include frozen attachments', 409);
  return submitted;
}

export async function reviewQuotationPackage(repository, user, opportunity, packageVersion, decision, comment) {
  assertReview(user, opportunity);
  if (packageVersion.status !== 'pending') forbidden();
  const normalizedDecision = String(decision || '').trim();
  if (normalizedDecision === 'approve') {
    const approved = await repository.approvePending({
      packageId: packageVersion.id,
      actorUserId: user.id,
      comment: optionalText(comment)
    });
    if (!approved) throw new QuotationPackageValidationError('Quotation package is no longer pending', 409);
    return approved;
  }
  if (normalizedDecision === 'reject') {
    const rejectionComment = requiredText(comment, 'Rejection reason');
    const rejected = await repository.rejectPending({
      packageId: packageVersion.id,
      actorUserId: user.id,
      comment: rejectionComment
    });
    if (!rejected) throw new QuotationPackageValidationError('Quotation package is no longer pending', 409);
    return rejected;
  }
  throw new QuotationPackageValidationError('Review decision is invalid');
}

export async function markQuotationPackageSent(repository, user, opportunity, packageVersion, comment) {
  assertManage(user, opportunity);
  if (packageVersion.status !== 'approved') forbidden();
  const sent = await repository.markSent({
    packageId: packageVersion.id,
    actorUserId: user.id,
    comment: optionalText(comment)
  });
  if (!sent) throw new QuotationPackageValidationError('Approved quotation package could not be marked as sent', 409);
  return sent;
}

export async function acceptQuotationPackage(repository, user, opportunity, packageVersion, comment) {
  assertManage(user, opportunity);
  if (packageVersion.status !== 'sent') forbidden();
  const accepted = await repository.acceptSent({
    packageId: packageVersion.id,
    actorUserId: user.id,
    comment: optionalText(comment)
  });
  if (!accepted) throw new QuotationPackageValidationError('Only the current sent quotation package can be accepted', 409);
  return accepted;
}

const comparedFields = [
  ['currency', 'Currency'],
  ['totalPrice', 'Total price'],
  ['deliveryPeriod', 'Delivery period'],
  ['paymentTerms', 'Payment terms'],
  ['validUntil', 'Validity'],
  ['inclusions', 'Inclusions'],
  ['exclusions', 'Exclusions'],
  ['technicalAssumptions', 'Technical assumptions'],
  ['technicalSolutionVersionNo', 'Technical solution version'],
  ['commercialQuoteVersionNo', 'Commercial quote version']
];

export function compareQuotationPackages(current, source) {
  if (!source) return [];
  const changes = comparedFields.flatMap(([field, label]) => {
    const before = source[field] ?? '';
    const after = current[field] ?? '';
    return String(before) === String(after) ? [] : [{ field, label, before, after }];
  });
  const attachmentSignature = (item) => `${item.sourceType}:${item.originalName}:${item.sha256}`;
  const beforeAttachments = (source.attachments || []).map(attachmentSignature).sort();
  const afterAttachments = (current.attachments || []).map(attachmentSignature).sort();
  if (JSON.stringify(beforeAttachments) !== JSON.stringify(afterAttachments)) {
    changes.push({
      field: 'attachments',
      label: 'Attachments',
      before: beforeAttachments.join('\n'),
      after: afterAttachments.join('\n')
    });
  }
  return changes;
}
