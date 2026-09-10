import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ACTIONS } from '../../src/domain/workflow.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { submitSalesLead } from '../../src/services/leadSubmissionService.mjs';
import { convertInquiryToOpportunity } from '../../src/services/inquiryService.mjs';
import {
  assignOpportunityTechnicalDraftSection,
  generateOpportunityTechnicalDraft,
  markOpportunityTechnicalDraftReady,
  updateOpportunityTechnicalDraftSection,
  updateOpportunityTechnicalDraftVariables
} from '../../src/services/opportunityTechnicalDraftService.mjs';
import { applyWorkflowAction } from '../../src/services/workflowService.mjs';
import {
  acceptQuotationPackage,
  createQuotationPackageDraft,
  reviewQuotationPackage,
  submitQuotationPackage
} from '../../src/services/quotationPackageService.mjs';
import { createCustomerEmailDraft } from '../../src/services/customerEmailService.mjs';
import { archiveInboundEmailRecord } from '../../src/services/emailArchiveService.mjs';

const sales = {
  id: 1, displayName: 'Steven Yang', emailSignatureName: 'Steven Yang',
  emailSignatureTitle: 'International Sales Manager', email: 'steven.yang@sunkaier.com',
  phone: '+65 6000 0000', isActive: true, roles: [ROLES.SALESPERSON]
};
const salesManager = { id: 2, displayName: 'Sales Manager', isActive: true, roles: [ROLES.SALES_MANAGER] };
const leadEngineer = { id: 3, displayName: 'Lead Engineer', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] };
const supportEngineer = { id: 4, displayName: 'Support Engineer', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] };
const technicalManager = { id: 5, displayName: 'Technical Manager', isActive: true, roles: [ROLES.TECHNICAL_MANAGER] };
const commercialManager = { id: 6, displayName: 'Commercial Manager', isActive: true, roles: [ROLES.COMMERCIAL_MANAGER] };

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function createAcceptanceState() {
  return {
    inquiry: null, customer: null, contact: null, opportunity: null, technicalDraft: null,
    packages: [], packageAttachments: new Map(), threads: [], messages: [], emailAttachments: [],
    deliveryAttempts: [], sentMail: [], workflowEvents: [], todos: [], materialVersions: [],
    technicalSolution: null, commercialQuote: null, acceptedPackageId: null
  };
}

function createCoreRepositories(state) {
  const users = [sales, salesManager, leadEngineer, supportEngineer, technicalManager, commercialManager];
  const inquiryRepository = {
    async createInquiry(input) { state.inquiry = { id: 11, ...input }; return state.inquiry; },
    async markConverted(id, input) {
      if (Number(id) !== state.inquiry.id || !['new', 'reviewing'].includes(state.inquiry.status)) return null;
      Object.assign(state.inquiry, input, { status: 'converted' });
      return state.inquiry;
    },
    async findById(id) { return Number(id) === state.inquiry?.id ? state.inquiry : null; }
  };
  const customerRepository = {
    async findDuplicatesByName() { return []; },
    async createCustomer(input) { state.customer = { id: 21, ...input }; return state.customer; },
    async getCustomerDetail(id) { return Number(id) === state.customer?.id ? state.customer : null; }
  };
  const contactRepository = {
    async createContact(input) {
      state.contact = { id: 31, customerOwnerUserId: state.customer.ownerUserId, ...input };
      return state.contact;
    },
    async getContactDetail(id) { return Number(id) === state.contact?.id ? state.contact : null; }
  };
  const opportunityRepository = {
    async createOpportunity(input) {
      state.opportunity = {
        id: 41, opportunityNo: '800041', salesManagerId: null, quotationEngineerId: null,
        technicalManagerId: null, commercialManagerId: null, teamMembers: [], ...input
      };
      return state.opportunity;
    },
    async findById(id) { return Number(id) === state.opportunity?.id ? { ...state.opportunity } : null; },
    async getOpportunityDetail(id) { return Number(id) === state.opportunity?.id ? { ...state.opportunity } : null; },
    async updateWorkflowState(id, changes) {
      if (Number(id) !== state.opportunity.id) return null;
      Object.assign(state.opportunity, changes);
      return { ...state.opportunity };
    }
  };
  return {
    inquiryRepository,
    customerRepository,
    contactRepository,
    opportunityRepository,
    userRepository: { async listUsersWithRoles() { return users; } },
    inquiryAttachmentRepository: { async listByInquiry() { return []; } },
    attachmentRepository: {
      async listByOpportunity() {
        return [{ id: 91, category: 'commercial_quote', originalName: 'commercial-v1.pdf', opportunityMaterialVersionId: null }];
      },
      async bindUnboundToMaterialVersion() { return []; }
    }
  };
}

