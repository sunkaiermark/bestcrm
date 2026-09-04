import {
  BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS,
  BID_VARIABLE_DATA_TYPES,
  BID_WORKSPACE_LANGUAGES
} from '../domain/bidWorkspace.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';

const variableKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const sectionKeyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const unsafeSyntax = /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|<%|%>|{{|}}|{%|%})/i;
const allowedSources = new Set(BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS);
const allowedDataTypes = new Set(BID_VARIABLE_DATA_TYPES);

function fail(message, statusCode = 400, code = BID_CENTER_ERROR_CODES.VALIDATION) {
  throw new BidCenterServiceError(message, { statusCode, code });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeText(value, field, maxLength = 5000) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > maxLength) fail(`${field} is too long`);
  if (normalized && unsafeSyntax.test(normalized)) fail(`${field} contains unsupported template or script syntax`);
  return normalized;
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function validIsoDate(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized;
}

function normalizeVariableValue(variable, rawValue, { strict = true } = {}) {
  if (isBlank(rawValue)) return '';
  if (variable.dataType === 'number' || variable.dataType === 'integer') {
    const number = Number(rawValue);
    if (!Number.isFinite(number) || (variable.dataType === 'integer' && !Number.isInteger(number))) {
      if (strict) fail(`${variable.variableKey} has an invalid ${variable.dataType} value`);
      return String(rawValue);
    }
    return number;
  }
  if (variable.dataType === 'boolean') {
    if (rawValue === true || ['true', '1', 'on'].includes(String(rawValue).toLowerCase())) return true;
    if (rawValue === false || ['false', '0', 'off'].includes(String(rawValue).toLowerCase())) return false;
    if (strict) fail(`${variable.variableKey} has an invalid boolean value`);
    return String(rawValue);
  }
  if (variable.dataType === 'date') {
    const normalized = String(rawValue).trim();
    if (!validIsoDate(normalized) && strict) fail(`${variable.variableKey} has an invalid date value`);
    return normalized;
  }
  return safeText(rawValue, variable.variableKey);
}

function sourceValue(sourceField, context) {
  const values = {
    manual: '',
    customer_legal_name: context.customerName,
    customer_address: context.customerAddress,
    customer_country: context.customerCountry,
    customer_region: context.customerRegion,
    contact_name: context.contactName,
    contact_title: context.contactTitle,
    contact_email: context.contactEmail,
    contact_phone: context.contactPhone,
    opportunity_no: context.opportunityNo,
    opportunity_title: context.opportunityTitle,
    requirement_summary: context.requirementSummary,
    product_name: context.productName,
    estimated_amount: context.estimatedAmount,
    quotation_number: context.quotationNumber,
    currency: context.currency,
    tax_rate: context.taxRate,
    total_price: context.totalPrice,
    payment_terms: context.paymentTerms,
    quotation_validity: context.quotationValidity,
    delivery_period: context.deliveryCycle,
    incoterms: context.incoterms,
    delivery_destination: context.deliveryDestination,
    packing_terms: context.packingTerms,
    transport_terms: context.transportTerms,
    insurance_terms: context.insuranceTerms,
    warranty_period: context.warrantyPeriod,
    after_sales_terms: context.afterSalesTerms,
    commercial_manager: context.commercialManager,
    technical_manager: context.technicalManager,
    opportunity_owner: context.opportunityOwner,
    signature_date: context.signatureDate
  };
  return values[sourceField] ?? '';
}

