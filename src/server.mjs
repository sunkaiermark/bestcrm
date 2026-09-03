import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createPool } from './db/pool.mjs';
import { createSessionStore } from './db/sessionStore.mjs';
import { createWorkflowTransaction } from './db/workflowTransaction.mjs';
import { attachCurrentUser } from './middleware/auth.mjs';
import { csrfProtection } from './middleware/csrf.mjs';
import { createAttachmentRepository } from './repositories/attachmentRepository.mjs';
import { createApprovalSettingRepository } from './repositories/approvalSettingRepository.mjs';
import { createCommercialQuoteRepository } from './repositories/commercialQuoteRepository.mjs';
import { createContractApprovalRepository } from './repositories/contractApprovalRepository.mjs';
import { createContactRepository } from './repositories/contactRepository.mjs';
import { createCustomerRepository } from './repositories/customerRepository.mjs';
import { createEmailArchiveRepository } from './repositories/emailArchiveRepository.mjs';
import { createInquiryAttachmentRepository } from './repositories/inquiryAttachmentRepository.mjs';
import { createInquiryCustomerApprovalRepository } from './repositories/inquiryCustomerApprovalRepository.mjs';
import { createInquiryRepository } from './repositories/inquiryRepository.mjs';
import { createLoginSecurityRepository } from './repositories/loginSecurityRepository.mjs';
import { createNotificationRepository } from './repositories/notificationRepository.mjs';
import { createOpportunityMaterialVersionRepository } from './repositories/opportunityMaterialVersionRepository.mjs';
import { createOpportunityRepository } from './repositories/opportunityRepository.mjs';
import { createOpportunityResponsibilityRepository } from './repositories/opportunityResponsibilityRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from './repositories/opportunityTechnicalDraftRepository.mjs';
import { createQuotationPackageRepository } from './repositories/quotationPackageRepository.mjs';
import { createRequirementUpdateRepository } from './repositories/requirementUpdateRepository.mjs';
import { createRoleRepository } from './repositories/roleRepository.mjs';
import { createSalesWorkRepository } from './repositories/salesWorkRepository.mjs';
import { createTechnicalSolutionRepository } from './repositories/technicalSolutionRepository.mjs';
import { createTechnicalTemplateRepository } from './repositories/technicalTemplateRepository.mjs';
import { createTodoRepository } from './repositories/todoRepository.mjs';
import { createUserRepository } from './repositories/userRepository.mjs';
import { createWorkbenchRepository } from './repositories/workbenchRepository.mjs';
import { createWorkflowEventRepository } from './repositories/workflowEventRepository.mjs';
import { accountRoutes } from './routes/accountRoutes.mjs';
import { authRoutes } from './routes/authRoutes.mjs';
import { contactRoutes } from './routes/contactRoutes.mjs';
import { customerRoutes } from './routes/customerRoutes.mjs';
import { emailCenterRoutes } from './routes/emailCenterRoutes.mjs';
import { inquiryIntakeRoutes } from './routes/inquiryIntakeRoutes.mjs';
import { inquiryRoutes } from './routes/inquiryRoutes.mjs';
import { leadSubmissionRoutes } from './routes/leadSubmissionRoutes.mjs';
import { notificationRoutes } from './routes/notificationRoutes.mjs';
import { opportunityRoutes } from './routes/opportunityRoutes.mjs';
import { opportunityTechnicalDraftRoutes } from './routes/opportunityTechnicalDraftRoutes.mjs';
import { quotationPackageRoutes } from './routes/quotationPackageRoutes.mjs';
import { salesWorkRoutes } from './routes/salesWorkRoutes.mjs';
import { systemRoutes } from './routes/systemRoutes.mjs';
import { technicalTemplateRoutes } from './routes/technicalTemplateRoutes.mjs';
import { workbenchRoutes } from './routes/workbenchRoutes.mjs';
import { createMessageLabeler, createStatusLabeler, createTodoTitleLabeler, createTranslator, createWorkflowEventLabeler, inferLanguageFromAcceptLanguage, normalizeLanguage } from './utils/i18n.mjs';
import { isMainModule } from './utils/moduleEntry.mjs';
import { createLoginSecurityService } from './services/loginSecurityService.mjs';
import { createSmsSecondFactorService } from './services/smsSecondFactorService.mjs';
import { createTechnicalDocumentService } from './services/technicalDocumentService.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const emptyUserRepository = {
  async findByIdWithRoles() {
    return null;
  },
  async findByUsernameWithRoles() {
    return null;
  },
  async listUsersWithRoles() {
    return [];
  },
  async createUser() {
    throw new Error('User repository is not configured');
  },
  async updateUser() {
    throw new Error('User repository is not configured');
  },
  async changePassword() {
    throw new Error('User repository is not configured');
  },
  async deactivateUser() {
    throw new Error('User repository is not configured');
  },
  async listUsersByRole() {
    return [];
  }
};

