import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { isProjectLeadEngineer } from './opportunityService.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';
import {
  BID_DOCUMENT_GENERATOR_VERSION,
  buildBidDocumentSpec,
  createBidDocumentRenderer
} from './bidDocumentRenderer.mjs';
import { createCommercialDocumentService } from './commercialDocumentService.mjs';
import { createTechnicalDocumentService } from './technicalDocumentService.mjs';

const OUTPUT_TYPES = Object.freeze([
  'technical_docx', 'technical_pdf', 'commercial_docx', 'commercial_pdf',
  'complete_docx', 'complete_pdf', 'attachments_zip', 'manifest_json'
]);
const COMMERCIAL_OUTPUT_TYPES = new Set([
  'commercial_docx', 'commercial_pdf', 'complete_docx', 'complete_pdf',
  'attachments_zip', 'manifest_json'
]);
const ZIP_DATE = new Date('2000-01-01T00:00:00.000Z');

function fail(message, statusCode = 400, code = BID_CENTER_ERROR_CODES.VALIDATION) {
  throw new BidCenterServiceError(message, { statusCode, code });
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`${field} is invalid`);
  return number;
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function stableValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { byteSize: value.length, sha256: checksum(value) };
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function snapshotHash(value) {
  return checksum(Buffer.from(stableJson(value), 'utf8'));
}

