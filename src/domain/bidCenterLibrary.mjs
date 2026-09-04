import { ROLES } from './roles.mjs';

export const BID_LIBRARY_TYPES = Object.freeze({
  STANDARD_CLAUSE: 'standard_clause',
  PUBLIC_MATERIAL: 'public_material'
});

export const BID_LIBRARY_TYPE_VALUES = Object.freeze(Object.values(BID_LIBRARY_TYPES));

export const BID_CONTENT_COMPONENT_TYPES = Object.freeze([
  'narrative',
  'parameter_table',
  'equipment_table',
  'materials_table',
  'instrumentation_table',
  'electrical_table',
  'utilities_table',
  'scope_matrix',
  'quotation_table',
  'deviation_table',
  'image',
  'controlled_attachment',
  'page_break',
  'toc_control'
]);

export const BID_CONTENT_SENSITIVITIES = Object.freeze([
  'public',
  'internal',
  'confidential',
  'restricted'
]);

export const BID_TEMPLATE_LANGUAGES = Object.freeze(['en', 'zh', 'bilingual']);

export const BID_CONTENT_OWNER_ROLES = Object.freeze([
  ROLES.TECHNICAL_MANAGER,
  ROLES.COMMERCIAL_MANAGER
]);

export const DEFAULT_COMMERCIAL_PACKAGE_SCHEMA = Object.freeze({
  schemaVersion: 1,
  sections: Object.freeze([
    ['commercial_cover', 'Commercial Cover and Contents', '商务封面和目录', 'narrative'],
    ['bid_or_quotation_letter', 'Bid or Quotation Letter', '投标函或报价函', 'narrative'],
    ['bidder_information', 'Bidder Information', '投标人基本信息', 'narrative'],
    ['company_profile', 'Company Profile and Organization', '公司简介和组织结构', 'narrative'],
    ['qualifications', 'Licences, Certificates and Qualifications', '营业执照、体系证书和资质', 'controlled_attachment'],
    ['references', 'Project References', '类似项目业绩和客户参考', 'narrative'],
    ['commercial_response', 'Commercial Response and Deviations', '商务响应和偏差', 'deviation_table'],
    ['pricing', 'Price Summary and Breakdown', '报价总表和分项报价', 'quotation_table'],
    ['currency_and_tax', 'Currency, Taxes and Price Basis', '币种、税费和价格基础', 'narrative'],
    ['payment_terms', 'Payment Terms', '付款条件', 'narrative'],
    ['delivery_terms', 'Delivery Schedule, Place and Incoterms', '交货周期、地点和贸易条款', 'narrative'],
    ['packing_transport_insurance', 'Packing, Transport and Insurance', '包装、运输和保险', 'narrative'],
    ['validity', 'Quotation Validity', '报价有效期', 'narrative'],
    ['warranty_service', 'Warranty and After-sales Service', '质保和售后服务', 'narrative'],
    ['spares_and_services', 'Spare Parts and Service Prices', '备件和服务价格', 'quotation_table'],
    ['performance_security', 'Performance Security and Liability', '履约保证和违约责任', 'narrative'],
    ['contract_deviations', 'Contract Response and Legal Deviations', '合同响应和法律偏差', 'deviation_table'],
    ['confidentiality_ip_compliance', 'Confidentiality, IP and Compliance', '保密、知识产权和合规', 'narrative'],
    ['signature', 'Signature and Company Seal', '签字盖章页', 'narrative'],
    ['commercial_attachments', 'Commercial Attachments', '商务附件', 'controlled_attachment']
  ].map(([key, labelEn, labelZh, sectionType], index) => Object.freeze({
    key,
    labelEn,
    labelZh,
    sectionType,
    enabled: true,
    sortOrder: index + 1,
    bodyEn: '',
    bodyZh: '',
    tableRows: [],
    contentBlockIds: []
  })))
});

export function contentRevisionLabel(blockCode, revisionNo) {
  const number = Number(revisionNo);
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('Content revision number must be a positive integer');
  }
  return `${blockCode}-R${number}`;
}