const emptyRoleRepository = {
  async listRoles() {
    return [];
  },
  async listActiveRoles() {
    return [];
  },
  async findById() {
    return null;
  },
  async createRole() {
    throw new Error('Role repository is not configured');
  },
  async updateRole() {
    throw new Error('Role repository is not configured');
  },
  async deactivateRole() {
    throw new Error('Role repository is not configured');
  }
};

const emptyApprovalSettingRepository = {
  async listApprovalSettings() {
    return [];
  },
  async findById() {
    return null;
  },
  async findActiveByKey() {
    return null;
  },
  async createApprovalSetting() {
    throw new Error('Approval setting repository is not configured');
  },
  async updateApprovalSetting() {
    throw new Error('Approval setting repository is not configured');
  },
  async deactivateApprovalSetting() {
    throw new Error('Approval setting repository is not configured');
  }
};

const emptyCustomerRepository = {
  async listCustomers() {
    return [];
  },
  async getCustomerDetail() {
    return null;
  },
  async createCustomer() {
    throw new Error('Customer repository is not configured');
  },
  async updateCustomer() {
    throw new Error('Customer repository is not configured');
  },
  async deleteById() {
    throw new Error('Customer repository is not configured');
  }
};

const emptyContactRepository = {
  async listContacts() {
    return [];
  },
  async getContactDetail() {
    return null;
  },
  async createContact() {
    throw new Error('Contact repository is not configured');
  },
  async updateContact() {
    throw new Error('Contact repository is not configured');
  },
  async deleteById() {
    throw new Error('Contact repository is not configured');
  }
};

const emptyInquiryRepository = {
  async listInquiries() {
    return [];
  },
  async findById() {
    return null;
  },
  async createInquiry() {
    throw new Error('Inquiry repository is not configured');
  },
  async updateReview() {
    throw new Error('Inquiry repository is not configured');
  },
  async markConverted() {
    throw new Error('Inquiry repository is not configured');
  },
  async markDisposition() {
    throw new Error('Inquiry repository is not configured');
  },
  async deleteById() {
    throw new Error('Inquiry repository is not configured');
  }
};

const emptyInquiryAttachmentRepository = {
  async listByInquiry() {
    return [];
  },
  async findById() {
    return null;
  },
  async createAttachment() {
    throw new Error('Inquiry attachment repository is not configured');
  }
};

const emptyInquiryCustomerApprovalRepository = {
  async findById() { return null; },
  async findLatestByInquiry() { return null; },
  async createPending() { throw new Error('Inquiry customer approval repository is not configured'); },
  async completeApproval() { throw new Error('Inquiry customer approval repository is not configured'); },
  async rejectAndReturnInquiry() { return false; }
};

const emptyAttachmentRepository = {
  async listByOpportunity() {
    return [];
  },
  async createAttachment() {
    throw new Error('Attachment repository is not configured');
  },
  async deleteById() {
    throw new Error('Attachment repository is not configured');
  },
  async findById() {
    return null;
  }
};

