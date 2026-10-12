function item(number, type, standardWording = '') {
  return Object.freeze({ number, type, standardWording });
}

function group(catalog, number, key, termKey, title, items) {
  return Object.freeze({ catalog, number, key, termKey, title, language: 'en', items: Object.freeze(items) });
}

export const QUOTATION_TYPICAL_TERM_TEMPLATE_GROUPS = Object.freeze([
  group('price', 1, 'currency', null, 'Currency', [
    item(1, 'USD'), item(2, 'EUR'), item(3, 'CNY'), item(4, 'SGD'), item(5, 'GBP'), item(6, 'AUD'),
    item(7, 'Multi-Currency'), item(8, 'Fixed Currency'), item(9, 'Exchange Rate Adjustment'),
    item(10, 'Currency Conversion')
  ]),
  group('price', 2, 'price_basis_incoterms_2020', 'delivery', 'Price Basis – Incoterms® 2020', [
    item(11, 'EXW', "EXW Seller's Factory, [Location], Incoterms® 2020."),
    item(12, 'FCA', 'FCA [Named Place], Incoterms® 2020.'),
    item(13, 'FAS', 'FAS [Named Port of Shipment], Incoterms® 2020.'),
    item(14, 'FOB', 'FOB [Named Port of Shipment], Incoterms® 2020.'),
    item(15, 'CFR', 'CFR [Named Port of Destination], Incoterms® 2020.'),
    item(16, 'CIF', 'CIF [Named Port of Destination], Incoterms® 2020.'),
    item(17, 'CPT', 'CPT [Named Place of Destination], Incoterms® 2020.'),
    item(18, 'CIP', 'CIP [Named Place of Destination], Incoterms® 2020.'),
    item(19, 'DAP', 'DAP [Named Place of Destination], Incoterms® 2020.'),
    item(20, 'DPU', 'DPU [Named Place of Destination], Incoterms® 2020.'),
    item(21, 'DDP', 'DDP [Named Place of Destination], Incoterms® 2020.')
  ]),
  group('price', 3, 'price_structure', 'scope', 'Price Structure', [
    item(22, 'Fixed Price', 'The contract price is fixed and firm.'),
    item(23, 'Budgetary Price', 'Prices are preliminary and subject to final technical and commercial confirmation.'),
    item(24, 'Indicative Price', 'Prices are provided for reference purposes only and are non-binding.'),
    item(25, 'Lump Sum Price', 'The price is a fixed lump sum for the specified scope of supply.'),
    item(26, 'Unit Price', 'Prices are quoted on a per-unit basis.'),
    item(27, 'Itemized Price', 'Prices are quoted separately for each equipment item or service.'),
    item(28, 'Package Price', 'The price applies to the complete equipment package.'),
    item(29, 'Turnkey Price', 'The price covers the agreed turnkey scope of work.'),
    item(30, 'Price Escalation', 'Prices are subject to adjustment according to the agreed escalation formula.'),
    item(31, 'Provisional Price', 'The price is provisional and subject to final adjustment.'),
    item(32, 'Price Excluding Freight', 'Freight and transportation costs are excluded.'),
    item(33, 'Price Including Freight', 'Freight costs to the agreed destination are included.'),
    item(34, 'Installation Excluded', 'Installation and commissioning costs are excluded unless otherwise specified.'),
    item(35, 'Installation Included', 'Installation and commissioning are included as specified in the scope of supply.')
  ]),
  group('price', 4, 'tax_basis', 'price_tax', 'Tax Basis', [
    item(36, 'Tax Exclusive', 'All prices are exclusive of applicable taxes.'),
    item(37, 'Tax Inclusive', 'All prices are inclusive of applicable taxes as specified.'),
    item(38, 'VAT Exclusive', 'Prices exclude Value Added Tax (VAT).'),
    item(39, 'VAT Inclusive', 'Prices include VAT at the applicable statutory rate.'),
    item(40, 'GST Exclusive', 'Prices exclude Goods and Services Tax (GST).'),
    item(41, 'GST Inclusive', 'Prices include GST at the applicable statutory rate.'),
    item(42, 'Zero-Rated Export', 'Export sales are subject to zero-rated VAT/GST where legally applicable.'),
    item(43, 'Export Duties Excluded', 'Export duties and levies are excluded unless otherwise specified.'),
    item(44, 'Import Duties Excluded', 'Import duties, customs taxes and destination-country levies are excluded.'),
    item(45, 'Import Duties Included', 'Applicable import duties are included in the contract price.'),
    item(46, 'Withholding Tax', 'Any applicable withholding tax shall be treated in accordance with the contract and relevant tax laws.'),
    item(47, 'Withholding Tax Gross-Up', 'Payments shall be grossed up for withholding tax to the extent specified in the contract and permitted by law.'),
    item(48, 'Local Taxes', 'Local taxes, permits, duties and government charges are excluded unless expressly stated.'),
    item(49, 'Tax Adjustment', 'Changes in applicable tax rates shall be handled in accordance with the agreed contractual tax adjustment clause.'),
    item(50, 'Reverse Charge', 'VAT/GST shall be accounted for by the Buyer under the applicable reverse-charge mechanism, where required by law.')
  ]),
  group('price', 5, 'price_validity_adjustment', 'validity', 'Price Validity & Adjustment', [
    item(51, 'Validity 15 Days', 'This quotation is valid for fifteen (15) days from the quotation date.'),
    item(52, 'Validity 30 Days', 'This quotation is valid for thirty (30) days from the quotation date.'),
    item(53, 'Validity 60 Days', 'This quotation is valid for sixty (60) days from the quotation date.'),
    item(54, 'Validity 90 Days', 'This quotation is valid for ninety (90) days from the quotation date.'),
    item(55, 'Subject to Confirmation', 'Prices are subject to final confirmation upon order placement.'),
    item(56, 'Material Cost Adjustment', 'Prices may be adjusted based on agreed raw-material cost variations.'),
    item(57, 'Exchange Rate Variation', 'Prices may be adjusted if exchange rates exceed the agreed tolerance.'),
    item(58, 'Scope Change Adjustment', 'Any change in the agreed scope of supply may result in a price adjustment.'),
    item(59, 'Regulatory Change', 'Prices may be adjusted for qualifying changes in laws, duties or taxes.'),
    item(60, 'Freight Surcharge', 'Freight surcharges arising after quotation shall be treated as agreed in the contract.')
  ]),
  group('payment', 1, 'telegraphic_transfer', 'payment', 'T/T – Telegraphic Transfer', [
    item(1, '100% Advance', '100% T/T before production'),
    item(2, '100% Before Shipment', '100% T/T before shipment'),
    item(3, '10/90', '10% advance, 90% before shipment'), item(4, '20/80', '20% advance, 80% before shipment'),
    item(5, '30/70', '30% advance, 70% before shipment'), item(6, '40/60', '40% advance, 60% before shipment'),
    item(7, '50/50', '50% advance, 50% before shipment'), item(8, '60/40', '60% advance, 40% before shipment'),
    item(9, '70/30', '70% advance, 30% before shipment'),
    item(10, '30/60/10', '30% advance, 60% before shipment, 10% after delivery'),
    item(11, '40/50/10', '40% advance, 50% before shipment, 10% after commissioning'),
    item(12, '30/50/20', '30% advance, 50% before shipment, 20% after acceptance'),
    item(13, '20/70/10', '20% advance, 70% before shipment, 10% after acceptance'),
    item(14, '30/30/30/10', '30% advance, 30% after engineering approval, 30% before shipment, 10% after commissioning'),
    item(15, '20/30/40/10', '20% advance, 30% after engineering approval, 40% before shipment, 10% after acceptance')
  ]),
  group('payment', 2, 'letter_of_credit', 'payment', 'L/C – Letter of Credit', [
    item(16, 'L/C at Sight', '100% irrevocable L/C at sight'),
    item(17, 'Confirmed L/C', '100% irrevocable and confirmed L/C at sight'),
    item(18, 'L/C 30 Days', 'L/C payable 30 days after the agreed documentary trigger'),
    item(19, 'L/C 60 Days', 'L/C payable 60 days after the agreed documentary trigger'),
    item(20, 'L/C 90 Days', 'L/C payable 90 days after the agreed documentary trigger'),
    item(21, 'L/C 180 Days', 'L/C payable 180 days after the agreed documentary trigger'),
    item(22, 'Mixed T/T + L/C', '30% advance T/T, 70% L/C at sight'),
    item(23, 'Deferred Payment L/C', 'Payment under an irrevocable deferred payment L/C'),
    item(24, 'Revolving L/C', 'Payment under a revolving Letter of Credit'),
    item(25, 'SBLC Secured', 'Payment secured by a Standby Letter of Credit')
  ]),
  group('payment', 3, 'open_account_credit', 'payment', 'Open Account & Credit Terms', [
    item(26, 'Net 7', 'Payment within 7 days of invoice date'), item(27, 'Net 15', 'Payment within 15 days of invoice date'),
    item(28, 'Net 30', 'Payment within 30 days of invoice date'), item(29, 'Net 45', 'Payment within 45 days of invoice date'),
    item(30, 'Net 60', 'Payment within 60 days of invoice date'), item(31, 'Net 90', 'Payment within 90 days of invoice date'),
    item(32, 'COD', 'Cash on Delivery'), item(33, 'CAD', 'Cash Against Documents'),
    item(34, 'D/P at Sight', 'Documents against Payment at sight'),
    item(35, 'D/A 30 Days', 'Documents against Acceptance, payment after 30 days'),
    item(36, 'D/A 60 Days', 'Documents against Acceptance, payment after 60 days'),
    item(37, 'D/A 90 Days', 'Documents against Acceptance, payment after 90 days')
  ]),
  group('delivery', 1, 'standard_delivery_methods', 'packing', 'Standard Delivery Methods', [
    item(1, 'Sea Freight – FCL', 'Shipment by sea in Full Container Load (FCL).'),
    item(2, 'Sea Freight – LCL', 'Shipment by sea in Less than Container Load (LCL).'),
    item(3, 'Sea Freight – Breakbulk', 'Shipment by conventional breakbulk vessel.'),
    item(4, 'Sea Freight – Flat Rack', 'Shipment by flat rack container for oversized equipment.'),
    item(5, 'Sea Freight – Open Top', 'Shipment by open-top container.'),
    item(6, 'Sea Freight – Ro-Ro', 'Shipment by Roll-on/Roll-off vessel.'),
    item(7, 'Sea Freight – Heavy Lift', 'Shipment by specialized heavy-lift vessel.'),
    item(8, 'Sea Freight – Bulk Carrier', 'Shipment by bulk carrier where applicable.'),
    item(9, 'Air Freight', 'Shipment by international air cargo.'),
    item(10, 'Air Express / Courier', 'Delivery by international express courier.'),
    item(11, 'Road Freight – FTL', 'Delivery by Full Truck Load (FTL).'),
    item(12, 'Road Freight – LTL', 'Delivery by Less than Truck Load (LTL).'),
    item(13, 'Road Freight – Oversized', 'Delivery by specialized heavy-haul or oversized cargo transport.'),
    item(14, 'Rail Freight', 'Shipment by railway cargo service.'),
    item(15, 'Multimodal Transport', 'Shipment using two or more transportation modes.'),
    item(16, 'Sea–Road Combined', 'Combined sea freight and inland road transport.'),
    item(17, 'Rail–Road Combined', 'Combined railway and road transport.'),
    item(18, 'Air–Road Combined', 'Combined air freight and local road delivery.'),
    item(19, 'Inland Waterway', 'Shipment by barge or inland vessel.')
  ]),
  group('delivery', 2, 'delivery_period_start', 'delivery_period', 'Delivery Period & Start', [
    item(
      1,
      'After Advance Payment and Technical Approval',
      'Delivery shall be made within [Delivery Period] after receipt of the advance payment and approval of the technical documents.'
    ),
    item(
      2,
      'After Contract Effectiveness',
      'Delivery shall be made within [Delivery Period] after the contract becomes effective.'
    ),
    item(
      3,
      'After Purchase Order',
      'Delivery shall be made within [Delivery Period] after receipt of the purchase order.'
    ),
    item(
      4,
      'After Final Drawing Approval',
      'Delivery shall be made within [Delivery Period] after approval of the final drawings.'
    )
  ]),
  group('warranty', 1, 'warranty_period', 'warranty', 'Warranty Period', [
    item(
      1,
      '12 Months from Commissioning / 18 Months from Shipment',
      'The warranty period shall be twelve (12) months from the date of commissioning or eighteen (18) months from the date of shipment, whichever occurs first.'
    )
  ])
]);

