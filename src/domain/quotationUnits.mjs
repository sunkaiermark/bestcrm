export const QUOTATION_UNIT_OPTIONS = Object.freeze([
  { value: 'set', zh: '套', en: 'set' },
  { value: 'each', zh: '个', en: 'each' },
  { value: 'unit', zh: '台', en: 'unit' },
  { value: 'pc', zh: '件', en: 'pc' },
  { value: 'lot', zh: '批', en: 'lot' },
  { value: 'kg', zh: '千克', en: 'kg' },
  { value: 't', zh: '吨', en: 't' },
  { value: 'm', zh: '米', en: 'm' },
  { value: 'm²', zh: '平方米', en: 'm²' },
  { value: 'm³', zh: '立方米', en: 'm³' },
  { value: 'L', zh: '升', en: 'L' },
  { value: 'ls', zh: '项', en: 'ls' },
  { value: 'kw', zh: '千瓦', en: 'kw' },
  { value: 'h', zh: '小时', en: 'h' },
  { value: 'day', zh: '天', en: 'day' },
  { value: 'month', zh: '月', en: 'month' }
]);

export const QUOTATION_UNIT_VALUES = new Set(QUOTATION_UNIT_OPTIONS.map((option) => option.value));
