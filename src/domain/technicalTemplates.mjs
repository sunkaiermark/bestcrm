export const TECHNICAL_TEMPLATE_LANGUAGES = Object.freeze(['en', 'zh', 'bilingual']);

export const TECHNICAL_DOCUMENT_TYPES = Object.freeze([
  Object.freeze({ value: 'datasheet', label: 'Datasheet', labelEn: 'Datasheet', labelZh: '技术数据表', code: 'DATASHEET' }),
  Object.freeze({ value: 'technical_agreement', label: 'Technical Agreement', labelEn: 'Technical Agreement', labelZh: '技术协议', code: 'TECHNICAL-AGREEMENT' }),
  Object.freeze({ value: 'bidding_document', label: 'Bidding Document', labelEn: 'Bidding Document', labelZh: '标书', code: 'BIDDING-DOCUMENT' })
]);

export const TECHNICAL_PRODUCT_CATEGORIES = Object.freeze([
  Object.freeze({ code: 'mixer', labelZh: '搅拌机', labelEn: 'Mixer' }),
  Object.freeze({ code: 'rubber_cutter', labelZh: '切胶机', labelEn: 'Rubber Cutter' }),
  Object.freeze({ code: 'grinding_mill', labelZh: '研磨机', labelEn: 'Grinding Mill' }),
  Object.freeze({ code: 'steam_tube_dryer', labelZh: '蒸汽管式干燥机', labelEn: 'Steam Tube Dryer' }),
  Object.freeze({ code: 'tube_bundle_dryer', labelZh: '管束干燥机', labelEn: 'Tube Bundle Dryer' }),
  Object.freeze({ code: 'sk3000e_kneader', labelZh: 'SK3000E 捏合机', labelEn: 'SK3000E Kneader' }),
  Object.freeze({ code: 'sk3000s_kneader', labelZh: 'SK3000S 捏合机', labelEn: 'SK3000S Kneader' }),
  Object.freeze({ code: 'sk3000f_kneader', labelZh: 'SK3000F 捏合机', labelEn: 'SK3000F Kneader' }),
  Object.freeze({ code: 'wiped_film_evaporator', labelZh: '刮膜蒸发器', labelEn: 'Wiped Film Evaporator' }),
  Object.freeze({ code: 'skid_equipment', labelZh: '撬装设备', labelEn: 'Skid-mounted Equipment' })
]);

const technicalDocumentTypeByValue = new Map(TECHNICAL_DOCUMENT_TYPES.map((item) => [item.value, item]));
const technicalProductCategoryByCode = new Map(TECHNICAL_PRODUCT_CATEGORIES.map((item) => [item.code, item]));

export function technicalDocumentType(value) {
  return technicalDocumentTypeByValue.get(String(value || '')) || null;
}

export function technicalContentLanguage(value) {
  return value === 'zh' ? 'zh' : 'en';
}

export function technicalDocumentTypeLabel(value, language = 'en') {
  const type = technicalDocumentType(value);
  if (!type) return '';
  return technicalContentLanguage(language) === 'zh' ? type.labelZh : type.labelEn;
}

export function localizedTechnicalField(record, field, language = 'en') {
  const suffix = technicalContentLanguage(language) === 'zh' ? 'Zh' : 'En';
  const localizedKey = `${field}${suffix}`;
  if (record && Object.prototype.hasOwnProperty.call(record, localizedKey)) {
    return String(record[localizedKey] ?? '').trim();
  }
  return String(record?.[field] ?? '').trim();
}

export function technicalProductCategory(code) {
  return technicalProductCategoryByCode.get(String(code || '')) || null;
}