const emptyCommercialQuoteRepository = {
  async listByOpportunity() {
    return [];
  },
  async createQuote() {
    throw new Error('Commercial quote repository is not configured');
  },
  async reviewLatestPending() {
    throw new Error('Commercial quote repository is not configured');
  }
};

const emptyTechnicalSolutionRepository = {
  async listByOpportunity() {
    return [];
  },
  async createVersion() {
    throw new Error('Technical solution repository is not configured');
  },
  async reviewLatestPending() {
    throw new Error('Technical solution repository is not configured');
  },
  async withdrawLatestPending() {
    throw new Error('Technical solution repository is not configured');
  }
};

const emptyRequirementUpdateRepository = {
  async listByOpportunity() {
    return [];
  },
  async create() {
    throw new Error('Requirement update repository is not configured');
  }
};

const emptyOpportunityMaterialVersionRepository = {
  async listByOpportunity() {
    return [];
  }
};

const emptyContractApprovalRepository = {
  async createApproval() {
    throw new Error('Contract approval repository is not configured');
  },
  async listByOpportunity() {
    return [];
  },
  async findActiveByOpportunity() {
    return null;
  },
  async approveActive() {
    throw new Error('Contract approval repository is not configured');
  },
  async rejectActive() {
    throw new Error('Contract approval repository is not configured');
  }
};

const emptyOpportunityRepository = {
  async listOpportunities() {
    return [];
  },
  async getOpportunityDetail() {
    return null;
  },
  async createOpportunity() {
    throw new Error('Opportunity repository is not configured');
  },
  async updateOpportunity() {
    throw new Error('Opportunity repository is not configured');
  },
  async deleteById() {
    throw new Error('Opportunity repository is not configured');
  },
  async findById() {
    return null;
  },
  async updateWorkflowState() {
    throw new Error('Opportunity repository is not configured');
  }
};

const emptyOpportunityResponsibilityRepository = {
  async listTeamMembersByOpportunity() {
    return [];
  },
  async listTeamMemberEventsByOpportunity() {
    return [];
  },
  async listEngineeringContributionsByOpportunity() {
    return [];
  },
  async listOwnerTransfersByOpportunity() {
    return [];
  }
};

const emptyOpportunityTechnicalDraftRepository = {
  async getGenerationContext() { return null; },
  async listByOpportunity() { return []; },
  async getDraftDetail() { return null; },
  async findSubmissionCandidate() { return null; },
  async findDocument() { return null; },
  async createDraft() { throw new Error('Opportunity technical draft repository is not configured'); },
  async updateVariables() { throw new Error('Opportunity technical draft repository is not configured'); },
  async updateSection() { throw new Error('Opportunity technical draft repository is not configured'); },
  async updateClauses() { throw new Error('Opportunity technical draft repository is not configured'); },
  async addAssignment() { throw new Error('Opportunity technical draft repository is not configured'); },
  async removeAssignment() { throw new Error('Opportunity technical draft repository is not configured'); },
  async markReady() { throw new Error('Opportunity technical draft repository is not configured'); },
  async submitForApproval() { throw new Error('Opportunity technical draft repository is not configured'); },
  async withdrawLatestPending() { throw new Error('Opportunity technical draft repository is not configured'); },
  async approveLatestPending() { throw new Error('Opportunity technical draft repository is not configured'); },
  async rejectLatestPending() { throw new Error('Opportunity technical draft repository is not configured'); },
  async cloneRejectedDraft() { throw new Error('Opportunity technical draft repository is not configured'); },
  async saveApprovedDocuments() { throw new Error('Opportunity technical draft repository is not configured'); }
};