export const QUOTATION_CURRENCY_OPTIONS = Object.freeze(['USD', 'EUR', 'CNY', 'SGD', 'GBP', 'AUD']);

function templateId(templateGroup, templateItem) {
  return `builtin:${templateGroup.catalog}:${templateGroup.key}:${templateItem.number}`;
}

const TEMPLATE_BY_ID = new Map(QUOTATION_TYPICAL_TERM_TEMPLATE_GROUPS.flatMap((templateGroup) =>
  templateGroup.items.map((templateItem) => {
    const template = Object.freeze({
      ...templateItem, id: templateId(templateGroup, templateItem), catalog: templateGroup.catalog,
      groupKey: templateGroup.key, groupTitle: templateGroup.title, termKey: templateGroup.termKey,
      language: templateGroup.language
    });
    return [template.id, template];
  })
));

export const BUILT_IN_QUOTATION_TYPICAL_TERMS = Object.freeze([...TEMPLATE_BY_ID.values()]
  .filter((template) => template.termKey && template.standardWording)
  .map((template) => Object.freeze({
    id: template.id, key: template.termKey, language: template.language, revisionNo: 1,
    title: template.type, body: template.standardWording, builtIn: true,
    groupTitle: template.groupTitle, status: 'published'
  })));

export function withBuiltInQuotationTypicalTerms(terms, language) {
  const custom = Array.isArray(terms) ? terms : [];
  return language === 'en' ? [...BUILT_IN_QUOTATION_TYPICAL_TERMS, ...custom] : custom;
}

export function findQuotationTypicalTermTemplate(id) {
  return TEMPLATE_BY_ID.get(String(id || '')) || null;
}