function templateFixture() {
  return {
    id: 51, templateCode: 'MIX-100', name: 'Mixer Technical Agreement', productModel: 'MIX-100',
    language: 'bilingual', isActive: true, currentPublishedRevisionId: 52,
    revisions: [{
      id: 52, revisionNo: 3, status: 'published',
      contentSchema: { schemaVersion: 1, sections: [{
        key: 'design_parameters', labelEn: 'Design Parameters', labelZh: '设计参数', enabled: true,
        sortOrder: 1, sectionType: 'parameter_table', bodyEn: 'Standard design', bodyZh: '标准设计',
        tableRows: [['Item', 'Value']], condition: { operator: 'always', variableKey: '', value: '' },
        defaultClauseIds: [], blocks: []
      }] },
      variables: [{
        variableKey: 'capacity', labelEn: 'Capacity', labelZh: '处理能力', dataType: 'number',
        sourceField: 'capacity', sectionKey: 'design_parameters', isRequired: true, defaultValue: '',
        validationRules: { min: 1, max: 100 }
      }]
    }]
  };
}

function createTechnicalRepositories(state) {
  return {
    technicalTemplateRepository: {
      async getTemplateDetail() { return templateFixture(); },
      async listClauses() { return []; }
    },
    opportunityTechnicalDraftRepository: {
      supportsVersionedTechnicalApproval: true,
      async getGenerationContext() {
        return { customerName: state.customer.name, contactName: state.contact.name, capacity: '' };
      },
      async createDraft(input) {
        state.technicalDraft = { id: 61, draftRevisionNo: 1, status: 'draft', assignments: [], ...input };
        return state.technicalDraft;
      },
      async addAssignment(input) {
        const assignment = { id: state.technicalDraft.assignments.length + 1, isActive: true, ...input };
        state.technicalDraft.assignments.push(assignment);
        return assignment;
      },
      async updateVariables(input) {
        Object.assign(state.technicalDraft, input);
        return state.technicalDraft;
      },
      async updateSection(input) {
        Object.assign(state.technicalDraft, input);
        return state.technicalDraft;
      },
      async markReady() { state.technicalDraft.status = 'ready'; return state.technicalDraft; },
      async findSubmissionCandidate(id, opportunityId) {
        return Number(id) === state.technicalDraft.id && Number(opportunityId) === state.opportunity.id
          ? state.technicalDraft : null;
      },
      async submitForApproval() { state.technicalDraft.status = 'pending'; state.technicalDraft.submittedBy = leadEngineer.id; return state.technicalDraft; },
      async approveLatestPending() {
        if (state.technicalDraft.status !== 'pending') return null;
        Object.assign(state.technicalDraft, { status: 'approved', formalVersionNo: 1, formalVersionLabel: 'TS-V1' });
        return state.technicalDraft;
      },
      async getDraftDetail() { return state.technicalDraft; },
      async saveApprovedDocuments(input) { state.technicalDraft.documents = input.documents; return input.documents; }
    }
  };
}

