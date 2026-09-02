export const TECHNICAL_TEMPLATE_LANGUAGES = Object.freeze(['en', 'zh', 'bilingual']);

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
].map(([key, labelEn, labelZh], index) => Object.freeze({
  key,
  labelEn,
  labelZh,
  enabled: true,
  sortOrder: index + 1,
  blocks: []
})));

export const DEFAULT_TECHNICAL_AGREEMENT_SCHEMA = Object.freeze({
  schemaVersion: 1,
  sections: TECHNICAL_AGREEMENT_STANDARD_SECTIONS
});

export function technicalTemplateRevisionLabel(revisionNo) {
  return `TPL-R${Number(revisionNo)}`;
}

export function technicalClauseRevisionLabel(code, revisionNo) {
  return `${code}-R${Number(revisionNo)}`;
}
