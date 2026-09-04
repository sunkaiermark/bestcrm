import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  bidPackageApprovalInternals,
  createBidPackageApprovalService
} from '../../src/services/bidPackageApprovalService.mjs';

const qe = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };
const technicalManager = { id: 6, roles: [ROLES.TECHNICAL_MANAGER] };
const commercialManager = { id: 5, roles: [ROLES.COMMERCIAL_MANAGER] };
const salesManager = { id: 2, roles: [ROLES.SALES_MANAGER] };
const administrator = { id: 9, roles: [ROLES.ADMINISTRATOR] };

function technicalDraft(overrides = {}) {
  return {
    id: 41, opportunityId: 20, draftRevisionNo: 1, draftLabel: 'TS-D1', formalVersionNo: null,
    formalVersionLabel: '', status: 'draft', submittedBy: null, reviewedBy: null,
    variableSchemaSnapshot: [{ variableKey: 'capacity', sourceField: 'capacity', sectionKey: 'process', isRequired: true }],
    variableValues: { capacity: 10 }, validationIssues: [], selectedClauses: [{ id: 71, revisionNo: 1 }],
    contentSchemaSnapshot: { sections: [{ key: 'process', required: true }] },
    renderedContent: { sections: [{ key: 'process', included: true, modificationStatus: 'standard', bodyEn: 'Process' }] },
    ...overrides
  };
}

function commercialDraft(overrides = {}) {
  return {
    id: 42, workspaceId: 40, opportunityId: 20, draftRevisionNo: 1, draftLabel: 'CP-D1',
    formalVersionNo: null, formalVersionLabel: '', status: 'draft', submittedBy: null, reviewedBy: null,
    variableSchemaSnapshot: [
      { variableKey: 'total_price', sourceField: 'total_price', sectionKey: 'pricing', isRequired: true },
      { variableKey: 'currency', sourceField: 'currency', sectionKey: 'pricing', isRequired: true },
      { variableKey: 'payment_terms', sourceField: 'payment_terms', sectionKey: 'payment_terms', isRequired: true },
      { variableKey: 'quotation_validity', sourceField: 'quotation_validity', sectionKey: 'validity', isRequired: true },
      { variableKey: 'delivery_period', sourceField: 'delivery_period', sectionKey: 'delivery', isRequired: true }
    ],
    variableValues: {
      total_price: 120000, currency: 'USD', payment_terms: '30/70',
      quotation_validity: '2026-12-31', delivery_period: '12 weeks'
    },
    validationIssues: [],
    contentSchemaSnapshot: { sections: [{ key: 'pricing', required: true }] },
    renderedContent: { sections: [{ key: 'pricing', included: true, modificationStatus: 'standard', bodyEn: 'Price' }] },
    ...overrides
  };
}

