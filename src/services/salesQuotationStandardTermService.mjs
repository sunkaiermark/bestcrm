import { ROLES, hasRole } from '../domain/roles.mjs';
import { createHash } from 'node:crypto';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';

const TERM_KEYS = new Set(QUOTATION_COMMERCIAL_TERM_SECTIONS.map((section) => section.key));

export class SalesQuotationStandardTermError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SalesQuotationStandardTermError';
    this.statusCode = statusCode;
  }
}

export function canViewSalesQuotationStandardTerms(user) {
  return canAuthorSalesQuotationStandardTerms(user) || canApproveSalesQuotationStandardTerms(user);
}

export function canAuthorSalesQuotationStandardTerms(user) {
  return hasRole(user, ROLES.COMMERCIAL_MANAGER);
}

export function canApproveSalesQuotationStandardTerms(user) {
  return hasRole(user, ROLES.GENERAL_MANAGER);
}

function assertRole(allowed) {
  if (!allowed) throw new SalesQuotationStandardTermError('Forbidden', 403);
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new SalesQuotationStandardTermError('Standard wording id is invalid');
  }
  return id;
}

function fieldsFromInput(input) {
  const key = String(input.termKey || '').trim();
  const language = String(input.language || '').trim();
  const title = String(input.title || '').trim();
  const body = String(input.body || '').trim();
  if (!TERM_KEYS.has(key) || !['en', 'zh'].includes(language)) {
    throw new SalesQuotationStandardTermError('Standard wording section or language is invalid');
  }
  if (!title || title.length > 200 || !body || body.length > 10000) {
    throw new SalesQuotationStandardTermError('Standard wording title or body is missing or too long');
  }
  return { key, language, title, body };
}

export function salesQuotationStandardTermFingerprint(term) {
  return createHash('sha256').update(`${term.title}\0${term.body}`).digest('hex');
}

export async function listSalesQuotationStandardTerms(repository, user, language) {
  assertRole(canViewSalesQuotationStandardTerms(user));
  return repository.listAll(language === 'zh' ? 'zh' : 'en');
}

export async function createSalesQuotationStandardTerm(repository, user, input) {
  assertRole(canAuthorSalesQuotationStandardTerms(user));
  return repository.createDraft({ ...fieldsFromInput(input), actorUserId: user.id });
}

export async function updateSalesQuotationStandardTerm(repository, user, termId, input) {
  assertRole(canAuthorSalesQuotationStandardTerms(user));
  const id = positiveId(termId);
  const current = await repository.findById(id);
  if (!current) throw new SalesQuotationStandardTermError('Standard wording not found', 404);
  if (current.status !== 'draft' || Number(current.createdBy) !== Number(user.id)) {
    throw new SalesQuotationStandardTermError('Only the draft author may edit this wording', 409);
  }
  const fields = fieldsFromInput({ ...input, termKey: current.key, language: current.language });
  const updated = await repository.updateDraft({ id, ...fields, actorUserId: user.id });
  if (!updated) throw new SalesQuotationStandardTermError('Standard wording changed; reload before editing', 409);
  return updated;
}

export async function publishSalesQuotationStandardTerm(repository, user, termId, expectedFingerprint) {
  assertRole(canApproveSalesQuotationStandardTerms(user));
  const id = positiveId(termId);
  const current = await repository.findById(id);
  if (!current) throw new SalesQuotationStandardTermError('Standard wording not found', 404);
  if (current.status !== 'draft') throw new SalesQuotationStandardTermError('Only drafts can be published', 409);
  if (Number(current.createdBy) === Number(user.id)) {
    throw new SalesQuotationStandardTermError('The author cannot approve their own wording', 403);
  }
  if (expectedFingerprint !== salesQuotationStandardTermFingerprint(current)) {
    throw new SalesQuotationStandardTermError('The wording changed since review; reload and check it again', 409);
  }
  const published = await repository.publish({
    id, actorUserId: user.id, expectedTitle: current.title, expectedBody: current.body
  });
  if (!published) throw new SalesQuotationStandardTermError('Standard wording changed; reload before publishing', 409);
  return published;
}

export async function retireSalesQuotationStandardTerm(repository, user, termId) {
  assertRole(canApproveSalesQuotationStandardTerms(user));
  const id = positiveId(termId);
  const retired = await repository.retire({ id, actorUserId: user.id });
  if (!retired) throw new SalesQuotationStandardTermError('Only published wording can be retired', 409);
  return retired;
}
