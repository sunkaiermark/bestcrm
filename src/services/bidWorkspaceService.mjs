import { BID_WORKSPACE_LANGUAGES } from '../domain/bidWorkspace.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { canViewBidContentBlock } from './bidContentBlockService.mjs';
import { BidCenterServiceError, BID_CENTER_ERROR_CODES } from './bidCenterService.mjs';
import { canViewCommercialTemplateLibrary } from './commercialPackageTemplateService.mjs';
import {
  buildOpportunityCommercialDraftSnapshot,
  commercialContentComponentIds
} from './opportunityCommercialDraftService.mjs';
import {
  buildOpportunityTechnicalDraftSnapshot
} from './opportunityTechnicalDraftService.mjs';
import { canViewOpportunity, isProjectLeadEngineer } from './opportunityService.mjs';

function fail(message, statusCode = 400, code = BID_CENTER_ERROR_CODES.VALIDATION) {
  throw new BidCenterServiceError(message, { statusCode, code });
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(`${field} is invalid`);
  return number;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function languageCompatible(sourceLanguage, requestedLanguage) {
  return sourceLanguage === requestedLanguage || sourceLanguage === 'bilingual';
}

function variableInputName(prefix, variableKey) {
  return `${prefix}__${variableKey}`;
}

export function collectBidWorkspaceVariableOverrides(input, prefix) {
  const result = {};
  const fieldPrefix = `${prefix}__`;
  for (const [key, value] of Object.entries(input || {})) {
    if (!key.startsWith(fieldPrefix)) continue;
    const variableKey = key.slice(fieldPrefix.length);
    if (/^[a-z][a-z0-9_]{0,63}$/.test(variableKey)) result[variableKey] = value;
  }
  return result;
}

export function bidWorkspaceVariableInputName(prefix, variableKey) {
  return variableInputName(prefix, variableKey);
}

export function canCreateBidWorkspace(actor, opportunity) {
  if (!canViewOpportunity(actor, opportunity)) return false;
  if (hasRole(actor, ROLES.ADMINISTRATOR)) return true;
  if (hasRole(actor, ROLES.SALES_MANAGER)
      && Number(opportunity.salesManagerId) === Number(actor.id)) return true;
  if (isProjectLeadEngineer(actor, opportunity)) return true;
  if (hasRole(actor, ROLES.TECHNICAL_MANAGER)
      && Number(opportunity.technicalManagerId) === Number(actor.id)) return true;
  return hasRole(actor, ROLES.COMMERCIAL_MANAGER)
    && Number(opportunity.commercialManagerId) === Number(actor.id);
}

function assertEnabled(enabled) {
  if (enabled !== true) fail('Bid center is disabled', 404, BID_CENTER_ERROR_CODES.DISABLED);
}

function assertViewer(actor, opportunity) {
  if (!canViewOpportunity(actor, opportunity)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
}

function assertCreator(actor, opportunity) {
  if (!canCreateBidWorkspace(actor, opportunity)) fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
}

function selectionInput(input) {
  const language = String(input?.language ?? '').trim();
  if (!BID_WORKSPACE_LANGUAGES.includes(language)) fail('Workspace language is invalid');
  return {
    language,
    technicalTemplateRevisionId: positiveInteger(input.technicalTemplateRevisionId, 'Technical template revision'),
    commercialTemplateRevisionId: positiveInteger(input.commercialTemplateRevisionId, 'Commercial template revision'),
    outputProfileId: positiveInteger(input.outputProfileId, 'Output profile')
  };
}

function opportunitySnapshot(context) {
  return {
    opportunityId: context.opportunityId,
    opportunityNo: context.opportunityNo,
    opportunityTitle: context.opportunityTitle,
    requirementSummary: context.requirementSummary,
    estimatedAmount: context.estimatedAmount,
    productName: context.productName,
    projectType: context.projectType,
    deliveryCycle: context.deliveryCycle,
    expectedBidDate: context.expectedBidDate,
    customerId: context.customerId,
    customerName: context.customerName,
    customerAddress: context.customerAddress,
    customerCountry: context.customerCountry,
    customerRegion: context.customerRegion,
    customerIndustry: context.customerIndustry,
    customerWebsite: context.customerWebsite,
    contactId: context.contactId,
    contactName: context.contactName,
    contactTitle: context.contactTitle,
    contactEmail: context.contactEmail,
    contactPhone: context.contactPhone,
    opportunityOwner: context.opportunityOwner,
    technicalManager: context.technicalManager,
    commercialManager: context.commercialManager,
    approvedCommercialQuoteId: context.quoteId,
    approvedCommercialQuoteVersionNo: context.quoteVersionNo,
    approvedCommercialQuoteItems: deepClone(context.quoteItems || [])
  };
}

function templateSnapshot(template, revision) {
  return {
    templateId: Number(template.id),
    templateCode: template.templateCode,
    revisionId: Number(revision.id),
    revisionNo: Number(revision.revisionNo),
    language: template.language
  };
}

function outputProfileSnapshot(profile) {
  return {
    id: profile.id,
    profileCode: profile.profileCode,
    revisionNo: profile.revisionNo,
    revisionLabel: profile.revisionLabel,
    nameEn: profile.nameEn,
    nameZh: profile.nameZh,
    languageMode: profile.languageMode,
    layoutSettings: deepClone(profile.layoutSettings),
    brandAssets: deepClone(profile.brandAssets)
  };
}

function visibleUserId(actor) {
  return hasRole(actor, ROLES.ADMINISTRATOR) ? null : positiveInteger(actor.id, 'User');
}

async function loadSelection(dependencies, opportunity, rawInput, overrides = {}) {
  const input = selectionInput(rawInput);
  // These repositories may share one pg.Client during atomic workspace creation.
  // Keep query execution sequential because concurrent queries on one client are unsupported.
  const technicalTemplates = await dependencies.technicalTemplateRepository.listTemplates({ publishedOnly: true });
  const commercialTemplates = await dependencies.commercialPackageTemplateRepository.listTemplates({ publishedOnly: true });
  const outputProfile = await dependencies.bidWorkspaceRepository.findPublishedOutputProfile(input.outputProfileId);
  const context = await dependencies.bidWorkspaceRepository.getGenerationContext(opportunity.id);
  const technicalTemplate = technicalTemplates.find((template) => (
    Number(template.currentPublishedRevisionId) === input.technicalTemplateRevisionId
  ));
  const commercialTemplate = commercialTemplates.find((template) => (
    Number(template.currentPublishedRevisionId) === input.commercialTemplateRevisionId
  ));
  if (!technicalTemplate) fail('Selected technical template is no longer current and published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  if (!commercialTemplate) fail('Selected commercial template is no longer current and published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  if (!outputProfile) fail('Selected output profile is no longer published', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  if (!context) fail('Opportunity generation context not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
  if (!languageCompatible(technicalTemplate.language, input.language)
      || !languageCompatible(commercialTemplate.language, input.language)
      || !languageCompatible(outputProfile.languageMode, input.language)) {
    fail('Selected templates and output profile do not support the workspace language', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  const technicalDetail = await dependencies.technicalTemplateRepository.getTemplateDetail(technicalTemplate.id);
  const commercialDetail = await dependencies.commercialPackageTemplateRepository.getTemplateDetail(commercialTemplate.id);
  const technicalRevision = technicalDetail?.revisions.find((revision) => revision.id === input.technicalTemplateRevisionId);
  const commercialRevision = commercialDetail?.revisions.find((revision) => revision.id === input.commercialTemplateRevisionId);
  if (!technicalRevision || technicalRevision.status !== 'published') {
    fail('Selected technical template revision is unavailable', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  if (!commercialRevision || commercialRevision.status !== 'published') {
    fail('Selected commercial template revision is unavailable', 409, BID_CENTER_ERROR_CODES.CONFLICT);
  }
  const contentIds = commercialContentComponentIds(commercialRevision.contentSchema);
  const contentSnapshots = await dependencies.bidWorkspaceRepository.listCurrentPublishedContentSnapshots(contentIds);
  const snapshotAt = new Date().toISOString();
  const technicalSnapshot = await buildOpportunityTechnicalDraftSnapshot(
    dependencies,
    opportunity,
    technicalDetail,
    technicalRevision,
    {
      language: input.language,
      actorUserId: rawInput.actorUserId,
      overrides: overrides.technical || {},
      context,
      snapshotAt
    }
  );
  const commercialSnapshot = buildOpportunityCommercialDraftSnapshot({
    opportunity,
    template: commercialDetail,
    revision: commercialRevision,
    context,
    contentSnapshots,
    language: input.language,
    actorUserId: rawInput.actorUserId,
    overrides: overrides.commercial || {},
    snapshotAt
  });
  return {
    input,
    context,
    technicalTemplate: technicalDetail,
    technicalRevision,
    commercialTemplate: commercialDetail,
    commercialRevision,
    outputProfile,
    contentSnapshots,
    technicalSnapshot,
    commercialSnapshot,
    snapshotAt
  };
}

export function createBidWorkspaceService({ enabled = false, dependencies }) {
  async function list(actor) {
    assertEnabled(enabled);
    return dependencies.bidWorkspaceRepository.listWorkspaces({ visibleToUserId: visibleUserId(actor) });
  }

  async function get(actor, workspaceId, { includeRestricted = false } = {}) {
    assertEnabled(enabled);
    const workspace = await dependencies.bidWorkspaceRepository.getWorkspaceDetail(
      positiveInteger(workspaceId, 'Bid workspace'),
      { visibleToUserId: visibleUserId(actor) }
    );
    if (!workspace) fail('Bid workspace not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    if (!includeRestricted && !canViewCommercialTemplateLibrary(actor)) {
      workspace.commercialTemplate = { restricted: true };
      workspace.commercialDraft = workspace.commercialDraft ? {
        id: workspace.commercialDraft.id,
        draftLabel: workspace.commercialDraft.draftLabel,
        status: 'restricted',
        restricted: true
      } : null;
    }
    return workspace;
  }

  async function findForOpportunity(actor, opportunity) {
    assertEnabled(enabled);
    assertViewer(actor, opportunity);
    return dependencies.bidWorkspaceRepository.findByOpportunity(positiveInteger(opportunity.id, 'Opportunity'));
  }

  async function getCreationOptions(actor, opportunity) {
    assertEnabled(enabled);
    assertViewer(actor, opportunity);
    const existing = await dependencies.bidWorkspaceRepository.findByOpportunity(opportunity.id);
    if (existing) return { existing, canCreate: false, technicalTemplates: [], commercialTemplates: [], outputProfiles: [] };
    assertCreator(actor, opportunity);
    const [technicalTemplates, commercialTemplates, outputProfiles] = await Promise.all([
      dependencies.technicalTemplateRepository.listTemplates({ publishedOnly: true }),
      dependencies.commercialPackageTemplateRepository.listTemplates({ publishedOnly: true }),
      dependencies.bidWorkspaceRepository.listPublishedOutputProfiles()
    ]);
    return { existing: null, canCreate: true, technicalTemplates, commercialTemplates, outputProfiles };
  }

  async function preview(actor, opportunity, input) {
    assertEnabled(enabled);
    assertCreator(actor, opportunity);
    const existing = await dependencies.bidWorkspaceRepository.findByOpportunity(opportunity.id);
    if (existing) fail('This opportunity already has a bid workspace', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    return loadSelection(dependencies, opportunity, { ...input, actorUserId: actor.id }, {
      technical: collectBidWorkspaceVariableOverrides(input, 'technical'),
      commercial: collectBidWorkspaceVariableOverrides(input, 'commercial')
    });
  }

  async function create(actor, opportunity, input) {
    assertEnabled(enabled);
    assertCreator(actor, opportunity);
    if (typeof dependencies.workflowTransaction === 'function') {
      return dependencies.workflowTransaction((repositories) => createBidWorkspaceService({
        enabled,
        dependencies: { ...dependencies, ...repositories, workflowTransaction: null }
      }).create(actor, opportunity, input));
    }
    const existing = await dependencies.bidWorkspaceRepository.findByOpportunity(opportunity.id);
    if (existing) fail('This opportunity already has a bid workspace', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    const selected = await loadSelection(dependencies, opportunity, { ...input, actorUserId: actor.id }, {
      technical: collectBidWorkspaceVariableOverrides(input, 'technical'),
      commercial: collectBidWorkspaceVariableOverrides(input, 'commercial')
    });
    const workspace = await dependencies.bidWorkspaceRepository.createWorkspace({
      opportunityId: opportunity.id,
      language: selected.input.language,
      technicalTemplateRevisionId: selected.technicalRevision.id,
      commercialTemplateRevisionId: selected.commercialRevision.id,
      outputProfileId: selected.outputProfile.id,
      sourceMetadata: {
        schemaVersion: 1,
        snapshotAt: selected.snapshotAt,
        opportunity: opportunitySnapshot(selected.context),
        technicalTemplate: templateSnapshot(selected.technicalTemplate, selected.technicalRevision),
        commercialTemplate: templateSnapshot(selected.commercialTemplate, selected.commercialRevision),
        outputProfile: outputProfileSnapshot(selected.outputProfile),
        technicalClauseSnapshots: deepClone(selected.technicalSnapshot.selectedClauses),
        contentComponentReferences: selected.contentSnapshots.map((snapshot) => ({
          blockId: snapshot.blockId,
          blockCode: snapshot.blockCode,
          revisionId: snapshot.revisionId,
          revisionNo: snapshot.revisionNo,
          revisionLabel: snapshot.revisionLabel,
          attachmentSha256: snapshot.attachmentSha256
        }))
      },
      actorUserId: actor.id
    });
    if (!workspace) fail('This opportunity already has a bid workspace', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    const technicalDraft = await dependencies.opportunityTechnicalDraftRepository.createDraft(selected.technicalSnapshot);
    const commercialDraft = await dependencies.opportunityCommercialDraftRepository.createDraft({
      ...selected.commercialSnapshot,
      workspaceId: workspace.id
    });
    if (!technicalDraft || !commercialDraft) {
      fail('Bid workspace package snapshots could not be created', 409, BID_CENTER_ERROR_CODES.CONFLICT);
    }
    return dependencies.bidWorkspaceRepository.getWorkspaceDetail(workspace.id);
  }

  async function getAttachment(actor, workspaceId, revisionId) {
    const workspace = await get(actor, workspaceId, { includeRestricted: true });
    const snapshots = workspace.commercialDraft?.sourceMetadata?.contentComponentSnapshots || [];
    const snapshot = snapshots.find((candidate) => Number(candidate.revisionId) === positiveInteger(revisionId, 'Content revision'));
    if (!snapshot?.attachmentSha256) fail('Attachment not found', 404, BID_CENTER_ERROR_CODES.NOT_FOUND);
    const policyShape = {
      category: snapshot.category,
      ownerRoleCode: snapshot.ownerRoleCode,
      sensitivity: snapshot.sensitivity,
      currentSensitivity: snapshot.sensitivity,
      isActive: true,
      currentPublishedRevisionId: snapshot.revisionId
    };
    if (!canViewBidContentBlock(actor, policyShape)) {
      fail('Forbidden', 403, BID_CENTER_ERROR_CODES.FORBIDDEN);
    }
    return snapshot;
  }

  return Object.freeze({
    list,
    get,
    findForOpportunity,
    getCreationOptions,
    preview,
    create,
    getAttachment
  });
}