function createWorkflowRepositories(state, core, technical) {
  const settings = new Map([
    ['opportunity_initiation', { userId: salesManager.id }],
    ['technical_solution', { userId: technicalManager.id }],
    ['commercial_quote', { userId: commercialManager.id }]
  ]);
  return {
    ...core,
    ...technical,
    approvalSettingRepository: { async findActiveByKey(key) { return settings.get(key) || null; } },
    workflowEventRepository: {
      async create(input) { const record = { id: state.workflowEvents.length + 1, ...input }; state.workflowEvents.push(record); return record; }
    },
    todoRepository: {
      async create(input) { const record = { id: state.todos.length + 1, status: 'pending', ...input }; state.todos.push(record); return record; },
      async closePendingForOpportunity(opportunityId, status) {
        for (const todo of state.todos.filter((item) => item.opportunityId === opportunityId && item.status === 'pending')) todo.status = status;
      }
    },
    opportunityMaterialVersionRepository: {
      async createVersion(input) {
        const record = { id: 100 + state.materialVersions.length, versionNo: 1, ...input };
        state.materialVersions.push(record);
        return record;
      },
      async findLatestByOpportunityAndType(opportunityId, materialType) {
        return state.materialVersions.filter((item) => item.opportunityId === opportunityId && item.materialType === materialType).at(-1) || null;
      },
      async reviewVersion(input) {
        const record = state.materialVersions.find((item) => item.id === input.versionId);
        Object.assign(record, input);
        return record;
      }
    },
    technicalSolutionRepository: {
      async createVersion(input) { state.technicalSolution = { id: 71, versionNo: 1, status: 'pending', ...input }; return state.technicalSolution; },
      async reviewLatestPending(input) { Object.assign(state.technicalSolution, input); return state.technicalSolution; }
    },
    commercialQuoteRepository: {
      async createQuote(input) { state.commercialQuote = { id: 81, versionNo: 1, status: 'pending', ...input }; return state.commercialQuote; },
      async reviewLatestPending(input) { Object.assign(state.commercialQuote, input); return state.commercialQuote; }
    },
    technicalDocumentService: {
      async generateApprovedDocuments() {
        const content = Buffer.from('approved TS-V1 document');
        return [{ id: 72, originalName: 'TS-V1.pdf', mimeType: 'application/pdf', byteSize: content.length, sha256: sha256(content), content }];
      }
    }
  };
}

function createQuotationRepository(state) {
  const technicalContent = Buffer.from('approved TS-V1 document');
  const commercialContent = Buffer.from('approved commercial quote');
  return {
    supportsQuotationPackages: true,
    async listByOpportunity() { return state.packages; },
    async findCurrentSentByOpportunity() { return state.packages.find((item) => item.status === 'sent') || null; },
    async getPackageDetail(id) { return state.packages.find((item) => item.id === Number(id)) || null; },
    async getCreationContext() {
      const revision = state.packages.length ? 2 : 1;
      return {
        technicalSolution: { id: 71, status: 'approved', versionNo: 1 },
        commercialQuote: {
          id: 81, status: 'approved', versionNo: 1, totalPrice: revision === 1 ? 100000 : 105000,
          paymentTerms: '30/60/10', validityDate: '2026-12-31',
          items: [{ itemName: 'Mixer', specification: 'MIX-100', unit: 'set', quantity: 1, unitPrice: revision === 1 ? 100000 : 105000, subtotal: revision === 1 ? 100000 : 105000 }]
        },
        technicalDocuments: [{ id: 72, originalName: 'TS-V1.pdf', mimeType: 'application/pdf', byteSize: technicalContent.length, sha256: sha256(technicalContent) }],
        commercialAttachments: [{ id: 91, originalName: 'commercial-quote.pdf', storedPath: 'commercial-quote.pdf', mimeType: 'application/pdf', byteSize: commercialContent.length }]
      };
    },
    async createDraft(input) {
      const packageVersion = {
        id: 200 + state.packages.length, opportunityId: state.opportunity.id,
        draftRevisionNo: state.packages.length + 1, versionNo: null,
        label: `QP-D${state.packages.length + 1}`, status: 'draft', attachments: [], ...input
      };
      state.packages.push(packageVersion);
      state.packageAttachments.set(packageVersion.id, packageVersion.attachments);
      return packageVersion;
    },
    async addAttachmentSnapshot(input) {
      const attachment = { id: 300 + state.packageAttachments.get(input.quotationPackageId).length, ...input };
      state.packageAttachments.get(input.quotationPackageId).push(attachment);
      return attachment;
    },
    async submitDraft(input) {
      const item = state.packages.find((candidate) => candidate.id === input.packageId);
      if (!item?.attachments.length) return null;
      item.status = 'pending';
      return item;
    },
    async approvePending(input) {
      const item = state.packages.find((candidate) => candidate.id === input.packageId && candidate.status === 'pending');
      if (!item) return null;
      item.status = 'approved';
      item.versionNo = state.packages.filter((candidate) => candidate.versionNo).length + 1;
      item.label = `QP-V${item.versionNo}`;
      return item;
    },
    async markSent(input) {
      const item = state.packages.find((candidate) => candidate.id === input.packageId && candidate.status === 'approved');
      if (!item) return null;
      for (const previous of state.packages.filter((candidate) => candidate.status === 'sent')) previous.status = 'superseded';
      Object.assign(item, { status: 'sent', sentEmailMessageId: input.sentEmailMessageId });
      return item;
    },
    async acceptSent(input) {
      const item = state.packages.find((candidate) => candidate.id === input.packageId && candidate.status === 'sent');
      if (!item) return null;
      item.status = 'accepted';
      state.acceptedPackageId = item.id;
      return item;
    },
    async getEmailAttachmentSources(packageId) {
      return state.packageAttachments.get(Number(packageId)).map((item) => {
        const content = item.sourceType === 'technical_solution_document' ? technicalContent : commercialContent;
        return { ...item, content };
      });
    }
  };
}