function safeName(value, fallback = 'attachment') {
  const name = String(value || '').replace(/[\\/:*?"<>|\x00-\x1F]+/g, '-').replace(/^\.+|\.+$/g, '').trim();
  return name || fallback;
}

function compactDate(value) {
  const date = new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date('2000-01-01T00:00:00.000Z') : date)
    .toISOString().slice(0, 10).replaceAll('-', '');
}

function visibleUserId(actor) {
  return hasRole(actor, ROLES.ADMINISTRATOR) ? null : positiveInteger(actor.id, 'User');
}

function commercialViewer(actor, opportunity) {
  if (hasRole(actor, ROLES.ADMINISTRATOR)) return true;
  const actorId = Number(actor.id);
  return (hasRole(actor, ROLES.SALESPERSON) && Number(opportunity.salespersonId) === actorId)
    || (hasRole(actor, ROLES.SALES_MANAGER) && Number(opportunity.salesManagerId) === actorId)
    || (hasRole(actor, ROLES.QUOTATION_ENGINEER) && Number(opportunity.quotationEngineerId) === actorId)
    || (hasRole(actor, ROLES.COMMERCIAL_MANAGER) && Number(opportunity.commercialManagerId) === actorId)
    || [ROLES.LEGAL_REVIEWER, ROLES.FINANCE_REVIEWER, ROLES.GENERAL_MANAGER]
      .some((role) => hasRole(actor, role));
}

function ensureApprovedSource(source, label) {
  if (!source || source.status !== 'approved' || !Number.isInteger(Number(source.formalVersionNo))) {
    fail(`${label} must be an approved frozen version`, 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
}

function ensureNoPlaceholders(value) {
  if (/\{\{[^{}]+\}\}|<<[^<>]+>>/.test(JSON.stringify(value))) {
    fail('Frozen package contains unresolved placeholders', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
}

function frozenDraftSnapshot(source) {
  return {
    id: source.id,
    formalVersionNo: source.formalVersionNo,
    language: source.language,
    templateRevisionId: source.templateRevisionId,
    templateCodeSnapshot: source.templateCodeSnapshot,
    templateNameSnapshot: source.templateNameSnapshot,
    templateRevisionNoSnapshot: source.templateRevisionNoSnapshot,
    contentSchemaSnapshot: source.contentSchemaSnapshot,
    variableSchemaSnapshot: source.variableSchemaSnapshot,
    variableValues: source.variableValues,
    selectedClauses: source.selectedClauses,
    renderedContent: source.renderedContent,
    sourceMetadata: source.sourceMetadata,
    submittedBy: source.submittedBy,
    submittedAt: source.submittedAt,
    reviewedBy: source.reviewedBy,
    reviewedAt: source.reviewedAt,
    reviewComment: source.reviewComment
  };
}

function frozenPackageSnapshot(source) {
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    opportunityId: source.opportunityId,
    versionNo: source.versionNo,
    technicalSolutionVersionId: source.technicalSolutionVersionId,
    commercialDraftId: source.commercialDraftId,
    commercialQuoteId: source.commercialQuoteId,
    currency: source.currency,
    totalPrice: source.totalPrice,
    deliveryPeriod: source.deliveryPeriod,
    paymentTerms: source.paymentTerms,
    validUntil: source.validUntil,
    commercialLineItems: source.commercialLineItems,
    inclusions: source.inclusions,
    exclusions: source.exclusions,
    technicalAssumptions: source.technicalAssumptions,
    revisionReason: source.revisionReason,
    changeSummary: source.changeSummary,
    submittedBy: source.submittedBy,
    submittedAt: source.submittedAt,
    reviewedBy: source.reviewedBy,
    reviewedAt: source.reviewedAt,
    reviewComment: source.reviewComment
  };
}

function outputProfileSnapshot(workspace) {
  const snapshot = workspace.sourceMetadata?.outputProfile;
  if (!snapshot
      || Number(snapshot.id) !== Number(workspace.outputProfileId)
      || Number(snapshot.revisionNo) !== Number(workspace.outputProfile.revisionNo)) {
    fail('Frozen output profile does not match the workspace', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  return snapshot;
}

async function materializeAttachment(raw, sourceLabel, archiveName, fileLoader) {
  if (!raw.storedPath) fail(`Attachment ${raw.originalName} has no stored file`, 409, BID_CENTER_ERROR_CODES.CONFLICT);
  const content = await fileLoader(raw.storedPath);
  if (!Buffer.isBuffer(content)) fail(`Attachment ${raw.originalName} could not be read`, 409, BID_CENTER_ERROR_CODES.CONFLICT);
  const actualHash = checksum(content);
  if (Number(raw.byteSize) !== content.length || raw.sha256 !== actualHash) {
    fail(`Attachment ${raw.originalName} failed its integrity check`, 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  const mimeType = raw.mimeType || 'application/octet-stream';
  return {
    ...raw,
    sourceLabel,
    archiveName,
    content,
    mimeType,
    byteSize: content.length,
    sha256: actualHash,
    inlineImage: ['image/png', 'image/jpeg'].includes(mimeType)
  };
}

async function loadAttachments(dependencies, workspace, technicalDraft, commercialDraft, fileLoader) {
  const [technical, commercial] = await Promise.all([
    dependencies.bidPackageEditorRepository.listAttachments({
      workspaceId: workspace.id, packageType: 'technical', technicalDraftId: technicalDraft.id
    }),
    dependencies.bidPackageEditorRepository.listAttachments({
      workspaceId: workspace.id, packageType: 'commercial', commercialDraftId: commercialDraft.id
    })
  ]);
  const work = [];
  for (const item of technical.filter((attachment) => !attachment.removedAt)) {
    work.push(materializeAttachment(
      item, 'Technical package / 技术包',
      `Technical/${item.id}-${safeName(item.originalName)}`, fileLoader
    ));
  }
  for (const item of commercial.filter((attachment) => !attachment.removedAt)) {
    work.push(materializeAttachment(
      item, 'Commercial package / 商务包',
      `Commercial/${item.id}-${safeName(item.originalName)}`, fileLoader
    ));
  }
  for (const snapshot of commercialDraft.sourceMetadata?.contentComponentSnapshots || []) {
    if (!snapshot.attachmentSha256) continue;
    work.push(materializeAttachment({
      id: snapshot.revisionId,
      sectionKey: snapshot.applicableSections?.[0] || '',
      originalName: snapshot.attachmentOriginalName,
      storedPath: snapshot.attachmentStoredPath,
      mimeType: snapshot.attachmentMimeType,
      byteSize: snapshot.attachmentByteSize,
      sha256: snapshot.attachmentSha256
    }, 'Controlled library / 受控资料库',
    `Controlled/${snapshot.revisionId}-${safeName(snapshot.attachmentOriginalName)}`, fileLoader));
  }
  const materialized = await Promise.all(work);
  const names = new Set();
  for (const item of materialized) {
    if (names.has(item.archiveName) || item.archiveName.includes('..')) {
      fail('Attachment archive name collision', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
    names.add(item.archiveName);
  }
  return materialized.sort((left, right) => left.archiveName.localeCompare(right.archiveName, 'en'));
}

async function buildAttachmentZip(attachments, identity) {
  const zip = new JSZip();
  const files = attachments.map((item) => ({
    archiveName: item.archiveName,
    source: item.sourceLabel,
    originalName: item.originalName,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    sha256: item.sha256
  }));
  for (const attachment of attachments) {
    zip.file(attachment.archiveName, attachment.content, { date: ZIP_DATE, createFolders: true });
  }
  zip.file('attachments-manifest.json', stableJson({ schemaVersion: 1, ...identity, files }), { date: ZIP_DATE });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
}

function typedDocuments(documents, prefix) {
  return documents.map((document) => ({ ...document, documentType: `${prefix}_${document.format}` }));
}

function manifestFile(document) {
  return {
    documentType: document.documentType,
    documentNo: document.documentNo,
    originalName: document.originalName,
    mimeType: document.mimeType,
    byteSize: document.byteSize,
    sha256: document.sha256
  };
}

export function createQuotationPackageDocumentService({ enabled = false, dependencies, options = {} }) {
  const renderer = options.bidDocumentRenderer || createBidDocumentRenderer(options);
  const technicalService = options.technicalDocumentService || createTechnicalDocumentService({ ...options, bidDocumentRenderer: renderer });
  const commercialService = options.commercialDocumentService || createCommercialDocumentService({ ...options, bidDocumentRenderer: renderer });
  const fileLoader = options.fileLoader || (async () => fail('Attachment file loader is unavailable', 500));

  function assertEnabled() {
    if (enabled !== true) fail('Bid center is disabled', 404, BID_CENTER_ERROR_CODES.DISABLED);
  }

  async function workspace(actor, workspaceId, repositories = dependencies) {
    assertEnabled();
    const result = await repositories.bidWorkspaceRepository.getWorkspaceDetail(
      positiveInteger(workspaceId, 'Bid workspace'), { visibleToUserId: visibleUserId(actor) }
    );
    if (!result) fail('Bid workspace not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    return result;
  }

  async function getDashboard(actor, workspaceId) {
    const result = await workspace(actor, workspaceId);
    const [allDocuments, packageVersions] = await Promise.all([
      dependencies.quotationPackageDocumentRepository.listByWorkspace(result.id),
      dependencies.quotationPackageRepository.listByOpportunity(result.opportunity.id)
    ]);
    const canViewCommercial = commercialViewer(actor, result.opportunity);
    const documents = canViewCommercial
      ? allDocuments
      : allDocuments.filter((item) => !COMMERCIAL_OUTPUT_TYPES.has(item.documentType));
    const generationPackage = packageVersions.find((item) => (
      Number(item.workspaceId) === Number(result.id)
      && ['approved', 'sent', 'superseded', 'accepted'].includes(item.status)
    )) || null;
    return {
      documents,
      canViewCommercial,
      canGenerate: Boolean(generationPackage && isProjectLeadEngineer(actor, result.opportunity)),
      generationPackage
    };
  }

  async function generate(actor, workspaceId, packageId) {
    assertEnabled();
    const context = await dependencies.bidPackageApprovalService._completeContext(actor, workspaceId, packageId);
    if (!isProjectLeadEngineer(actor, context.workspace.opportunity)) {
      fail('Only the assigned Project Lead QE can generate controlled outputs', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    }
    if (!['approved', 'sent', 'superseded', 'accepted'].includes(context.source.status) || !context.source.versionNo) {
      fail('Only an approved complete bid version can generate outputs', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
    const [technicalDraft, commercialDraft] = await Promise.all([
      dependencies.opportunityTechnicalDraftRepository.getDraftDetail(context.source.technicalSolutionVersionId),
      dependencies.opportunityCommercialDraftRepository.getDraftDetail(context.source.commercialDraftId)
    ]);
    ensureApprovedSource(technicalDraft, 'Technical package');
    ensureApprovedSource(commercialDraft, 'Commercial package');
    ensureNoPlaceholders({ technicalDraft, commercialDraft, packageVersion: context.source });
    const outputProfile = outputProfileSnapshot(context.workspace);
    const attachments = await loadAttachments(
      dependencies, context.workspace, technicalDraft, commercialDraft, fileLoader
    );
    const opportunitySnapshot = context.workspace.sourceMetadata?.opportunity || {};
    const frozenOpportunity = {
      id: opportunitySnapshot.opportunityId || context.workspace.opportunity.id,
      opportunityNo: opportunitySnapshot.opportunityNo || context.workspace.opportunity.opportunityNo,
      title: opportunitySnapshot.opportunityTitle || context.workspace.opportunity.title,
      requirement: opportunitySnapshot.requirementSummary || '',
      productInterest: opportunitySnapshot.productName || '',
      projectType: opportunitySnapshot.projectType || '',
      deliveryCycle: opportunitySnapshot.deliveryCycle || '',
      expectedBidDate: opportunitySnapshot.expectedBidDate || null,
      customerId: opportunitySnapshot.customerId || context.workspace.opportunity.customerId,
      customerName: opportunitySnapshot.customerName || context.workspace.opportunity.customerName,
      customerAddress: opportunitySnapshot.customerAddress || '',
      customerCountry: opportunitySnapshot.customerCountry || '',
      customerRegion: opportunitySnapshot.customerRegion || '',
      customerIndustry: opportunitySnapshot.customerIndustry || '',
      customerWebsite: opportunitySnapshot.customerWebsite || '',
      primaryContactId: opportunitySnapshot.contactId || context.workspace.opportunity.primaryContactId,
      primaryContactName: opportunitySnapshot.contactName || context.workspace.opportunity.primaryContactName || '',
      contactTitle: opportunitySnapshot.contactTitle || '',
      contactEmail: opportunitySnapshot.contactEmail || '',
      contactPhone: opportunitySnapshot.contactPhone || ''
    };
    const common = {
      workspace: context.workspace,
      opportunity: frozenOpportunity,
      language: context.workspace.language,
      packageVersion: context.source,
      outputProfile,
      generatedBy: actor,
      approvedAt: context.source.reviewedAt
    };
    const [technicalDocuments, commercialDocuments, completeDocuments] = await Promise.all([
      technicalService.generateControlledBidDocuments({
        ...common, draft: technicalDraft,
        attachments: attachments.filter((item) => item.archiveName.startsWith('Technical/'))
      }),
      commercialService.generateApprovedDocuments({
        ...common, commercialDraft,
        attachments: attachments.filter((item) => !item.archiveName.startsWith('Technical/'))
      }),
      renderer.generatePackage({
        ...common, packageType: 'complete', technicalDraft, commercialDraft,
        versionLabel: `QP-V${context.source.versionNo}`, attachments
      })
    ]);
    const sourceSnapshot = {
      workspaceId: context.workspace.id,
      workspaceSnapshot: context.workspace.sourceMetadata,
      packageVersion: frozenPackageSnapshot(context.source),
      technicalDraft: frozenDraftSnapshot(technicalDraft),
      commercialDraft: frozenDraftSnapshot(commercialDraft),
      attachmentHashes: attachments.map((item) => ({ archiveName: item.archiveName, sha256: item.sha256 }))
    };
    const sourceSnapshotSha256 = snapshotHash(sourceSnapshot);
    const generationKey = snapshotHash({
      sourceSnapshotSha256,
      generatorVersion: BID_DOCUMENT_GENERATOR_VERSION,
      outputProfileId: outputProfile.id,
      outputProfileRevisionNo: outputProfile.revisionNo
    });
    const payloads = [
      ...typedDocuments(technicalDocuments, 'technical'),
      ...typedDocuments(commercialDocuments, 'commercial'),
      ...typedDocuments(completeDocuments, 'complete')
    ];
    const completeSpec = buildBidDocumentSpec({
      ...common, packageType: 'complete', technicalDraft, commercialDraft,
      versionLabel: `QP-V${context.source.versionNo}`, attachments
    });
    const zipContent = await buildAttachmentZip(attachments, {
      opportunityNo: context.workspace.opportunity.opportunityNo,
      packageVersion: `QP-V${context.source.versionNo}`,
      sourceSnapshotSha256,
      generationKey
    });
    payloads.push({
      documentType: 'attachments_zip', documentNo: `QP-V${context.source.versionNo}`,
      originalName: `${completeSpec.fileBase}_Attachments.zip`, mimeType: 'application/zip',
      content: zipContent, byteSize: zipContent.length, sha256: checksum(zipContent)
    });
    const manifestData = {
      schemaVersion: 1,
      generator: { name: 'BESTCRM Bid Center', version: BID_DOCUMENT_GENERATOR_VERSION },
      generatedBy: { id: Number(actor.id), username: actor.username || '', displayName: actor.displayName || '' },
      opportunity: frozenOpportunity,
      workspace: { id: context.workspace.id, language: context.workspace.language },
      package: {
        id: context.source.id, version: `QP-V${context.source.versionNo}`,
        status: context.source.status, approvedAt: context.source.reviewedAt,
        revisionReason: context.source.revisionReason || '', changeSummary: context.source.changeSummary || ''
      },
      sources: {
        technical: { id: technicalDraft.id, version: technicalDraft.formalVersionLabel, approvedAt: technicalDraft.reviewedAt },
        commercial: { id: commercialDraft.id, version: commercialDraft.formalVersionLabel, approvedAt: commercialDraft.reviewedAt }
      },
      outputProfile,
      sourceSnapshotSha256,
      generationKey,
      files: payloads.map(manifestFile),
      manifest: { selfHashStoredInDatabase: true, excludedFromFilesToAvoidCircularHash: true }
    };
    const manifestContent = Buffer.from(stableJson(manifestData), 'utf8');
    payloads.push({
      documentType: 'manifest_json', documentNo: `QP-V${context.source.versionNo}`,
      originalName: `${completeSpec.fileBase}_Manifest.json`, mimeType: 'application/json',
      content: manifestContent, byteSize: manifestContent.length, sha256: checksum(manifestContent)
    });
    if (payloads.length !== OUTPUT_TYPES.length
        || OUTPUT_TYPES.some((type) => !payloads.some((item) => item.documentType === type))) {
      fail('Generator did not produce the required eight output types', 500);
    }

    const persist = async (repositories) => {
      await repositories.quotationPackageDocumentRepository.lockPackage(context.source.id);
      const existing = await repositories.quotationPackageDocumentRepository.listByPackage(context.source.id);
      if (existing.length) {
        if (existing.length === OUTPUT_TYPES.length
            && existing.every((item) => item.generationKey === generationKey)
            && OUTPUT_TYPES.every((type) => existing.some((item) => item.documentType === type))) return existing;
        fail('This package already has a different or incomplete output set', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      // Transaction repositories may share one pg.Client, so keep these rechecks sequential.
      const recheckedWorkspace = await repositories.bidWorkspaceRepository.getWorkspaceDetail(context.workspace.id);
      const recheckedPackage = await repositories.quotationPackageRepository.getPackageDetail(context.source.id);
      const recheckedTechnical = await repositories.opportunityTechnicalDraftRepository.getDraftDetail(technicalDraft.id);
      const recheckedCommercial = await repositories.opportunityCommercialDraftRepository.getDraftDetail(commercialDraft.id);
      if (!recheckedWorkspace || !recheckedPackage
          || recheckedPackage.status !== context.source.status
          || Number(recheckedPackage.versionNo) !== Number(context.source.versionNo)
          || Number(recheckedPackage.technicalSolutionVersionId) !== Number(technicalDraft.id)
          || Number(recheckedPackage.commercialDraftId) !== Number(commercialDraft.id)) {
        fail('Frozen package changed before persistence', 409, BID_CENTER_ERROR_CODES.CONFLICT);
      }
      ensureApprovedSource(recheckedTechnical, 'Technical package');
      ensureApprovedSource(recheckedCommercial, 'Commercial package');
      outputProfileSnapshot(recheckedWorkspace);
      const created = await repositories.quotationPackageDocumentRepository.createMany({
        quotationPackageVersionId: context.source.id,
        workspaceId: context.workspace.id,
        technicalSolutionVersionId: technicalDraft.id,
        commercialDraftId: commercialDraft.id,
        outputProfileId: outputProfile.id,
        outputProfileRevisionNo: outputProfile.revisionNo,
        sourceSnapshotSha256,
        generationKey,
        generatorVersion: BID_DOCUMENT_GENERATOR_VERSION,
        generatedBy: Number(actor.id),
        documents: payloads
      });
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: context.workspace.id, packageType: 'complete',
        quotationPackageId: context.source.id, eventType: 'generated_bid_package_outputs',
        actorUserId: Number(actor.id),
        details: { generationKey, sourceSnapshotSha256, documentCount: created.length }
      });
      return created;
    };
    return typeof dependencies.workflowTransaction === 'function'
      ? dependencies.workflowTransaction(persist)
      : persist(dependencies);
  }

  async function download(actor, workspaceId, documentId) {
    assertEnabled();
    const load = async (repositories) => {
      const result = await workspace(actor, workspaceId, repositories);
      const document = await repositories.quotationPackageDocumentRepository.findById(
        positiveInteger(documentId, 'Document')
      );
      if (!document || Number(document.workspaceId) !== Number(result.id)) {
        fail('Generated document not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
      }
      if (COMMERCIAL_OUTPUT_TYPES.has(document.documentType) && !commercialViewer(actor, result.opportunity)) {
        fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
      }
      await repositories.bidPackageEditorRepository.insertEvent({
        workspaceId: result.id, packageType: 'complete',
        quotationPackageId: document.quotationPackageVersionId,
        eventType: 'downloaded_bid_output', actorUserId: Number(actor.id),
        details: { documentId: document.id, documentType: document.documentType, sha256: document.sha256 }
      });
      return document;
    };
    return typeof dependencies.workflowTransaction === 'function'
      ? dependencies.workflowTransaction(load)
      : load(dependencies);
  }

  return Object.freeze({ getDashboard, generate, download });
}

export const quotationPackageDocumentInternals = Object.freeze({
  OUTPUT_TYPES, commercialViewer, stableJson, snapshotHash, buildAttachmentZip, safeName,
  frozenDraftSnapshot, frozenPackageSnapshot
});