export function normalizeCommercialVariableSchema(schema) {
  if (!Array.isArray(schema) || schema.length > 200) fail('Commercial variable schema is invalid');
  const seen = new Set();
  return schema.map((candidate, index) => {
    const variableKey = String(candidate?.variableKey ?? '').trim();
    const dataType = String(candidate?.dataType ?? '').trim();
    const sourceField = String(candidate?.sourceField ?? 'manual').trim();
    const sectionKey = String(candidate?.sectionKey ?? 'commercial_response').trim();
    if (!variableKeyPattern.test(variableKey) || seen.has(variableKey)) fail('Commercial variable key is invalid');
    if (!allowedDataTypes.has(dataType)) fail(`${variableKey} data type is invalid`);
    if (!allowedSources.has(sourceField)) fail(`${variableKey} source is not approved`);
    if (!sectionKeyPattern.test(sectionKey)) fail(`${variableKey} section is invalid`);
    seen.add(variableKey);
    const validationRules = candidate?.validationRules && typeof candidate.validationRules === 'object'
      && !Array.isArray(candidate.validationRules) ? deepClone(candidate.validationRules) : {};
    if (Array.isArray(validationRules.allowedValues) && validationRules.allowedValues.length > 100) {
      fail(`${variableKey} allowed values are invalid`);
    }
    return {
      variableKey,
      labelEn: safeText(candidate.labelEn || variableKey, `${variableKey} English label`, 200),
      labelZh: safeText(candidate.labelZh || variableKey, `${variableKey} Chinese label`, 200),
      dataType,
      sourceField,
      sectionKey,
      isRequired: candidate.isRequired === true,
      defaultValue: candidate.defaultValue ?? '',
      validationRules,
      sortOrder: Number.isInteger(Number(candidate.sortOrder)) && Number(candidate.sortOrder) > 0
        ? Number(candidate.sortOrder) : index + 1
    };
  }).sort((left, right) => left.sortOrder - right.sortOrder);
}

export function prefillCommercialDraftVariables(variableSchema, context) {
  const values = {};
  const sources = {};
  for (const variable of variableSchema) {
    const sourced = sourceValue(variable.sourceField, context);
    const hasSourcedValue = !isBlank(sourced);
    const hasDefault = !hasSourcedValue && !isBlank(variable.defaultValue);
    const selected = hasSourcedValue ? sourced : variable.defaultValue;
    values[variable.variableKey] = normalizeVariableValue(variable, selected, { strict: false });
    sources[variable.variableKey] = {
      sourceType: hasSourcedValue ? 'crm' : hasDefault ? 'template_default' : 'manual',
      sourceField: variable.sourceField,
      valueAtCreation: values[variable.variableKey]
    };
  }
  return { values, sources };
}

export function applyCommercialVariableOverrides(variableSchema, values, sources, overrides = {}) {
  const nextValues = { ...values };
  const nextSources = deepClone(sources) || {};
  for (const variable of variableSchema) {
    if (!Object.hasOwn(overrides, variable.variableKey)) continue;
    const normalized = normalizeVariableValue(variable, overrides[variable.variableKey]);
    if (String(normalized) === String(values[variable.variableKey] ?? '')) continue;
    nextValues[variable.variableKey] = normalized;
    nextSources[variable.variableKey] = {
      sourceType: 'manual_override',
      sourceField: variable.sourceField,
      previousValue: values[variable.variableKey] ?? '',
      valueAtCreation: normalized
    };
  }
  return { values: nextValues, sources: nextSources };
}

export function validateCommercialDraftVariables(variableSchema, variableValues) {
  const issues = [];
  for (const variable of variableSchema) {
    const value = variableValues?.[variable.variableKey];
    if (variable.isRequired && isBlank(value)) {
      issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'required', labelEn: variable.labelEn, labelZh: variable.labelZh });
      continue;
    }
    if (isBlank(value)) continue;
    if (variable.dataType === 'number' || variable.dataType === 'integer') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || (variable.dataType === 'integer' && !Number.isInteger(numeric))) {
        issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'type', labelEn: variable.labelEn, labelZh: variable.labelZh });
        continue;
      }
      if (variable.validationRules.min !== undefined && numeric < Number(variable.validationRules.min)) {
        issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'minimum', expected: variable.validationRules.min, labelEn: variable.labelEn, labelZh: variable.labelZh });
      }
      if (variable.validationRules.max !== undefined && numeric > Number(variable.validationRules.max)) {
        issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'maximum', expected: variable.validationRules.max, labelEn: variable.labelEn, labelZh: variable.labelZh });
      }
    } else if (variable.dataType === 'boolean' && typeof value !== 'boolean') {
      issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'type', labelEn: variable.labelEn, labelZh: variable.labelZh });
    } else if (variable.dataType === 'date' && !validIsoDate(value)) {
      issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'type', labelEn: variable.labelEn, labelZh: variable.labelZh });
    }
    if (Array.isArray(variable.validationRules.allowedValues)
        && variable.validationRules.allowedValues.length
        && !variable.validationRules.allowedValues.map(String).includes(String(value))) {
      issues.push({ variableKey: variable.variableKey, sectionKey: variable.sectionKey, code: 'allowed_values', expected: variable.validationRules.allowedValues, labelEn: variable.labelEn, labelZh: variable.labelZh });
    }
  }
  return issues;
}