export function opportunityTechnicalDocumentCode(opportunityNo, documentType, itemNo = null) {
  const opportunityCode = String(opportunityNo || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const type = technicalDocumentType(documentType);
  if (!opportunityCode || !type) return '';
  if (type.value === 'datasheet') {
    const normalizedItemNo = Number(itemNo);
    if (!Number.isInteger(normalizedItemNo) || normalizedItemNo < 1) return '';
    return `${opportunityCode}-${String(normalizedItemNo).padStart(2, '0')}-${type.code}`;
  }
  return `${opportunityCode}-${type.code}`;
}

export function opportunityTechnicalDocumentVersionLabel(documentCode, versionNo) {
  return `${String(documentCode || '').trim()}-V${Number(versionNo)}`;
}

export const TECHNICAL_TEMPLATE_REVISION_STATUSES = Object.freeze([
  'draft',
  'review_pending',
  'published',
  'retired'
]);

export const TECHNICAL_TEMPLATE_VARIABLE_TYPES = Object.freeze([
  'text',
  'number',
  'integer',
  'boolean',
  'date'
]);

export const TECHNICAL_TEMPLATE_VARIABLE_SOURCES = Object.freeze([
  'manual',
  'customer_name',
  'contact_name',
  'opportunity_title',
  'requirement_summary',
  'product_name',
  'product_model',
  'capacity',
  'medium',
  'temperature',
  'pressure',
  'material',
  'motor',
  'voltage_frequency',
  'hazardous_area_rating',
  'standards',
  'delivery_destination',
  'opportunity_owner'
]);

export const TECHNICAL_SECTION_TYPES = Object.freeze([
  'narrative',
  'parameter_table',
  'equipment_table',
  'materials_table',
  'instrumentation_table',
  'electrical_table',
  'utilities_table',
  'scope_matrix'
]);

export const TECHNICAL_TABLE_ALIGNMENTS = Object.freeze([
  'left',
  'center',
  'right'
]);

export const TECHNICAL_IMAGE_ALIGNMENTS = Object.freeze([
  'left',
  'center',
  'right'
]);

export const TECHNICAL_SECTION_CONDITION_OPERATORS = Object.freeze([
  'always',
  'equals',
  'not_equals',
  'contains',
  'truthy'
]);

export const OPPORTUNITY_TECHNICAL_DRAFT_STATUSES = Object.freeze([
  'draft',
  'ready',
  'pending',
  'approved',
  'rejected'
]);

const sectionTypeByKey = Object.freeze({
  equipment_list: 'equipment_table',
  design_parameters: 'parameter_table',
  materials_of_construction: 'materials_table',
  instrumentation_control: 'instrumentation_table',
  electrical_requirements: 'electrical_table',
  utilities: 'utilities_table',
  scope_of_supply: 'scope_matrix',
  interfaces_battery_limits: 'scope_matrix'
});

function defaultSectionLayout(sectionType = 'narrative') {
  return Object.freeze({
    pageBreakBefore: false,
    table: Object.freeze({
      headerRow: sectionType !== 'narrative',
      columnWidths: Object.freeze([]),
      columnAlignments: Object.freeze([]),
      merges: Object.freeze([])
    }),
    image: null
  });
}

export const TECHNICAL_AGREEMENT_STANDARD_SECTIONS = Object.freeze([
  ['cover_and_parties', 'Cover and Parties', '封面与协议双方'],
  ['project_basis', 'Project Basis', '项目依据'],
  ['process_description', 'Process Description', '工艺说明'],
  ['scope_of_supply', 'Scope of Supply', '供货范围'],
  ['equipment_list', 'Equipment List', '设备清单'],
  ['design_parameters', 'Design Parameters', '设计参数'],
  ['materials_of_construction', 'Materials of Construction', '设备材质'],
  ['mechanical_configuration', 'Mechanical Configuration', '机械配置'],
  ['instrumentation_control', 'Instrumentation and Control', '仪表与控制'],
  ['electrical_requirements', 'Electrical Requirements', '电气要求'],
  ['utilities', 'Utilities', '公用工程'],
  ['interfaces_battery_limits', 'Interfaces and Battery Limits', '接口与界区'],
  ['exclusions', 'Exclusions', '除外项'],
  ['documentation', 'Documentation', '文件资料'],
  ['inspection_fat_sat', 'Inspection and FAT/SAT', '检验及 FAT/SAT'],
  ['installation_commissioning', 'Installation and Commissioning', '安装与调试'],
  ['acceptance_criteria', 'Acceptance Criteria', '验收标准'],
  ['technical_warranty', 'Technical Warranty', '技术保证']
].map(([key, labelEn, labelZh], index) => {
  const sectionType = sectionTypeByKey[key] || 'narrative';
  return Object.freeze({
    key,
    labelEn,
    labelZh,
    enabled: true,
    sortOrder: index + 1,
    sectionType,
    bodyEn: '',
    bodyZh: '',
    tableRowsEn: [],
    tableRowsZh: [],
    condition: { operator: 'always', variableKey: '', value: '' },
    defaultClauseIds: [],
    blocks: [],
    layout: defaultSectionLayout(sectionType)
  });
}));

export const DEFAULT_TECHNICAL_AGREEMENT_SCHEMA = Object.freeze({
  schemaVersion: 1,
  sections: TECHNICAL_AGREEMENT_STANDARD_SECTIONS
});

function standardSections(definitions) {
  return Object.freeze(definitions.map(([key, labelEn, labelZh, sectionType = 'narrative'], index) => Object.freeze({
    key,
    labelEn,
    labelZh,
    enabled: true,
    sortOrder: index + 1,
    sectionType,
    bodyEn: '',
    bodyZh: '',
    tableRowsEn: [],
    tableRowsZh: [],
    condition: { operator: 'always', variableKey: '', value: '' },
    defaultClauseIds: [],
    blocks: [],
    layout: defaultSectionLayout(sectionType)
  })));
}

export const DATASHEET_STANDARD_SECTIONS = standardSections([
  ['product_overview', 'Product Overview', '产品概述'],
  ['design_parameters', 'Design Parameters', '设计参数', 'parameter_table'],
  ['technical_parameters', 'Technical Parameters', '技术参数', 'parameter_table'],
  ['materials_of_construction', 'Materials of Construction', '设备材质', 'materials_table'],
  ['mechanical_configuration', 'Mechanical Configuration', '机械配置'],
  ['instrumentation_control', 'Instrumentation and Control', '仪表与控制', 'instrumentation_table'],
  ['electrical_requirements', 'Electrical Requirements', '电气要求', 'electrical_table'],
  ['utilities', 'Utilities', '公用工程', 'utilities_table'],
  ['documentation', 'Documentation', '文件资料']
]);

export const BIDDING_DOCUMENT_STANDARD_SECTIONS = standardSections([
  ['cover_and_parties', 'Cover and Bid Parties', '封面与投标双方'],
  ['project_basis', 'Project and Bidding Basis', '项目与投标依据'],
  ['technical_response', 'Technical Response', '技术响应'],
  ['process_description', 'Process Description', '工艺说明'],
  ['equipment_list', 'Equipment List', '设备清单', 'equipment_table'],
  ['design_parameters', 'Design Parameters', '设计参数', 'parameter_table'],
  ['performance_guarantees', 'Performance Guarantees', '性能保证'],
  ['scope_of_supply', 'Scope of Supply', '供货范围', 'scope_matrix'],
  ['materials_of_construction', 'Materials of Construction', '设备材质', 'materials_table'],
  ['instrumentation_control', 'Instrumentation and Control', '仪表与控制', 'instrumentation_table'],
  ['electrical_requirements', 'Electrical Requirements', '电气要求', 'electrical_table'],
  ['utilities', 'Utilities', '公用工程', 'utilities_table'],
  ['inspection_fat_sat', 'Inspection and FAT/SAT', '检验及 FAT/SAT'],
  ['documentation', 'Documentation', '文件资料'],
  ['delivery_and_services', 'Delivery and Services', '交付与服务'],
  ['interfaces_battery_limits', 'Interfaces and Battery Limits', '接口与界区', 'scope_matrix'],
  ['exclusions', 'Exclusions', '除外项'],
  ['deviation_list', 'Deviation List', '偏差表', 'parameter_table']
]);

export const TECHNICAL_DOCUMENT_DEFAULT_SCHEMAS = Object.freeze({
  datasheet: Object.freeze({ schemaVersion: 1, sections: DATASHEET_STANDARD_SECTIONS }),
  technical_agreement: DEFAULT_TECHNICAL_AGREEMENT_SCHEMA,
  bidding_document: Object.freeze({ schemaVersion: 1, sections: BIDDING_DOCUMENT_STANDARD_SECTIONS })
});

export function technicalTemplateRevisionLabel(revisionNo) {
  return `TPL-R${Number(revisionNo)}`;
}

export function technicalClauseRevisionLabel(code, revisionNo) {
  return `${code}-R${Number(revisionNo)}`;
}

export function opportunityTechnicalDraftLabel(draftRevisionNo) {
  return `TS-D${Number(draftRevisionNo)}`;
}
