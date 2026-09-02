import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  QuotationPackageValidationError,
  compareQuotationPackages,
  createQuotationPackageDraft,
  markQuotationPackageSent,
  acceptQuotationPackage,
  reviewQuotationPackage
} from '../../src/services/quotationPackageService.mjs';

const sales = { id: 7, roles: [ROLES.SALESPERSON] };
const commercialManager = { id: 9, roles: [ROLES.COMMERCIAL_MANAGER] };
const opportunity = {
  id: 20, salespersonId: 7, commercialManagerId: 9, status: 'customer_negotiation', teamMembers: []
};

function approvedContext() {
  return {
    technicalSolution: { id: 41, status: 'approved', versionNo: 2 },
    commercialQuote: {
      id: 31, status: 'approved', versionNo: 3, totalPrice: 120000,
      paymentTerms: '30/60/10', validityDate: '2026-12-31',
      items: [{ itemName: 'Mixer', specification: 'MX-100', unit: 'set', quantity: 1, unitPrice: 120000, subtotal: 120000 }]
    },
    technicalDocuments: [{ id: 61, originalName: 'TS-V2.pdf', mimeType: 'application/pdf', byteSize: 4, sha256: 'a'.repeat(64) }],
    commercialAttachments: [{ id: 71, originalName: 'quote.pdf', storedPath: 'quote.pdf', mimeType: 'application/pdf', byteSize: 4 }]
  };
}

function draft(overrides = {}) {
  return {
    id: 51, opportunityId: 20, sourcePackageId: null, draftRevisionNo: 1, versionNo: null,
    label: 'QP-D1', status: 'draft', technicalSolutionVersionId: 41, commercialQuoteId: 31,
    currency: 'USD', totalPrice: 120000, deliveryPeriod: '16 weeks', paymentTerms: '30/60/10',
    validUntil: '2026-12-31', commercialLineItems: [], inclusions: '', exclusions: '', technicalAssumptions: '',
    revisionReason: '', changeSummary: '', attachments: [], events: [], ...overrides
  };
}

test('sales owner creates a package from approved components and freezes attachment hashes', async () => {
  const calls = [];
  const repository = {
    async listByOpportunity() { return []; },
    async getCreationContext() { return approvedContext(); },
    async createDraft(input) { calls.push(['create', input]); return draft(input); },
    async addAttachmentSnapshot(input) { calls.push(['attachment', input]); return input; },
    async getPackageDetail() { return draft({ attachments: calls.filter(([kind]) => kind === 'attachment').map(([, value]) => value) }); }
  };
  const created = await createQuotationPackageDraft({
    quotationPackageRepository: repository,
    quotationPackageFileReader: async () => Buffer.from('test')
  }, sales, opportunity, {
    technicalSolutionVersionId: 41,
    commercialQuoteId: 31,
    currency: 'usd',
    deliveryPeriod: '16 weeks'
  });
  assert.equal(created.attachments.length, 2);
  assert.equal(calls[0][1].totalPrice, 120000);
  assert.deepEqual(calls[0][1].commercialLineItems, approvedContext().commercialQuote.items);
  assert.equal(calls[2][1].sha256, '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
});

test('a package cannot be built from unapproved component versions', async () => {
  const context = approvedContext();
  context.technicalSolution.status = 'pending';
  await assert.rejects(
    () => createQuotationPackageDraft({ quotationPackageRepository: { async listByOpportunity() { return []; }, async getCreationContext() { return context; } } }, sales, opportunity, {
      technicalSolutionVersionId: 41, commercialQuoteId: 31, currency: 'USD', deliveryPeriod: '16 weeks'
    }),
    (error) => error instanceof QuotationPackageValidationError && /Approved technical solution/.test(error.message)
  );
});

test('formal revision requires internal reason and customer-readable summary', async () => {
  const repository = {
    async listByOpportunity() { return [draft({ id: 50, status: 'sent', versionNo: 1, label: 'QP-V1' })]; },
    async getCreationContext() { return approvedContext(); },
    async getPackageDetail() { return draft({ id: 50, status: 'sent', versionNo: 1, label: 'QP-V1' }); }
  };
  await assert.rejects(
    () => createQuotationPackageDraft({ quotationPackageRepository: repository }, sales, opportunity, {
      sourcePackageId: 50, technicalSolutionVersionId: 41, commercialQuoteId: 31,
      currency: 'USD', deliveryPeriod: '16 weeks'
    }),
    /Revision reason and customer-readable change summary are required/
  );
});

test('only assigned commercial manager can approve a pending package', async () => {
  const repository = {
    async approvePending(input) { return draft({ status: 'approved', versionNo: 1, ...input }); }
  };
  const approved = await reviewQuotationPackage(
    repository, commercialManager, opportunity, draft({ status: 'pending' }), 'approve', 'approved'
  );
  assert.equal(approved.status, 'approved');
  await assert.rejects(
    () => reviewQuotationPackage(repository, sales, opportunity, draft({ status: 'pending' }), 'approve', ''),
    /Forbidden/
  );
});

test('package comparison includes commercial fields, component versions and attachment checksums', () => {
  const before = draft({ status: 'sent', versionNo: 1, technicalSolutionVersionNo: 1, commercialQuoteVersionNo: 2, attachments: [{ sourceType: 'commercial_quote_attachment', originalName: 'v1.pdf', sha256: 'a' }] });
  const after = draft({ sourcePackageId: 50, totalPrice: 125000, deliveryPeriod: '18 weeks', technicalSolutionVersionNo: 2, commercialQuoteVersionNo: 3, attachments: [{ sourceType: 'commercial_quote_attachment', originalName: 'v2.pdf', sha256: 'b' }] });
  const fields = compareQuotationPackages(after, before).map((change) => change.field);
  assert.deepEqual(fields, ['totalPrice', 'deliveryPeriod', 'technicalSolutionVersionNo', 'commercialQuoteVersionNo', 'attachments']);
});

test('only the sales owner can record sending and customer acceptance', async () => {
  const calls = [];
  const repository = {
    async markSent(input) { calls.push(['sent', input]); return draft({ status: 'sent', versionNo: 1 }); },
    async acceptSent(input) { calls.push(['accepted', input]); return draft({ status: 'accepted', versionNo: 1 }); }
  };
  const sent = await markQuotationPackageSent(
    repository, sales, opportunity, draft({ status: 'approved', versionNo: 1 }), 'mail archive'
  );
  const accepted = await acceptQuotationPackage(
    repository, sales, opportunity, { ...sent, status: 'sent' }, 'customer PO'
  );
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(calls.map(([name]) => name), ['sent', 'accepted']);
  await assert.rejects(
    () => markQuotationPackageSent(repository, commercialManager, opportunity, draft({ status: 'approved', versionNo: 1 }), ''),
    /Forbidden/
  );
});