function setup(overrides = {}) {
  const opportunity = {
    id: 20, opportunityNo: 'OPP-20', title: 'Mixer Project', salespersonId: 7,
    salesManagerId: 2, quotationEngineerId: 3, technicalManagerId: 6, commercialManagerId: 5,
    teamMembers: []
  };
  const state = {
    workspaceStatus: 'in_progress',
    technical: [technicalDraft()],
    commercial: [commercialDraft()],
    packages: [], checks: [], events: [], todos: [], workflowEvents: [], copiedArtifacts: [],
    quote: {
      id: 31, opportunityId: 20, status: 'approved', versionNo: 3, totalPrice: 120000,
      paymentTerms: '30/70', validityDate: '2026-12-31',
      items: [{ itemName: 'Mixer', specification: 'MX-100', unit: 'set', quantity: 1, unitPrice: 120000, subtotal: 120000 }]
    }
  };
  Object.assign(opportunity, overrides.opportunity || {});
  Object.assign(state, overrides.state || {});
  const workspace = () => ({
    id: 40, opportunityId: 20, status: state.workspaceStatus, opportunity: structuredClone(opportunity),
    technicalDraft: { id: state.technical[0].id }, commercialDraft: { id: state.commercial[0].id },
    sourceMetadata: { opportunity: { approvedCommercialQuoteId: state.quote.id, deliveryCycle: '12 weeks' } }
  });

  const dependencies = {
    bidWorkspaceRepository: {
      async getWorkspaceDetail(id, filter) {
        assert.equal(Number(id), 40);
        assert.deepEqual(filter, { visibleToUserId: filter.visibleToUserId });
        return workspace();
      }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } },
    opportunityTechnicalDraftRepository: {
      async listByOpportunity() { return state.technical.map((item) => structuredClone(item)); },
      async getDraftDetail(id) { return structuredClone(state.technical.find((item) => item.id === Number(id)) || null); },
      async markReady({ draftId, actorUserId }) {
        const draft = state.technical.find((item) => item.id === Number(draftId));
        if (!draft || !['draft', 'ready'].includes(draft.status)) return null;
        Object.assign(draft, { status: 'ready', updatedBy: actorUserId }); return structuredClone(draft);
      },
      async submitForApproval({ draftId, actorUserId }) {
        const draft = state.technical.find((item) => item.id === Number(draftId));
        if (!draft || draft.status !== 'ready') return null;
        Object.assign(draft, { status: 'pending', submittedBy: actorUserId }); return structuredClone(draft);
      },
      async approveLatestPending({ actorUserId, reviewComment }) {
        const draft = state.technical.find((item) => item.status === 'pending' && item.submittedBy !== actorUserId);
        if (!draft) return null;
        Object.assign(draft, { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'TS-V1', reviewedBy: actorUserId, reviewComment });
        return structuredClone(draft);
      },
      async rejectLatestPending({ actorUserId, reviewComment }) {
        const draft = state.technical.find((item) => item.status === 'pending' && item.submittedBy !== actorUserId);
        if (!draft) return null;
        Object.assign(draft, { status: 'rejected', reviewedBy: actorUserId, reviewComment });
        return structuredClone(draft);
      },
      async cloneRejectedDraft({ sourceDraftId, actorUserId }) {
        const source = state.technical.find((item) => item.id === Number(sourceDraftId) && item.status === 'rejected');
        if (!source) return null;
        const clone = technicalDraft({ id: 43, draftRevisionNo: 2, draftLabel: 'TS-D2', sourceDraftId: source.id, createdBy: actorUserId });
        state.technical.unshift(clone); return structuredClone(clone);
      }
    },
    opportunityCommercialDraftRepository: {
      async listByWorkspace() { return state.commercial.map((item) => structuredClone(item)); },
      async getDraftDetail(id) { return structuredClone(state.commercial.find((item) => item.id === Number(id)) || null); }
    },
    quotationPackageRepository: {
      async getCommercialQuoteContext() { return structuredClone(state.quote); },
      async listByOpportunity() { return state.packages.map((item) => structuredClone(item)); },
      async findCurrentSentByOpportunity() { return structuredClone(state.packages.find((item) => item.status === 'sent') || null); },
      async getPackageDetail(id) { return structuredClone(state.packages.find((item) => item.id === Number(id)) || null); },
      async approvePending({ packageId, actorUserId, comment }) {
        const pkg = state.packages.find((item) => item.id === Number(packageId) && item.status === 'pending' && item.submittedBy !== actorUserId);
        if (!pkg) return null;
        Object.assign(pkg, { status: 'approved', versionNo: 1, label: 'QP-V1', reviewedBy: actorUserId, reviewComment: comment });
        return structuredClone(pkg);
      },
      async rejectPending({ packageId, actorUserId, comment }) {
        const pkg = state.packages.find((item) => item.id === Number(packageId) && item.status === 'pending' && item.submittedBy !== actorUserId);
        if (!pkg) return null;
        Object.assign(pkg, { status: 'rejected', reviewedBy: actorUserId, reviewComment: comment });
        return structuredClone(pkg);
      }
    },
    bidPackageEditorRepository: {
      async listChanges() { return []; }, async listAttachments() { return []; },
      async insertEvent(input) { state.events.push(structuredClone(input)); return input; }
    },
    bidPackageApprovalRepository: {
      async createCompletenessCheck(input) {
        const saved = { id: state.checks.length + 1, checkedByDisplayName: `User ${input.actorUserId}`, ...structuredClone(input) };
        state.checks.unshift(saved); return saved;
      },
      async listCompletenessChecks(input) {
        return state.checks.filter((item) => item.packageType === input.packageType
          && Number(item.technicalDraftId || item.commercialDraftId || item.quotationPackageId)
            === Number(input.technicalDraftId || input.commercialDraftId || input.quotationPackageId));
      },
      async setWorkspaceStatus({ status }) { state.workspaceStatus = status; return { id: 40, status }; },
      async copyDraftArtifacts(input) { state.copiedArtifacts.push(structuredClone(input)); return input; },
      async submitCommercial({ commercialDraftId, actorUserId }) {
        const draft = state.commercial.find((item) => item.id === Number(commercialDraftId) && item.status === 'draft');
        if (!draft) return null;
        Object.assign(draft, { status: 'review_pending', submittedBy: actorUserId }); return draft.id;
      },
      async approveCommercial({ commercialDraftId, actorUserId, reviewComment }) {
        const draft = state.commercial.find((item) => item.id === Number(commercialDraftId)
          && item.status === 'review_pending' && item.submittedBy !== actorUserId);
        if (!draft) return null;
        Object.assign(draft, { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'CP-V1', reviewedBy: actorUserId, reviewComment });
        return { id: draft.id, formalVersionNo: 1 };
      },
      async rejectCommercial() { return null; }, async cloneRejectedCommercial() { return null; },
      async createCompleteDraft(input) {
        const draftRevisionNo = Math.max(0, ...state.packages.map((item) => Number(item.draftRevisionNo || 0))) + 1;
        const pkg = {
          id: 50 + draftRevisionNo, workspaceId: 40, opportunityId: 20, draftRevisionNo,
          label: `QP-D${draftRevisionNo}`, status: 'draft', sourcePackageId: input.sourcePackageId || null,
          technicalSolutionVersionId: input.technicalDraftId,
          technicalSolutionVersionNo: state.technical.find((item) => item.id === input.technicalDraftId).formalVersionNo,
          commercialDraftId: input.commercialDraftId,
          commercialDraftVersionNo: state.commercial.find((item) => item.id === input.commercialDraftId).formalVersionNo,
          commercialQuoteId: input.commercialQuoteId, commercialQuoteVersionNo: state.quote.versionNo,
          currency: input.currency, totalPrice: input.totalPrice, deliveryPeriod: input.deliveryPeriod,
          paymentTerms: input.paymentTerms, validUntil: input.validUntil, commercialLineItems: input.commercialLineItems,
          revisionReason: input.revisionReason, changeSummary: input.changeSummary,
          submittedBy: null, reviewedBy: null
        };
        state.packages.unshift(pkg); return { id: pkg.id, draftRevisionNo };
      },
      async submitComplete({ quotationPackageId, actorUserId }) {
        const pkg = state.packages.find((item) => item.id === Number(quotationPackageId) && item.status === 'draft');
        if (!pkg) return null;
        Object.assign(pkg, { status: 'pending', submittedBy: actorUserId }); return pkg.id;
      },
      async cloneRejectedComplete() { return null; }
    },
    todoRepository: {
      async create(input) { state.todos.push({ status: 'pending', ...structuredClone(input) }); return input; },
      async closePendingForOpportunityAssigneeAndTitle(opportunityId, assigneeUserId, title, status) {
        for (const todo of state.todos) if (todo.opportunityId === opportunityId && todo.assigneeUserId === assigneeUserId && todo.title === title && todo.status === 'pending') todo.status = status;
      }
    },
    workflowEventRepository: {
      async create(input) { state.workflowEvents.push(structuredClone(input)); return input; }
    }
  };
  return { service: createBidPackageApprovalService({ enabled: true, dependencies }), state, opportunity, dependencies };
}

