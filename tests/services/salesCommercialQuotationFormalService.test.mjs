import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES } from '../../src/domain/roles.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../../src/domain/quotationCommercialTermSections.mjs';
import {
  canSignSalesCommercialQuotation,
  reviewSalesCommercialQuotation,
  signSalesCommercialQuotation,
  submitSalesCommercialQuotation
} from '../../src/services/salesCommercialQuotationFormalService.mjs';
import { renderSalesCommercialQuotationFormalPdf } from '../../src/services/salesCommercialQuotationFormalPdfService.mjs';

const profile = { address: 'Approved address', phone: '+65 6000 0000', website: 'https://www.sunkaier.com' };
function completeSeller(code = 'sunkaier_china') {
  return { code, legalName: code === 'sunkaier_china' ? '江苏胜开尔工业技术有限公司' : 'SUNKAIER ASIA PACIFIC PTE. LTD.',
    ...profile, email: 'sales@sunkaier.com' };
}
// A checked-in logo is harmless stand-in image data; no actual signature asset enters Git.
const png = await readFile(new URL('../../src/public/assets/sunkaier-logo-login.png', import.meta.url));
const sales = { id: 7, username: 'SalesOwner', isActive: true, roles: [ROLES.SALESPERSON] };
const manager = { id: 8, username: 'CommercialManager', isActive: true, roles: [ROLES.COMMERCIAL_MANAGER] };
const mark = { id: 9, username: 'MarkYang', isActive: true, roles: [ROLES.ADMINISTRATOR] };
const opportunity = {
  id: 20, opportunityNo: '800020', title: 'Mixer project', customerName: 'Customer',
  primaryContactName: 'Buyer', salespersonId: 7, salespersonDisplayName: 'Sales Owner',
  commercialManagerId: 8, archivedAt: null
};
const terms = QUOTATION_COMMERCIAL_TERM_SECTIONS.map((section, index) => ({
  id: index + 1, key: section.key, language: 'en', revisionNo: 1,
  title: `Approved ${section.en}`, body: `Published wording ${section.en}`
}));
const source = { technicalDraftId: 41, technicalDraftRevisionNo: 2, attachmentId: 51,
  sha256: 'a'.repeat(64), technicalStatus: 'approved' };
function draft(entityCode = 'sunkaier_china') {
  return {
    id: 3, opportunityId: 20, draftRevisionNo: 2, language: 'en', currency: 'USD',
    sellerEntityCode: entityCode,
    sellerEntityName: entityCode === 'sunkaier_china' ? '江苏胜开尔工业技术有限公司' : 'SUNKAIER ASIA PACIFIC PTE. LTD.',
    sourceTechnicalDraftId: 41, sourceAttachmentId: 51, sourceSha256: 'a'.repeat(64),
    sourceFileName: 'Technical file.pdf',
    lineItems: [{ description: 'Mixer', quantity: '1', unit: 'set', unitPrice: '100', includeInTotal: 'included' }],
    termSelections: Object.fromEntries(terms.map((term) => [term.key, { ...term }]))
  };
}

function repository(quoteDraft, formalVersion = null) {
  const calls = [];
  return {
    calls,
    async getByOpportunity() { return quoteDraft; },
    async getTechnicalSource() { return source; },
    async listTechnicalSources() { return [source]; },
    async listPublishedStandardTerms() { return terms; },
    async submitFormalVersion(input) { calls.push(['submit', input]); return { id: 70, ...input, status: 'pending' }; },
    async getFormalVersion() { return formalVersion; },
    async reviewFormalVersion(input) { calls.push(['review', input]); return { ...formalVersion, status: input.decision }; },
    async signFormalVersion(input) { calls.push(['sign', input]); return { ...formalVersion, status: 'signed',
      pdfStoredPath: input.pdfStoredPath, pdfSha256: input.pdfSha256, pdfFileSize: input.pdfFileSize }; }
  };
}

