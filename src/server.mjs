import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createPool } from './db/pool.mjs';
import { createSessionStore } from './db/sessionStore.mjs';
import { createWorkflowTransaction } from './db/workflowTransaction.mjs';
import { attachCurrentUser } from './middleware/auth.mjs';
import { createAttachmentRepository } from './repositories/attachmentRepository.mjs';
import { createApprovalSettingRepository } from './repositories/approvalSettingRepository.mjs';
import { createCommercialQuoteRepository } from './repositories/commercialQuoteRepository.mjs';
import { createContractApprovalRepository } from './repositories/contractApprovalRepository.mjs';
import { createContactRepository } from './repositories/contactRepository.mjs';
import { createCustomerRepository } from './repositories/customerRepository.mjs';
import { createOpportunityRepository } from './repositories/opportunityRepository.mjs';
import { createOpportunityResponsibilityRepository } from './repositories/opportunityResponsibilityRepository.mjs';
import { createRequirementUpdateRepository } from './repositories/requirementUpdateRepository.mjs';
import { createRoleRepository } from './repositories/roleRepository.mjs';
import { createTechnicalSolutionRepository } from './repositories/technicalSolutionRepository.mjs';
import { createTodoRepository } from './repositories/todoRepository.mjs';
import { createUserRepository } from './repositories/userRepository.mjs';
import { createWorkbenchRepository } from './repositories/workbenchRepository.mjs';
import { createWorkflowEventRepository } from './repositories/workflowEventRepository.mjs';
import { authRoutes } from './routes/authRoutes.mjs';
import { contactRoutes } from './routes/contactRoutes.mjs';
import { customerRoutes } from './routes/customerRoutes.mjs';
import { opportunityRoutes } from './routes/opportunityRoutes.mjs';
import { systemRoutes } from './routes/systemRoutes.mjs';
import { workbenchRoutes } from './routes/workbenchRoutes.mjs';
import { isMainModule } from './utils/moduleEntry.mjs';

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
  },
  async listCurrentResponsiblesByOpportunity() {
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
  async listCreatedOpportunities() {
    return [];
  },
  async listAssignedOpportunities() {
    return [];
  },
  async listRecentWorkflowMessages() {
    return [];
  },
  async countByWorkflowState() {
    return [];
  }
};

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const shouldCreatePool = !options.userRepository && config.databaseUrl;
  const pool = options.pool || (shouldCreatePool ? createPool(config) : null);
  const userRepository = options.userRepository || (pool ? createUserRepository(pool) : emptyUserRepository);
  const roleRepository = options.roleRepository || (pool ? createRoleRepository(pool) : emptyRoleRepository);
  const approvalSettingRepository = options.approvalSettingRepository || (pool ? createApprovalSettingRepository(pool) : emptyApprovalSettingRepository);
  const customerRepository = options.customerRepository || (pool ? createCustomerRepository(pool) : emptyCustomerRepository);
  const contactRepository = options.contactRepository || (pool ? createContactRepository(pool) : emptyContactRepository);
  const attachmentRepository = options.attachmentRepository || (pool ? createAttachmentRepository(pool) : emptyAttachmentRepository);
  const commercialQuoteRepository = options.commercialQuoteRepository || (pool ? createCommercialQuoteRepository(pool) : emptyCommercialQuoteRepository);
  const technicalSolutionRepository = options.technicalSolutionRepository || (pool ? createTechnicalSolutionRepository(pool) : emptyTechnicalSolutionRepository);
  const requirementUpdateRepository = options.requirementUpdateRepository || (pool ? createRequirementUpdateRepository(pool) : emptyRequirementUpdateRepository);
  const contractApprovalRepository = options.contractApprovalRepository || (pool ? createContractApprovalRepository(pool) : emptyContractApprovalRepository);
  const opportunityRepository = options.opportunityRepository || (pool ? createOpportunityRepository(pool) : emptyOpportunityRepository);
  const opportunityResponsibilityRepository = options.opportunityResponsibilityRepository
    || (pool ? createOpportunityResponsibilityRepository(pool) : emptyOpportunityResponsibilityRepository);
  const workflowEventRepository = options.workflowEventRepository || (pool ? createWorkflowEventRepository(pool) : emptyWorkflowEventRepository);
  const todoRepository = options.todoRepository || (pool ? createTodoRepository(pool) : emptyTodoRepository);
  const workbenchRepository = options.workbenchRepository || (pool ? createWorkbenchRepository(pool) : emptyWorkbenchRepository);
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
      secure: config.nodeEnv === 'production'
    }
  }));
  app.use(attachCurrentUser(userRepository));
  app.get('/', (req, res) => {
    res.redirect('/workbench');
  });
  app.use(authRoutes(userRepository));
  app.use(workbenchRoutes({ workbenchRepository }));
  app.use(systemRoutes({ userRepository, roleRepository, approvalSettingRepository }));
  app.use(customerRoutes({ customerRepository }));
  app.use(contactRoutes({ customerRepository, contactRepository }));
  app.use(opportunityRoutes({
    customerRepository,
    contactRepository,
    attachmentRepository,
    commercialQuoteRepository,
    technicalSolutionRepository,
    requirementUpdateRepository,
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