test('completeness detects required content, review deviations, placeholders, and attachments', () => {
  const draft = technicalDraft({
    contentSchemaSnapshot: { sections: [{ key: 'process', required: true, requiredAttachment: true }] },
    renderedContent: { sections: [{
      key: 'process', included: true, modificationStatus: 'needs_review', bodyEn: '{{capacity}}',
      tableRows: [{ deviationStatus: 'needs_clarification' }]
    }] }
  });
  const codes = bidPackageApprovalInternals.sectionIssues(draft, [], []).map((item) => item.code);
  assert.ok(codes.includes('section_needs_review'));
  assert.ok(codes.includes('change_reason_missing'));
  assert.ok(codes.includes('required_attachment_missing'));
  assert.ok(codes.includes('unresolved_placeholder'));
  assert.ok(codes.includes('unresolved_deviation'));
});

test('commercial submission blocks amount inconsistency and records a failed immutable check', async () => {
  const { service, state } = setup();
  state.commercial[0].variableValues.total_price = 125000;
  await assert.rejects(() => service.submitPackage(qe, 40, 'commercial'), (error) => (
    error.statusCode === 409 && error.details.some((item) => item.code === 'total_price_mismatch')
  ));
  assert.equal(state.checks[0].passed, false);
  assert.equal(state.commercial[0].status, 'draft');
});