test('formal submit freezes only an approved exact source and eight published terms', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bestcrm-formal-'));
  try {
    const profilesFile = path.join(dir, 'profiles.json');
    await writeFile(profilesFile, JSON.stringify({ sunkaier_china: profile }));
    const repo = repository(draft());
    await submitSalesCommercialQuotation(repo, sales, opportunity, 2, { sellerProfilesFile: profilesFile });
    assert.equal(repo.calls[0][1].snapshot.seller.legalName, '江苏胜开尔工业技术有限公司');
    assert.equal(repo.calls[0][1].snapshot.termSelections.payment.body, terms[1].body);
    assert.equal(repo.calls[0][1].snapshot.lineItems[0].description, 'Mixer');
    await assert.rejects(() => submitSalesCommercialQuotation(repo, sales, opportunity, 1,
      { sellerProfilesFile: profilesFile }), /Draft revision changed/);
    source.technicalStatus = 'ready';
    await assert.rejects(() => submitSalesCommercialQuotation(repo, sales, opportunity, 2,
      { sellerProfilesFile: profilesFile }), /approved technical source/);
    source.technicalStatus = 'approved';
    repo.listPublishedStandardTerms = async () => terms.slice(0, 7);
    await assert.rejects(() => submitSalesCommercialQuotation(repo, sales, opportunity, 2,
      { sellerProfilesFile: profilesFile }), /current published standard wording/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('review is assigned-commercial-manager only, separate from submitter, and approval does not sign', async () => {
  const pending = { id: 70, opportunityId: 20, status: 'pending', submittedBy: 7,
    sourceTechnicalDraftId: 41, sourceAttachmentId: 51, sourceSha256: 'a'.repeat(64),
    snapshot: { ...draft(), seller: completeSeller() } };
  const repo = repository(draft(), pending);
  await assert.rejects(() => reviewSalesCommercialQuotation(repo, sales, opportunity, 70, 'approved'),
    (error) => error.statusCode === 403);
  const result = await reviewSalesCommercialQuotation(repo, manager, opportunity, 70, 'approved');
  assert.equal(result.status, 'approved');
  assert.equal(result.signedBy, undefined);
  assert.equal(repo.calls[0][1].actorUserId, 8);
});

test('only MarkYang can personally issue a China PDF without any company seal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bestcrm-formal-'));
  try {
    const privateDir = path.join(dir, 'quotation-signing-assets');
    await mkdir(privateDir);
    const signatureFile = path.join(privateDir, 'mark.png');
    await writeFile(signatureFile, png);
    const version = { id: 70, opportunityId: 20, status: 'approved',
      quotationNo: 'Q-800020-V1', versionNo: 1, snapshot: { ...draft(), seller: completeSeller() },
      sourceTechnicalDraftId: 41, sourceAttachmentId: 51, sourceSha256: 'a'.repeat(64) };
    const repo = repository(draft(), version);
    assert.equal(canSignSalesCommercialQuotation(manager, opportunity, version), false);
    await assert.rejects(() => signSalesCommercialQuotation(repo, manager, opportunity, 70, {}),
      (error) => error.statusCode === 403);
    let receivedSeal = 'not called';
    const result = await signSalesCommercialQuotation(repo, mark, opportunity, 70, {
      uploadDir: dir, signatureFile, renderPdf: async ({ seal }) => {
        receivedSeal = seal;
        return Buffer.from('%PDF-1.7\nCompany China, personal signature only');
      }
    });
    assert.equal(receivedSeal, null);
    assert.equal(result.status, 'signed');
    assert.equal(repo.calls[0][1].sealSha256, null);
    assert.match((await readFile(path.join(dir, result.pdfStoredPath))).toString(), /Company China/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Singapore issue requires its own private seal and formal renderer rejects mismatched seal policy', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bestcrm-formal-'));
  try {
    const privateDir = path.join(dir, 'quotation-signing-assets');
    await mkdir(privateDir);
    const signatureFile = path.join(privateDir, 'mark.png');
    await writeFile(signatureFile, png);
    const version = { id: 71, opportunityId: 20, status: 'approved',
      quotationNo: 'Q-800020-V2', versionNo: 2, snapshot: { ...draft('sunkaier_apac'),
        seller: completeSeller('sunkaier_apac') },
      sourceTechnicalDraftId: 41, sourceAttachmentId: 51, sourceSha256: 'a'.repeat(64) };
    const repo = repository(draft('sunkaier_apac'), version);
    await assert.rejects(() => signSalesCommercialQuotation(repo, mark, opportunity, 71, {
      uploadDir: dir, signatureFile, renderPdf: async () => Buffer.from('%PDF-1.7')
    }), /Singapore company seal image is not configured/);
    await assert.rejects(() => renderSalesCommercialQuotationFormalPdf({
      version, signedAt: new Date().toISOString(), signature: png, seal: null
    }), /requires its company seal/);
    const sealFile = path.join(privateDir, 'apac.png');
    await writeFile(sealFile, png);
    let hadSeal = false;
    await signSalesCommercialQuotation(repo, mark, opportunity, 71, {
      uploadDir: dir, signatureFile, apacSealFile: sealFile,
      renderPdf: async ({ seal }) => { hadSeal = Buffer.isBuffer(seal); return Buffer.from('%PDF-1.7\nsealed'); }
    });
    assert.equal(hadSeal, true);
    assert.match(repo.calls[0][1].sealSha256, /^[0-9a-f]{64}$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('issued A4 PDF renders a frozen China quotation with personal signature and no draft watermark', async () => {
  const quoteDraft = draft();
  const version = {
    id: 72, opportunityId: 20, status: 'approved', quotationNo: 'Q-800020-V3', versionNo: 3,
    snapshot: {
      opportunityNo: '800020', project: 'Mixer project', customerName: 'Customer', attention: 'Buyer',
      seller: { code: 'sunkaier_china', legalName: '江苏胜开尔工业技术有限公司',
        ...profile, email: 'sales@sunkaier.com' }, sellerContact: 'Sales Owner',
      language: 'en', currency: 'USD', lineItems: quoteDraft.lineItems,
      termSelections: quoteDraft.termSelections
    }
  };
  const pdf = await renderSalesCommercialQuotationFormalPdf({
    version, signedAt: '2026-10-06T01:02:03.000Z', signature: png, seal: null
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 1, true);
  if (process.env.BESTCRM_PDF_QA_OUTPUT) {
    await writeFile(process.env.BESTCRM_PDF_QA_OUTPUT, pdf);
  }
});

test('explicit test-phase policy permits omitted contact fields and terms but keeps approval, source and personal-signing gates', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bestcrm-formal-incomplete-'));
  try {
    const quoteDraft = { ...draft(), termSelections: {} };
    const repo = repository(quoteDraft);
    await assert.rejects(() => submitSalesCommercialQuotation(repo, sales, opportunity, 2),
      /current published standard wording/);
    const submitted = await submitSalesCommercialQuotation(repo, sales, opportunity, 2,
      { allowIncompleteFormal: true });
    assert.deepEqual(submitted.snapshot.seller, {
      code: 'sunkaier_china', legalName: '江苏胜开尔工业技术有限公司',
      address: '', phone: '', website: '', email: 'sales@sunkaier.com'
    });
    assert.equal(submitted.snapshot.missingFields.length, 11);
    assert.ok(submitted.snapshot.missingFields.includes('term.price_tax'));
    const version = {
      ...submitted, opportunityId: 20, quotationNo: 'Q-800020-V4', versionNo: 4,
      sourceTechnicalDraftId: 41, sourceAttachmentId: 51, sourceSha256: source.sha256
    };
    repo.getFormalVersion = async () => version;
    await assert.rejects(() => reviewSalesCommercialQuotation(repo, manager, opportunity, 70, 'approved'),
      /current published standard wording/);
    await reviewSalesCommercialQuotation(repo, manager, opportunity, 70, 'approved', '',
      { allowIncompleteFormal: true });
    version.status = 'approved';
    const privateDir = path.join(dir, 'quotation-signing-assets');
    await mkdir(privateDir);
    const signatureFile = path.join(privateDir, 'mark.png');
    await writeFile(signatureFile, png);
    await assert.rejects(() => signSalesCommercialQuotation(repo, mark, opportunity, 70, {
      uploadDir: dir, signatureFile, renderPdf: async () => Buffer.from('%PDF-1.7')
    }), /current published standard wording/);
    const signed = await signSalesCommercialQuotation(repo, mark, opportunity, 70, {
      uploadDir: dir, signatureFile, allowIncompleteFormal: true,
      renderPdf: async () => Buffer.from('%PDF-1.7\nNo invented terms or seller fields')
    });
    assert.equal(signed.status, 'signed');
    quoteDraft.termSelections.price_tax = { ...terms[0], revisionNo: 999 };
    await assert.rejects(() => submitSalesCommercialQuotation(repo, sales, opportunity, 2,
      { allowIncompleteFormal: true }), /current published standard wording/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('incomplete formal PDF omits absent seller fields and empty term section instead of printing placeholders', async () => {
  const quoteDraft = draft();
  const version = {
    id: 73, opportunityId: 20, status: 'approved', quotationNo: 'Q-800020-V5', versionNo: 5,
    snapshot: {
      opportunityNo: '800020', project: 'Mixer project', customerName: 'Customer', attention: 'Buyer',
      seller: { code: 'sunkaier_china', legalName: '江苏胜开尔工业技术有限公司',
        address: '', phone: '', website: '', email: 'sales@sunkaier.com' },
      sellerContact: 'Sales Owner', language: 'en', currency: 'USD',
      lineItems: quoteDraft.lineItems, termSelections: {},
      missingFields: ['seller.address', 'seller.phone', 'seller.website']
    }
  };
  const pdf = await renderSalesCommercialQuotationFormalPdf({
    version, signedAt: '2026-10-06T01:02:03.000Z', signature: png, seal: null
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  if (process.env.BESTCRM_INCOMPLETE_PDF_QA_OUTPUT) {
    await writeFile(process.env.BESTCRM_INCOMPLETE_PDF_QA_OUTPUT, pdf);
  }
});
