// SUNKAIER English equipment categories plus the CRM-specific Process Line category.
// Keep exact product names in productInterest; this code is for reporting.
export const PRODUCT_CATEGORIES = Object.freeze([
  { code: 'custom-machines', label: 'Custom Machines' },
  { code: 'filtration', label: 'Filtration' },
  { code: 'flow-control', label: 'Flow Control' },
  { code: 'heat-exchanger', label: 'Heat Exchanger' },
  { code: 'incineration-pyrolysis', label: 'Incineration & Pyrolysis' },
  { code: 'kneaders', label: 'Kneaders' },
  { code: 'mixers', label: 'Mixers' },
  { code: 'process-line', label: 'Process Line' },
  { code: 'pulp-refiners', label: 'Pulp Refiners' },
  { code: 'pumps', label: 'Pumps' },
  { code: 'reactors', label: 'Reactors' },
  { code: 'separation', label: 'Separation' }
]);

const categoryCodes = new Set(PRODUCT_CATEGORIES.map(({ code }) => code));

// These are suggestions, not a product catalogue. Unmatched or ambiguous
// correspondence stays unclassified until a person chooses a category.
const patterns = [
  ['custom-machines', /\b(?:plug\s+screw\s+feeder|screw\s+feeder)\b/i],
  ['filtration', /\b(?:filtration|filters?|filter\s+press)\b|过滤机|过滤器/i],
  ['flow-control', /\b(?:flow\s+control|valves?|dampers?)\b/i],
  ['heat-exchanger', /\b(?:heat\s+exchangers?|heat\s+transfer)\b|换热器/i],
  ['incineration-pyrolysis', /\b(?:incinerat(?:ion|ors?)|pyrolysis|pyrolyzers?)\b/i],
  ['kneaders', /\b(?:kneaders?|kneading\s+machines?)\b|捏合机/i],
  ['mixers', /\b(?:mixers?|mixing\s+machines?|agitators?)\b|混合机|搅拌机/i],
  ['process-line', /\b(?:process|processing|production)\s+lines?\b|生产线|工艺线/i],
  ['pulp-refiners', /\b(?:pulp\s+refiners?|refining\s+equipment)\b/i],
  ['pumps', /\b(?:pumps?|pumping\s+systems?)\b|计量泵|隔膜泵/i],
  ['reactors', /\b(?:reactors?|reaction\s+vessels?)\b|反应釜|反应器/i],
  ['separation', /\b(?:separation|separators?|centrifuges?)\b/i]
];

export const PRODUCT_CATEGORY_SUGGESTION_RULES = Object.freeze(
  patterns.map(([code, pattern]) => ({ code, source: pattern.source }))
);

export function productCategoryLabel(code) {
  return PRODUCT_CATEGORIES.find((category) => category.code === code)?.label || '';
}

export function normalizeConfirmedProductCategories(value) {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const codes = [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
  if (codes.some((code) => !categoryCodes.has(code))) {
    throw new Error('Invalid product category');
  }
  return PRODUCT_CATEGORIES.map(({ code }) => code).filter((code) => codes.includes(code));
}

export function confirmedProductCategoriesFromInput(input = {}, fallback = []) {
  if (Object.hasOwn(input, 'confirmedProductCategoryCodes')) {
    return normalizeConfirmedProductCategories(input.confirmedProductCategoryCodes);
  }
  if (String(input.productCategoriesSubmitted || '') === '1') return [];
  return normalizeConfirmedProductCategories(fallback);
}

// Suggestions are advisory. Never copy them into confirmed categories without
// an explicit user action; multiple matching equipment families are legitimate.
export function suggestProductCategoryCodes({ productInterest, subject, requirementText } = {}) {
  const values = [productInterest, subject, requirementText]
    .map((value) => String(value || '').slice(0, 2000))
    .filter(Boolean);
  return PRODUCT_CATEGORIES
    .map(({ code }) => code)
    .filter((code) => patterns.some(([patternCode, pattern]) =>
      patternCode === code && values.some((value) => pattern.test(value))));
}

export function suggestProductCategoryCode({ productInterest, subject, requirementText } = {}) {
  for (const candidate of [productInterest, subject, requirementText]) {
    const value = String(candidate || '').slice(0, 2000);
    if (!value) continue;
    const matches = patterns.filter(([, pattern]) => pattern.test(value));
    if (matches.length === 1) return matches[0][0];
    if (matches.length > 1) return '';
  }
  return '';
}

export function suggestProductInterest({ subject, requirementText } = {}) {
  for (const candidate of [subject, requirementText]) {
    const value = String(candidate || '').slice(0, 2000);
    if (!value) continue;
    const matches = patterns
      .map(([, pattern]) => value.match(pattern)?.[0])
      .filter(Boolean);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return '';
  }
  return '';
}

export function resolveProductCategoryCode(input = {}, fallback = '') {
  if (!Object.hasOwn(input, 'productCategoryCode') || input.productCategoryCode == null) {
    return fallback || suggestProductCategoryCode(input);
  }
  const code = String(input.productCategoryCode || '').trim();
  if (code && !categoryCodes.has(code)) {
    throw new Error('Invalid product category');
  }
  return code;
}