test('Quotation Engineer submits CP-D and assigned Commercial Manager alone approves CP-V', async () => {
  const { service, state } = setup();
  const submitted = await service.submitPackage(qe, 40, 'commercial', { comment: 'Ready' });
  assert.equal(submitted.status, 'review_pending');
  assert.equal(state.todos[0].assigneeUserId, commercialManager.id);
  await assert.rejects(() => service.reviewPackage(administrator, 40, 'commercial', { decision: 'approve' }), /Forbidden/);
  const result = await service.reviewPackage(commercialManager, 40, 'commercial', { decision: 'approve', comment: 'Approved' });
  assert.equal(result.reviewed.formalVersionLabel, 'CP-V1');
  assert.equal(state.todos[0].status, 'completed');
  assert.equal(state.workflowEvents.at(-1).targetUserId, qe.id);
  await assert.rejects(() => service.reviewPackage(commercialManager, 40, 'commercial', { decision: 'approve' }), /Forbidden/);
});

test('technical rejection preserves the snapshot and creates the next TS-D with copied project artifacts', async () => {
  const { service, state } = setup();
  await service.submitPackage(qe, 40, 'technical');
  const result = await service.reviewPackage(technicalManager, 40, 'technical', {
    decision: 'reject', comment: 'Revise process guarantee'
  });
  assert.equal(result.reviewed.status, 'rejected');
  assert.equal(result.revision.draftLabel, 'TS-D2');
  assert.deepEqual(state.copiedArtifacts[0], {
    workspaceId: 40, packageType: 'technical', sourceDraftId: 41, targetDraftId: 43, actorUserId: 6
  });
  assert.equal(state.todos.at(-1).assigneeUserId, qe.id);
});

test('submission refuses a reviewer who is also the submitter', async () => {
  const dualRole = { id: 3, roles: [ROLES.QUOTATION_ENGINEER, ROLES.TECHNICAL_MANAGER] };
  const { service, state } = setup({ opportunity: { technicalManagerId: 3 } });
  await assert.rejects(() => service.submitPackage(dualRole, 40, 'technical'), /Reviewer must be different/);
  assert.equal(state.technical[0].status, 'draft');
});