function contentComponentIds(contentSchema) {
  return [...new Set((contentSchema?.sections || [])
    .flatMap((section) => section.contentBlockIds || [])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0))];
}

function assertContentSnapshots(contentSchema, contentSnapshots, todayIso) {
  const requiredIds = contentComponentIds(contentSchema);
  const snapshotsById = new Map(contentSnapshots.map((snapshot) => [Number(snapshot.blockId), snapshot]));
  if (requiredIds.some((id) => !snapshotsById.has(id))) {
    fail('Commercial template references content that is not currently published and active', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  for (const id of requiredIds) {
    const snapshot = snapshotsById.get(id);
    const effectiveDate = snapshot.effectiveDate ? new Date(snapshot.effectiveDate).toISOString().slice(0, 10) : '';
    const expiresAt = snapshot.expiresAt ? new Date(snapshot.expiresAt).toISOString().slice(0, 10) : '';
    if ((effectiveDate && effectiveDate > todayIso)
        || (expiresAt && expiresAt < todayIso)) {
      fail(`Content ${snapshot.blockCode} is outside its effective dates`, 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
  }
  return snapshotsById;
}

function renderCommercialContent(contentSchema, variableSchema, variableValues, contentSnapshots, todayIso) {
  const snapshotsById = assertContentSnapshots(contentSchema, contentSnapshots, todayIso);
  return {
    schemaVersion: 1,
    sections: [...(contentSchema?.sections || [])]
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
      .map((section) => ({
        ...deepClone(section),
        contentBlocks: (section.contentBlockIds || []).map((id) => deepClone(snapshotsById.get(Number(id))))
      })),
    variables: variableSchema.map((variable) => ({
      variableKey: variable.variableKey,
      labelEn: variable.labelEn,
      labelZh: variable.labelZh,
      sectionKey: variable.sectionKey,
      value: variableValues[variable.variableKey] ?? ''
    }))
  };
}

export function buildOpportunityCommercialDraftSnapshot({
  opportunity,
  template,
  revision,
  context,
  contentSnapshots,
  language,
  actorUserId,
  overrides = {},
  snapshotAt = new Date().toISOString()
}) {
  if (!BID_WORKSPACE_LANGUAGES.includes(language)) fail('Workspace language is invalid');
  if (!template || template.isActive !== true || Number(template.currentPublishedRevisionId) !== Number(revision?.id)
      || revision?.status !== 'published' || ![language, 'bilingual'].includes(template.language)) {
    fail('Only a compatible active current published commercial template can be used', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  const variableSchema = normalizeCommercialVariableSchema(revision.variableSchema || []);
  const prefilled = prefillCommercialDraftVariables(variableSchema, context);
  const resolved = applyCommercialVariableOverrides(variableSchema, prefilled.values, prefilled.sources, overrides);
  const todayIso = snapshotAt.slice(0, 10);
  const renderedContent = renderCommercialContent(
    revision.contentSchema,
    variableSchema,
    resolved.values,
    contentSnapshots,
    todayIso
  );
  const validationIssues = validateCommercialDraftVariables(variableSchema, resolved.values);
  return {
    opportunityId: Number(opportunity.id),
    templateRevisionId: Number(revision.id),
    language,
    templateCodeSnapshot: template.templateCode,
    templateNameSnapshot: language === 'zh' ? template.nameZh : template.nameEn,
    templateRevisionNoSnapshot: Number(revision.revisionNo),
    contentSchemaSnapshot: deepClone(revision.contentSchema),
    variableSchemaSnapshot: variableSchema,
    validationRulesSnapshot: deepClone(revision.validationRules || {}),
    variableValues: resolved.values,
    renderedContent,
    sourceMetadata: {
      schemaVersion: 1,
      snapshotAt,
      opportunityId: Number(opportunity.id),
      opportunityNo: opportunity.opportunityNo,
      customerId: Number(context.customerId),
      contactId: context.contactId,
      templateId: Number(template.id),
      templateRevisionId: Number(revision.id),
      approvedCommercialQuoteId: context.quoteId,
      variableValueSources: resolved.sources,
      contentComponentSnapshots: deepClone(contentSnapshots)
    },
    validationIssues,
    actorUserId: Number(actorUserId)
  };
}

export function commercialContentComponentIds(contentSchema) {
  return contentComponentIds(contentSchema);
}
