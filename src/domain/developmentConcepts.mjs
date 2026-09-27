import { createHash } from 'node:crypto';

export class DevelopmentConceptError extends Error {
  constructor(message, statusCode = 422, fields = []) {
    super(message);
    this.name = 'DevelopmentConceptError';
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

function textField(value, field, limit) {
  if (value != null && typeof value !== 'string') {
    throw new DevelopmentConceptError(`${field} must be text`, 422, [field]);
  }
  const result = String(value ?? '').trim();
  if (result.length > limit) {
    throw new DevelopmentConceptError(`${field} is too long`, 422, [field]);
  }
  return result;
}

function textList(value, field, maxItems = 12) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new DevelopmentConceptError(`${field} must be a short list`, 422, [field]);
  }
  return value.map((item) => textField(item, field, 600)).filter(Boolean);
}

export function normalizeConceptSnapshot(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DevelopmentConceptError('Concept package must be an object');
  }
  if (input.options != null && (!Array.isArray(input.options) || input.options.length > 8)) {
    throw new DevelopmentConceptError('options must be a short list', 422, ['options']);
  }
  const options = (input.options || []).map((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      throw new DevelopmentConceptError('Each option must be an object', 422, ['options']);
    }
    return {
      name: textField(option.name, 'options.name', 200),
      benefits: textField(option.benefits, 'options.benefits', 1000),
      tradeoffs: textField(option.tradeoffs, 'options.tradeoffs', 1000)
    };
  });
  const snapshot = {
    problem: textField(input.problem, 'problem', 2000),
    application: textField(input.application, 'application', 2000),
    scope: textField(input.scope, 'scope', 1500),
    options,
    preferredOption: textField(input.preferredOption, 'preferredOption', 200),
    assumptions: textList(input.assumptions, 'assumptions'),
    risks: textList(input.risks, 'risks'),
    evidence: textList(input.evidence, 'evidence'),
    nextStepEffort: textField(input.nextStepEffort, 'nextStepEffort', 1000),
    customerOpportunityRelation: textField(
      input.customerOpportunityRelation, 'customerOpportunityRelation', 1000
    )
  };
  if (canonicalConceptJson(snapshot).length > 12000) {
    throw new DevelopmentConceptError('Concept package exceeds one-page limit');
  }
  return snapshot;
}

export function assertConceptReadyForSubmission(snapshot) {
  const concept = normalizeConceptSnapshot(snapshot);
  const missing = [];
  for (const field of ['problem', 'application', 'scope', 'nextStepEffort']) {
    if (!concept[field]) missing.push(field);
  }
  if (!concept.options.length || concept.options.some((option) =>
    !option.name || !option.benefits || !option.tradeoffs
  )) missing.push('options');
  if (!concept.preferredOption || !concept.options.some((option) =>
    option.name === concept.preferredOption
  )) missing.push('preferredOption');
  for (const field of ['assumptions', 'risks', 'evidence']) {
    if (!concept[field].length) missing.push(field);
  }
  if (missing.length) {
    throw new DevelopmentConceptError(
      `Concept package is incomplete: ${missing.join(', ')}`, 422, missing
    );
  }
  return concept;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

export function canonicalConceptJson(snapshot) {
  return JSON.stringify(sortKeys(snapshot));
}

export function conceptSnapshotSha256(snapshot) {
  return createHash('sha256').update(canonicalConceptJson(snapshot)).digest('hex');
}