test('approved TS-V and CP-V assemble QP-D, which only assigned Sales Manager can approve as QP-V', async () => {
  const { service, state } = setup();
  Object.assign(state.technical[0], { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'TS-V1' });
  Object.assign(state.commercial[0], { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'CP-V1' });
  const complete = await service.createCompleteDraft(qe, 40, { currency: 'USD' });
  assert.equal(complete.label, 'QP-D1');
  const submitted = await service.submitComplete(qe, 40, complete.id, { comment: 'Final review' });
  assert.equal(submitted.status, 'pending');
  assert.equal(state.workspaceStatus, 'review_pending');
  await assert.rejects(() => service.reviewComplete(administrator, 40, complete.id, { decision: 'approve' }), /Forbidden/);
  const approved = await service.reviewComplete(salesManager, 40, complete.id, { decision: 'approve', comment: 'Approved' });
  assert.equal(approved.reviewed.label, 'QP-V1');
  assert.equal(state.workspaceStatus, 'approved');
  assert.equal(state.checks[0].passed, true);
});

test('a customer revision can change delivery when the approved commercial package did not freeze it', async () => {
  const { service, state } = setup();
  Object.assign(state.technical[0], { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'TS-V1' });
  Object.assign(state.commercial[0], { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'CP-V1' });
  state.commercial[0].variableValues.delivery_period = '';
  state.packages.push({
    id: 50, workspaceId: 40, opportunityId: 20, draftRevisionNo: 1, label: 'QP-V1',
    status: 'sent', versionNo: 1, deliveryPeriod: '12 weeks'
  });

  const revision = await service.createCompleteDraft(qe, 40, {
    sourcePackageId: 50,
    deliveryPeriod: '16 weeks after advance payment',
    revisionReason: 'Customer requested a revised delivery window',
    changeSummary: 'Delivery period revised from 12 weeks to 16 weeks after advance payment.'
  });

  assert.equal(revision.label, 'QP-D2');
  assert.equal(revision.sourcePackageId, 50);
  assert.equal(revision.deliveryPeriod, '16 weeks after advance payment');
  assert.equal(revision.revisionReason, 'Customer requested a revised delivery window');
});

test('a customer revision cannot override delivery frozen by the approved commercial package', async () => {
  const { service, state } = setup();
  Object.assign(state.technical[0], { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'TS-V1' });
  Object.assign(state.commercial[0], { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'CP-V1' });
  state.packages.push({
    id: 50, workspaceId: 40, opportunityId: 20, draftRevisionNo: 1, label: 'QP-V1',
    status: 'sent', versionNo: 1, deliveryPeriod: '12 weeks'
  });

  await assert.rejects(() => service.createCompleteDraft(qe, 40, {
    sourcePackageId: 50,
    deliveryPeriod: '16 weeks',
    revisionReason: 'Customer request',
    changeSummary: 'Delivery changed.'
  }), (error) => error.statusCode === 409 && /approved commercial package/.test(error.message));
});

test('version comparison includes variable, section, and attachment hash changes', async () => {
  const { service, state, dependencies } = setup();
  state.technical.unshift(technicalDraft({
    id: 43, draftRevisionNo: 2, draftLabel: 'TS-D2',
    variableValues: { capacity: 12 },
    renderedContent: { sections: [{ key: 'process', included: true, modificationStatus: 'modified', bodyEn: 'Updated process' }] }
  }));
  dependencies.bidPackageEditorRepository.listAttachments = async (input) => ([{
    sha256: Number(input.technicalDraftId) === 43 ? 'b'.repeat(64) : 'a'.repeat(64)
  }]);
  const approval = await service.getPackageApproval(qe, 40, 'technical');
  assert.deepEqual(approval.comparison.changedVariables, ['capacity']);
  assert.deepEqual(approval.comparison.changedSections, ['process']);
  assert.equal(approval.comparison.attachmentHashesChanged, true);
});