function createEmailRepository(state) {
  let messageId = 400;
  return {
    async findThreadById(id) { return state.threads.find((item) => item.id === Number(id)) || null; },
    async findLatestThreadByOpportunity(id) { return state.threads.filter((item) => item.opportunityId === Number(id)).at(-1) || null; },
    async findLatestThreadByInquiry(id) { return state.threads.filter((item) => item.inquiryId === Number(id)).at(-1) || null; },
    async findThreadByReferences(references) {
      const message = state.messages.find((item) => references.includes(item.messageId));
      return message ? state.threads.find((item) => item.id === message.threadId) : null;
    },
    async findMessageIdentity(identity) { return state.messages.find((item) => item.messageId === identity.messageId) || null; },
    async createThread(input) { const thread = { id: state.threads.length + 1, ...input }; state.threads.push(thread); return thread; },
    async createOutboundMessage(input) { const message = { id: ++messageId, direction: 'outbound', ...input }; state.messages.push(message); return message; },
    async createInboundMessage(input) { const message = { id: ++messageId, direction: 'inbound', deliveryStatus: 'received', ...input }; state.messages.push(message); return message; },
    async findMessageById(id) { return state.messages.find((item) => item.id === Number(id)) || null; },
    async getThreadDetail(id) { return { ...(await this.findThreadById(id)), messages: state.messages.filter((item) => item.threadId === Number(id)) }; },
    async touchThread(id, lastMessageAt) { const thread = await this.findThreadById(id); thread.lastMessageAt = lastMessageAt; return thread; },
    async createAttachment(input) { const attachment = { id: state.emailAttachments.length + 1, ...input }; state.emailAttachments.push(attachment); return attachment; },
    async listAttachmentsByMessage(id) { return state.emailAttachments.filter((item) => item.messageId === Number(id)); },
    async claimOutboundForSend(id) {
      const message = await this.findMessageById(id);
      if (!message || !['draft', 'failed'].includes(message.deliveryStatus)) return null;
      message.deliveryStatus = 'pending';
      return message;
    },
    async completeOutboundDelivery(input) {
      const message = await this.findMessageById(input.messageId);
      if (message?.deliveryStatus !== 'pending') return null;
      Object.assign(message, { deliveryStatus: input.status, providerMessageId: input.providerMessageId || '', sentAt: input.sentAt || null });
      return message;
    },
    async createDeliveryAttempt(input) { const attempt = { id: state.deliveryAttempts.length + 1, ...input }; state.deliveryAttempts.push(attempt); return attempt; }
  };
}

