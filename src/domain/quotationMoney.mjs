export function scaledDecimal(value, fractionalDigits, maxWholeDigits = 20) {
  const raw = String(value ?? '').trim();
  const expression = new RegExp(`^(?:0|[1-9]\\d{0,${maxWholeDigits - 1}})(?:\\.\\d{1,${fractionalDigits}})?$`);
  if (!expression.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 10n ** BigInt(fractionalDigits)
    + BigInt(fraction.padEnd(fractionalDigits, '0') || '0');
}

export function quotationLineAmountCents(row) {
  const quantity = scaledDecimal(row?.quantity, 4, 10);
  const unitPrice = scaledDecimal(row?.unitPrice, 2, 12);
  if (quantity === null || unitPrice === null) return null;
  return (quantity * unitPrice + 5000n) / 10000n;
}

export function quotationTaxRateBasisPoints(value) {
  return scaledDecimal(value ?? '0', 2, 3);
}

// Drafts now include every retained row. Keep the inclusion flag on frozen
// historical versions so their original totals remain reproducible.
export function includeAllQuotationDraftLines(lineItems) {
  return (lineItems || []).map((item) => ({ ...item, includeInTotal: 'included' }));
}

export function calculateQuotationTotals(lineItems, taxRate) {
  let subtotalCents = 0n;
  for (const item of lineItems || []) {
    if (item.includeInTotal !== 'included') continue;
    const amount = quotationLineAmountCents(item);
    if (amount === null) return null;
    subtotalCents += amount;
  }
  const rateBasisPoints = quotationTaxRateBasisPoints(taxRate);
  if (rateBasisPoints === null || rateBasisPoints < 0n || rateBasisPoints > 10000n) return null;
  const taxCents = (subtotalCents * rateBasisPoints + 5000n) / 10000n;
  return { subtotalCents, rateBasisPoints, taxCents, totalCents: subtotalCents + taxCents };
}

export function formatQuotationMoney(cents) {
  if (typeof cents !== 'bigint') return '—';
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export function quotationTotalsSnapshot(lineItems, taxRate) {
  const totals = calculateQuotationTotals(lineItems, taxRate);
  if (!totals) return null;
  return {
    subtotal: formatQuotationMoney(totals.subtotalCents).replace(/,/g, ''),
    taxRate: (Number(totals.rateBasisPoints) / 100).toFixed(2),
    taxAmount: formatQuotationMoney(totals.taxCents).replace(/,/g, ''),
    total: formatQuotationMoney(totals.totalCents).replace(/,/g, '')
  };
}
