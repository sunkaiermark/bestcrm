export const QUOTATION_SELLER_EMAIL = 'sales@sunkaier.com';

export const QUOTATION_SELLER_ENTITIES = Object.freeze([
  Object.freeze({ code: 'sunkaier_china', legalName: '江苏胜开尔工业技术有限公司' }),
  Object.freeze({ code: 'sunkaier_apac', legalName: 'SUNKAIER ASIA PACIFIC PTE. LTD.' })
]);

export function getQuotationSellerEntity(code) {
  return QUOTATION_SELLER_ENTITIES.find((entity) => entity.code === code) || null;
}