const emptyQuotationPackageRepository = {
  supportsQuotationPackages: false,
  async listByOpportunity() { return []; },
  async getPackageDetail() { return null; },
  async listApprovedTechnicalSolutions() { return []; },
  async listApprovedCommercialQuotes() { return []; },
  async findCurrentSentByOpportunity() { return null; },
  async findAcceptedByOpportunity() { return null; },
  async getCreationContext() { return null; },
  async createDraft() { throw new Error('Quotation package repository is not configured'); },
  async addAttachmentSnapshot() { throw new Error('Quotation package repository is not configured'); },
  async updateDraft() { throw new Error('Quotation package repository is not configured'); },
  async replaceAttachmentSnapshots() { throw new Error('Quotation package repository is not configured'); },
  async submitDraft() { throw new Error('Quotation package repository is not configured'); },
  async approvePending() { throw new Error('Quotation package repository is not configured'); },
  async rejectPending() { throw new Error('Quotation package repository is not configured'); },
  async markSent() { throw new Error('Quotation package repository is not configured'); },
  async acceptSent() { throw new Error('Quotation package repository is not configured'); }
};

const emptyEmailArchiveRepository = {
  supportsEmailArchive: false,
  async listThreads() { return []; },
  async findThreadById() { return null; },
  async getThreadDetail() { return null; },
  async findMessageById() { return null; },
  async findMessageIdentity() { return null; },
  async findThreadByReferences() { return null; },
  async findAttachmentById() { return null; },
  async listAttachmentsByMessage() { return []; },
  async createThread() { throw new Error('Email archive repository is not configured'); },
  async createInboundMessage() { throw new Error('Email archive repository is not configured'); },
  async createAttachment() { throw new Error('Email archive repository is not configured'); },
  async touchThread() { throw new Error('Email archive repository is not configured'); },
  async createDeliveryAttempt() { throw new Error('Email archive repository is not configured'); }
};

const emptyWorkflowEventRepository = {
  async listByOpportunity() {
    return [];
  },
  async create() {
    throw new Error('Workflow event repository is not configured');
  }
};

const emptyTodoRepository = {
  async listByOpportunity() {
    return [];
  },
  async create() {
    throw new Error('Todo repository is not configured');
  },
  async closePendingForOpportunity() {
    throw new Error('Todo repository is not configured');
  },
  async closePendingForOpportunityAndAssignee() {
    throw new Error('Todo repository is not configured');
  }
};

const emptyWorkbenchRepository = {
  async listPendingTodos() {
    return [];
  },
  async listRecentWorkflowMessages() {
    return [];
  },
  async countByWorkflowState() {
    return [];
  }
};

const emptySalesWorkRepository = {
  async listPlans() {
    return [];
  },
  async findPlanById() {
    return null;
  },
  async createPlan() {
    throw new Error('Sales work repository is not configured');
  },
  async updatePlan() {
    throw new Error('Sales work repository is not configured');
  },
  async updatePlanStatus() {
    throw new Error('Sales work repository is not configured');
  },
  async listLogs() {
    return [];
  },
  async createLog() {
    throw new Error('Sales work repository is not configured');
  },
  async updateLog() {
    throw new Error('Sales work repository is not configured');
  },
  async summarizeSalesWork() {
    return [];
  }
};

const emptyLoginSecurityRepository = {
  async findStates() {
    return [];
  },
  async recordFailedAttempt() {},
  async resetAttempts() {},
  async recordAuditEvent() {}
};

const emptyNotificationRepository = {
  async listForUser() { return []; },
  async listAfterId() { return []; },
  async countUnread() { return 0; },
  async markRead() { return null; },
  async markAllRead() { return 0; },
  async getPreference(userId) {
    return {
      userId: Number(userId),
      realtimeEnabled: true,
      webPushEnabled: true,
      emailEnabled: true,
      smsEnabled: true,
      emailDelayMinutes: 15
    };
  },
  async savePreference(userId, preference) { return { userId: Number(userId), ...preference }; },
  async upsertPushSubscription() { return { id: 0 }; },
  async revokePushSubscription() { return 0; }
};