test('release candidate completes lead-to-inquiry-to-engineering-to-QP-V2-email-reply-and-acceptance', async () => {
  const state = createAcceptanceState();
  const core = createCoreRepositories(state);
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-release-e2e-'));
  try {
    const inquiry = await submitSalesLead(core, sales, {
      submissionToken: '123e4567-e89b-12d3-a456-426614174000', assignedUserId: salesManager.id,
      sourceChannel: 'exhibition', companyName: 'Global Process Ltd', contactName: 'Jane Buyer',
      contactEmail: 'buyer@example.com', productInterest: 'Mixer', opportunityType: 'New plant',
      requirementText: 'Need a 50 t/h mixing line', priority: 'high'
    });
    assert.equal(inquiry.status, 'new');
    const opportunity = await convertInquiryToOpportunity(core, salesManager, inquiry, {
      salespersonId: sales.id, newCustomerName: 'Global Process Ltd', newContactName: 'Jane Buyer',
      newContactEmail: 'buyer@example.com', title: 'Global Mixer Project'
    });
    assert.equal(state.inquiry.status, 'converted');
    assert.equal(opportunity.originInquiryId, inquiry.id);

    const technical = createTechnicalRepositories(state);
    const workflow = createWorkflowRepositories(state, core, technical);
    await applyWorkflowAction({ actor: sales, opportunityId: opportunity.id, action: ACTIONS.SUBMIT_INITIATION, repositories: workflow });
    await applyWorkflowAction({ actor: salesManager, opportunityId: opportunity.id, action: ACTIONS.APPROVE_INITIATION, payload: { quotationEngineerId: leadEngineer.id, technicalPlanSubmitDate: '2026-09-15' }, repositories: workflow });
    state.opportunity.teamMembers = [{ id: 1, userId: supportEngineer.id, roleCode: ROLES.QUOTATION_ENGINEER, isActive: true, canSendExternalEmail: false }];
    const draft = await generateOpportunityTechnicalDraft(technical, leadEngineer, state.opportunity, 51);
    await assignOpportunityTechnicalDraftSection(technical.opportunityTechnicalDraftRepository, leadEngineer, state.opportunity, draft, {
      sectionKey: 'design_parameters', assigneeUserId: supportEngineer.id, dueDate: '2026-09-15'
    });
    await updateOpportunityTechnicalDraftSection(technical.opportunityTechnicalDraftRepository, supportEngineer, state.opportunity, state.technicalDraft, 'design_parameters', {
      bodyEn: 'Project capacity: 50 t/h', bodyZh: '项目处理能力：50 吨/小时', tableRows: 'Capacity | 50 t/h'
    });
    await updateOpportunityTechnicalDraftVariables(technical.opportunityTechnicalDraftRepository, leadEngineer, state.opportunity, state.technicalDraft, { capacity: '50' });
    await markOpportunityTechnicalDraftReady(technical.opportunityTechnicalDraftRepository, leadEngineer, state.opportunity, state.technicalDraft);
    await applyWorkflowAction({ actor: leadEngineer, opportunityId: opportunity.id, action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION, payload: { technicalDraftId: draft.id }, repositories: workflow });
    await applyWorkflowAction({ actor: technicalManager, opportunityId: opportunity.id, action: ACTIONS.APPROVE_TECHNICAL_SOLUTION, payload: { comment: 'Approved TS-V1' }, repositories: workflow });
    await applyWorkflowAction({ actor: leadEngineer, opportunityId: opportunity.id, action: ACTIONS.SUBMIT_COMMERCIAL_QUOTE, repositories: workflow });
    await applyWorkflowAction({ actor: commercialManager, opportunityId: opportunity.id, action: ACTIONS.APPROVE_COMMERCIAL_QUOTE, payload: { comment: 'Approved commercial quote' }, repositories: workflow });
    assert.equal(state.opportunity.status, STATUSES.CUSTOMER_NEGOTIATION);
    assert.equal(state.technicalDraft.formalVersionLabel, 'TS-V1');

    const quotationPackageRepository = createQuotationRepository(state);
    const quotationDependencies = {
      quotationPackageRepository,
      quotationPackageFileReader: async () => Buffer.from('approved commercial quote')
    };
    const packageInput = {
      technicalSolutionVersionId: 71, commercialQuoteId: 81, currency: 'USD',
      deliveryPeriod: '16 weeks', inclusions: 'Mixer and controls', exclusions: 'Civil works'
    };
    const q1Draft = await createQuotationPackageDraft(quotationDependencies, sales, state.opportunity, packageInput);
    const q1Pending = await submitQuotationPackage(quotationPackageRepository, sales, state.opportunity, q1Draft, 'Submit V1');
    const q1Approved = await reviewQuotationPackage(quotationPackageRepository, commercialManager, state.opportunity, q1Pending, 'approve', 'Approve V1');

    const emailArchiveRepository = createEmailRepository(state);
    const emailDependencies = {
      emailArchiveRepository, quotationPackageRepository, inquiryRepository: core.inquiryRepository,
      opportunityRepository: core.opportunityRepository,
      opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return state.opportunity.teamMembers; } },
      transport: { async sendMail(message) { state.sentMail.push(message); return { messageId: message.messageId }; } },
      sharedAddress: 'sales@sunkaier.com', uploadDir, maxUploadMb: 25,
      now: () => '2026-09-03T12:00:00.000Z', randomUUID: () => `00000000-0000-4000-8000-00000000000${state.sentMail.length + 1}`
    };
    await createCustomerEmailDraft(emailDependencies, sales, {
      opportunityId: opportunity.id, quotationPackageVersionId: q1Approved.id, to: 'buyer@example.com',
      subject: 'Mixer quotation QP-V1', body: 'Please review our first quotation.', action: 'send'
    });
    assert.equal(q1Approved.status, 'sent');

    const q2Draft = await createQuotationPackageDraft(quotationDependencies, sales, state.opportunity, {
      ...packageInput, sourcePackageId: q1Approved.id, deliveryPeriod: '14 weeks',
      revisionReason: 'Customer requested shorter delivery', changeSummary: 'Delivery improved to 14 weeks'
    });
    const q2Pending = await submitQuotationPackage(quotationPackageRepository, sales, state.opportunity, q2Draft, 'Submit V2');
    const q2Approved = await reviewQuotationPackage(quotationPackageRepository, commercialManager, state.opportunity, q2Pending, 'approve', 'Approve V2');
    const sentV2 = await createCustomerEmailDraft(emailDependencies, sales, {
      opportunityId: opportunity.id, quotationPackageVersionId: q2Approved.id, to: 'buyer@example.com', cc: 'procurement@example.com',
      subject: 'Mixer quotation QP-V2', body: 'Please review our revised quotation.', action: 'send'
    });
    assert.equal(q1Approved.status, 'superseded');
    assert.equal(q2Approved.status, 'sent');
    assert.equal(state.sentMail.at(-1).from.address, 'sales@sunkaier.com');

    const reply = await archiveInboundEmailRecord({ emailArchiveRepository, inquiryRepository: core.inquiryRepository }, {
      message: {
        mailboxKey: 'sales@sunkaier.com', messageId: '<buyer-acceptance@example.com>',
        replyReferenceIds: [sentV2.messageId], providerMailbox: 'INBOX', providerUidValidity: '1', providerUid: 99,
        fromAddress: 'buyer@example.com', fromName: 'Jane Buyer', toRecipients: [{ address: 'sales@sunkaier.com' }],
        ccRecipients: [], subject: 'Re: Mixer quotation QP-V2', normalizedSubject: 'mixer quotation qp-v2',
        textBody: 'QP-V2 accepted. Please proceed.', htmlBody: '', safeHeaders: {}, receivedAt: '2026-09-03T13:00:00.000Z'
      },
      inquiry: { requirementText: 'unused because reply matches the opportunity thread' }
    });
    assert.equal(reply.thread.opportunityId, opportunity.id);
    const accepted = await acceptQuotationPackage(quotationPackageRepository, sales, state.opportunity, q2Approved, 'Customer accepted by archived reply');
    assert.equal(accepted.status, 'accepted');
    assert.equal(state.acceptedPackageId, q2Approved.id);
    assert.equal(state.packages.map((item) => item.label).join(','), 'QP-V1,QP-V2');
    assert.equal(state.deliveryAttempts.length, 2);
    assert.ok(state.workflowEvents.length >= 6);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
