export const DEFAULT_REPRESENTED_COMPANY_CODE = 'sunkaier_apac';

export const REPRESENTED_COMPANIES = Object.freeze([
  Object.freeze({
    code: 'sunkaier_apac',
    name: 'SUNKAIER Asia Pacific Pte. Ltd.',
    emailSignatureAddress: '2 Venture Drive, #10-30, Vision Exchange, Singapore 608526',
    website: 'https://www.sunkaier.com'
  }),
  Object.freeze({
    code: 'sunkaier_china',
    name: 'JIANGSU SUNKAIER INDUSTRIAL TECHNOLOGY CO., LTD',
    emailSignatureAddress: 'Yixing, Jiangsu Province, China',
    website: 'https://www.sunkaier.com'
  })
]);

export function getRepresentedCompany(code) {
  return REPRESENTED_COMPANIES.find((company) => company.code === code) || null;
}