const emptyTechnicalTemplateRepository = {
  async listTemplates() { return []; },
  async getTemplateDetail() { return null; },
  async findRevisionById() { return null; },
  async updateRevisionContent() { throw new Error('Technical template repository is not configured'); },
  async listVariableDefinitions() { return []; },
  async findVariableDefinitionById() { return null; },
  async listClauses() { return []; },
  async findClauseById() { return null; },
  async createTemplate() { throw new Error('Technical template repository is not configured'); },
  async updateTemplate() { throw new Error('Technical template repository is not configured'); },
  async createRevision() { throw new Error('Technical template repository is not configured'); },
  async submitRevision() { throw new Error('Technical template repository is not configured'); },
  async publishRevision() { throw new Error('Technical template repository is not configured'); },
  async retireRevision() { throw new Error('Technical template repository is not configured'); },
  async upsertRevisionVariable() { throw new Error('Technical template repository is not configured'); },
  async removeRevisionVariable() { throw new Error('Technical template repository is not configured'); },
  async createVariableDefinition() { throw new Error('Technical template repository is not configured'); },
  async updateVariableDefinition() { throw new Error('Technical template repository is not configured'); },
  async deactivateVariableDefinition() { throw new Error('Technical template repository is not configured'); },
  async createClause() { throw new Error('Technical template repository is not configured'); },
  async updateClause() { throw new Error('Technical template repository is not configured'); },
  async createClauseRevision() { throw new Error('Technical template repository is not configured'); },
  async submitClause() { throw new Error('Technical template repository is not configured'); },
  async publishClause() { throw new Error('Technical template repository is not configured'); },
  async retireClause() { throw new Error('Technical template repository is not configured'); }
};

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const shouldCreatePool = !options.userRepository && config.databaseUrl;
  const pool = options.pool || (shouldCreatePool ? createPool(config) : null);
  const userRepository = options.userRepository || (pool ? createUserRepository(pool) : emptyUserRepository);
  const loginSecurityRepository = options.loginSecurityRepository || (pool ? createLoginSecurityRepository(pool) : emptyLoginSecurityRepository);
  const notificationRepository = options.notificationRepository || (pool ? createNotificationRepository(pool) : emptyNotificationRepository);
  const loginSecurityService = options.loginSecurityService || createLoginSecurityService(loginSecurityRepository);
  const smsSecondFactorService = options.smsSecondFactorService || createSmsSecondFactorService({
    config: config.loginSecondFactor,
    secret: config.sessionSecret
  });
  const roleRepository = options.roleRepository || (pool ? createRoleRepository(pool) : emptyRoleRepository);
  const approvalSettingRepository = options.approvalSettingRepository || (pool ? createApprovalSettingRepository(pool) : emptyApprovalSettingRepository);
  const customerRepository = options.customerRepository || (pool ? createCustomerRepository(pool) : emptyCustomerRepository);
  const contactRepository = options.contactRepository || (pool ? createContactRepository(pool) : emptyContactRepository);
  const inquiryRepository = options.inquiryRepository || (pool ? createInquiryRepository(pool) : emptyInquiryRepository);
  const emailArchiveRepository = options.emailArchiveRepository
    || (pool ? createEmailArchiveRepository(pool) : emptyEmailArchiveRepository);
  const inquiryAttachmentRepository = options.inquiryAttachmentRepository || (pool
    ? createInquiryAttachmentRepository(pool)
    : emptyInquiryAttachmentRepository);
  const inquiryCustomerApprovalRepository = options.inquiryCustomerApprovalRepository || (pool
    ? createInquiryCustomerApprovalRepository(pool)
    : emptyInquiryCustomerApprovalRepository);
  const attachmentRepository = options.attachmentRepository || (pool ? createAttachmentRepository(pool) : emptyAttachmentRepository);
  const commercialQuoteRepository = options.commercialQuoteRepository || (pool ? createCommercialQuoteRepository(pool) : emptyCommercialQuoteRepository);
  const technicalSolutionRepository = options.technicalSolutionRepository || (pool ? createTechnicalSolutionRepository(pool) : emptyTechnicalSolutionRepository);
  const requirementUpdateRepository = options.requirementUpdateRepository || (pool ? createRequirementUpdateRepository(pool) : emptyRequirementUpdateRepository);
  const opportunityMaterialVersionRepository = options.opportunityMaterialVersionRepository
    || (pool ? createOpportunityMaterialVersionRepository(pool) : emptyOpportunityMaterialVersionRepository);
  const contractApprovalRepository = options.contractApprovalRepository || (pool ? createContractApprovalRepository(pool) : emptyContractApprovalRepository);
  const opportunityRepository = options.opportunityRepository || (pool ? createOpportunityRepository(pool) : emptyOpportunityRepository);
  const opportunityResponsibilityRepository = options.opportunityResponsibilityRepository
    || (pool ? createOpportunityResponsibilityRepository(pool) : emptyOpportunityResponsibilityRepository);
  const opportunityTechnicalDraftRepository = options.opportunityTechnicalDraftRepository
    || (pool ? createOpportunityTechnicalDraftRepository(pool) : emptyOpportunityTechnicalDraftRepository);
  const quotationPackageRepository = options.quotationPackageRepository
    || (pool ? createQuotationPackageRepository(pool) : emptyQuotationPackageRepository);
  const workflowEventRepository = options.workflowEventRepository || (pool ? createWorkflowEventRepository(pool) : emptyWorkflowEventRepository);
  const todoRepository = options.todoRepository || (pool ? createTodoRepository(pool) : emptyTodoRepository);
  const workbenchRepository = options.workbenchRepository || (pool ? createWorkbenchRepository(pool) : emptyWorkbenchRepository);
  const salesWorkRepository = options.salesWorkRepository || (pool ? createSalesWorkRepository(pool) : emptySalesWorkRepository);
  const technicalTemplateRepository = options.technicalTemplateRepository
    || (pool ? createTechnicalTemplateRepository(pool) : emptyTechnicalTemplateRepository);
  const technicalDocumentService = options.technicalDocumentService
    || createTechnicalDocumentService({ fontPath: config.technicalDocumentFontPath });
  const workflowTransaction = 'workflowTransaction' in options
    ? options.workflowTransaction
    : pool ? createWorkflowTransaction(pool) : null;
  const sessionStore = 'sessionStore' in options ? options.sessionStore : createSessionStore(pool);
  const app = express();
  app.set('trust proxy', 'loopback');
  const configuredWebPushPublicKey = config.notificationDelivery?.webPush?.publicKey
    && config.notificationDelivery?.webPush?.privateKey
    ? config.notificationDelivery.webPush.publicKey
    : '';

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(dirname, 'views'));
  app.use('/assets', express.static(path.join(dirname, 'public', 'assets')));
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/service-worker.js', (req, res) => {
    res.type('application/javascript').sendFile(path.join(dirname, 'public', 'service-worker.js'));
  });
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({
    verify(req, res, buf) {
      req.rawBody = Buffer.from(buf);
    }
  }));
  app.use(inquiryIntakeRoutes({
    inquiryRepository,
    intakeSecret: config.inquiryIntakeSecret,
    chatwootIntakeSecret: config.chatwootInquiryIntakeSecret,
    now: options.inquiryIntakeNow
  }));
  app.use(session({
    name: 'bestcrm.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.sessionCookieSecure
    }
  }));
  app.use(csrfProtection({
    enabled: 'csrfProtection' in options ? options.csrfProtection : config.nodeEnv === 'production'
  }));
  app.use((req, res, next) => {
    const language = req.session.language
      ? normalizeLanguage(req.session.language)
      : inferLanguageFromAcceptLanguage(req.headers['accept-language']);
    req.language = language;
    res.locals.language = language;
    res.locals.currentPath = req.originalUrl || req.url || '/workbench';
    res.locals.t = createTranslator(language);
    res.locals.statusLabel = createStatusLabeler(language);
    res.locals.workflowEventLabel = createWorkflowEventLabeler(language);
    res.locals.messageLabel = createMessageLabeler(language);
    res.locals.todoTitleLabel = createTodoTitleLabeler(language);
    res.locals.webPushPublicKey = configuredWebPushPublicKey;
    res.locals.emailCenterEnabled = Boolean(config.emailCenter?.enabled);
    next();
  });
  app.use(attachCurrentUser(userRepository));
  app.get('/', (req, res) => {
    res.redirect('/workbench');
  });
  app.use(authRoutes(userRepository, { loginSecurityService, smsSecondFactorService }));
  app.use(accountRoutes({ userRepository, loginSecurityRepository }));
  app.use(workbenchRoutes({ workbenchRepository }));
  app.use(notificationRoutes({
    notificationRepository,
    webPushPublicKey: configuredWebPushPublicKey
  }));
  app.use(systemRoutes({ userRepository, roleRepository, approvalSettingRepository, loginSecurityRepository }));
  app.use(technicalTemplateRoutes({ technicalTemplateRepository }));
  app.use(customerRoutes({ customerRepository }));
  app.use(contactRoutes({ customerRepository, contactRepository }));
  app.use(leadSubmissionRoutes({
    inquiryRepository,
    inquiryAttachmentRepository,
    userRepository,
    uploadDir: config.uploadDir,
    maxUploadMb: config.maxUploadMb
  }));
  app.use(inquiryRoutes({
    inquiryRepository,
    inquiryAttachmentRepository,
    inquiryCustomerApprovalRepository,
    customerRepository,
    contactRepository,
    opportunityRepository,
    attachmentRepository,
    approvalSettingRepository,
    userRepository,
    uploadDir: config.uploadDir
  }));
  app.use(emailCenterRoutes({
    enabled: Boolean(config.emailCenter?.enabled),
    emailArchiveRepository,
    opportunityRepository,
    opportunityResponsibilityRepository,
    uploadDir: config.uploadDir
  }));
  app.use(salesWorkRoutes({
    salesWorkRepository,
    customerRepository,
    contactRepository,
    opportunityRepository
  }));
  app.use(opportunityTechnicalDraftRoutes({
    opportunityRepository,
    opportunityResponsibilityRepository,
    technicalTemplateRepository,
    opportunityTechnicalDraftRepository,
    approvalSettingRepository,
    attachmentRepository,
    commercialQuoteRepository,
    contractApprovalRepository,
    opportunityMaterialVersionRepository,
    technicalSolutionRepository,
    technicalDocumentService,
    todoRepository,
    workflowEventRepository,
    workflowTransaction,
    workflowAction: options.workflowAction
  }));
  app.use(quotationPackageRoutes({
    opportunityRepository,
    opportunityResponsibilityRepository,
    quotationPackageRepository,
    workflowTransaction,
    quotationPackageFileReader: options.quotationPackageFileReader
  }));
  app.use(opportunityRoutes({
    customerRepository,
    contactRepository,
    attachmentRepository,
    commercialQuoteRepository,
    technicalSolutionRepository,
    opportunityTechnicalDraftRepository,
    quotationPackageRepository,
    technicalDocumentService,
    requirementUpdateRepository,
    opportunityMaterialVersionRepository,
    contractApprovalRepository,
    opportunityResponsibilityRepository,
    approvalSettingRepository,
    opportunityRepository,
    userRepository,
    workflowEventRepository,
    todoRepository,
    workflowTransaction,
    uploadDir: config.uploadDir,
    maxUploadMb: config.maxUploadMb
  }));

  app.get('/health', (req, res) => {
    res.json({ ok: true, app: 'BESTCRM' });
  });

  return app;
}

if (isMainModule(import.meta.url)) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`BESTCRM listening on ${config.baseUrl}`);
  });
}
