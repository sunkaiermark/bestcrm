export const DEVELOPMENT_SOURCE_TYPES = Object.freeze([
  'customer_idea',
  'opportunity_requirement',
  'product_upgrade',
  'internal_research',
  'implementation_feedback'
]);

export const DEVELOPMENT_DIRECTIONS = Object.freeze([
  'process_technology',
  'key_equipment',
  'implementation_support'
]);

export class DevelopmentTopicError extends Error {
  constructor(message, statusCode = 422, fields = []) {
    super(message);
    this.name = 'DevelopmentTopicError';
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

export function normalizeDevelopmentTopicDraft(input = {}) {
  const title = String(input.title || '').trim();
  const sourceType = String(input.sourceType || '').trim();
  const problemStatement = String(input.problemStatement || '').trim();
  if (!title || title.length > 200) {
    throw new DevelopmentTopicError('Development topic title must contain 1–200 characters', 422, ['title']);
  }
  if (!DEVELOPMENT_SOURCE_TYPES.includes(sourceType)) {
    throw new DevelopmentTopicError('Invalid development topic source', 422, ['sourceType']);
  }
  if (problemStatement.length > 20000) {
    throw new DevelopmentTopicError('Development problem statement is too long', 422, ['problemStatement']);
  }
  if (!Array.isArray(input.directions)) {
    throw new DevelopmentTopicError('Development directions must be a list', 422, ['directions']);
  }
  const directions = [...new Set(input.directions)];
  if (directions.some((direction) => !DEVELOPMENT_DIRECTIONS.includes(direction))) {
    throw new DevelopmentTopicError('Invalid development direction', 422, ['directions']);
  }
  return { title, sourceType, problemStatement, directions };
}
