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
import { createLoginSecurityRepository } from './repositories/loginSecurityRepository.mjs';
import { createOpportunityMaterialVersionRepository } from './repositories/opportunityMaterialVersionRepository.mjs';
import { createOpportunityRepository } from './repositories/opportunityRepository.mjs';
import { createOpportunityResponsibilityRepository } from './repositories/opportunityResponsibilityRepository.mjs';
import { createRequirementUpdateRepository } from './repositories/requirementUpdateRepository.mjs';
import { createRoleRepository } from './repositories/roleRepository.mjs';
import { createSalesWorkRepository } from './repositories/salesWorkRepository.mjs';
import { createTechnicalSolutionRepository } from './repositories/technicalSolutionRepository.mjs';
import { createTodoRepository } from './repositories/todoRepository.mjs';
import { createUserRepository } from './repositories/userRepository.mjs';
import { createWorkbenchRepository } from './repositories/workbenchRepository.mjs';
import { createWorkflowEventRepository } from './repositories/workflowEventRepository.mjs';
import { authRoutes } from './routes/authRoutes.mjs';
import { contactRoutes } from './routes/contactRoutes.mjs';
import { customerRoutes } from './routes/customerRoutes.mjs';
import { opportunityRoutes } from './routes/opportunityRoutes.mjs';
import { salesWorkRoutes } from './routes/salesWorkRoutes.mjs';
import { systemRoutes } from './routes/systemRoutes.mjs';
import { workbenchRoutes } from './routes/workbenchRoutes.mjs';
import { createMessageLabeler, createStatusLabeler, createTodoTitleLabeler, createTranslator, createWorkflowEventLabeler, inferLanguageFromAcceptLanguage, normalizeLanguage } from './utils/i18n.mjs';
import { isMainModule } from './utils/moduleEntry.mjs';
import { createLoginSecurityService } from './services/loginSecurityService.mjs';

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
  async listOwnerTransfersByOpportunity() {
    return [];
  }
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

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const shouldCreatePool = !options.userRepository && config.databaseUrl;
  const pool = options.pool || (shouldCreatePool ? createPool(config) : null);
  const userRepository = options.userRepository || (pool ? createUserRepository(pool) : emptyUserRepository);
  const loginSecurityRepository = options.loginSecurityRepository || (pool ? createLoginSecurityRepository(pool) : emptyLoginSecurityRepository);
  const loginSecurityService = options.loginSecurityService || createLoginSecurityService(loginSecurityRepository);
  const roleRepository = options.roleRepository || (pool ? createRoleRepository(pool) : emptyRoleRepository);
  const approvalSettingRepository = options.approvalSettingRepository || (pool ? createApprovalSettingRepository(pool) : emptyApprovalSettingRepository);
  const customerRepository = options.customerRepository || (pool ? createCustomerRepository(pool) : emptyCustomerRepository);
  const contactRepository = options.contactRepository || (pool ? createContactRepository(pool) : emptyContactRepository);
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
  const workflowEventRepository = options.workflowEventRepository || (pool ? createWorkflowEventRepository(pool) : emptyWorkflowEventRepository);
  const todoRepository = options.todoRepository || (pool ? createTodoRepository(pool) : emptyTodoRepository);
  const workbenchRepository = options.workbenchRepository || (pool ? createWorkbenchRepository(pool) : emptyWorkbenchRepository);
  const salesWorkRepository = options.salesWorkRepository || (pool ? createSalesWorkRepository(pool) : emptySalesWorkRepository);
  const workflowTransaction = 'workflowTransaction' in options
    ? options.workflowTransaction
    : pool ? createWorkflowTransaction(pool) : null;
  const sessionStore = 'sessionStore' in options ? options.sessionStore : createSessionStore(pool);
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(dirname, 'views'));
  app.use('/assets', express.static(path.join(dirname, 'public', 'assets')));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
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
    next();
  });
  app.use(attachCurrentUser(userRepository));
  app.get('/', (req, res) => {
    res.redirect('/workbench');
  });
  app.use(authRoutes(userRepository, { loginSecurityService }));
  app.use(workbenchRoutes({ workbenchRepository }));
  app.use(systemRoutes({ userRepository, roleRepository, approvalSettingRepository, loginSecurityRepository }));
  app.use(customerRoutes({ customerRepository }));
  app.use(contactRoutes({ customerRepository, contactRepository }));
  app.use(salesWorkRoutes({
    salesWorkRepository,
    customerRepository,
    contactRepository,
    opportunityRepository
  }));
  app.use(opportunityRoutes({
    customerRepository,
    contactRepository,
    attachmentRepository,
    commercialQuoteRepository,
    technicalSolutionRepository,
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
