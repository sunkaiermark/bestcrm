import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createPool } from './db/pool.mjs';
import { createSessionStore } from './db/sessionStore.mjs';
import { attachCurrentUser } from './middleware/auth.mjs';
import { createContactRepository } from './repositories/contactRepository.mjs';
import { createCustomerRepository } from './repositories/customerRepository.mjs';
import { createOpportunityRepository } from './repositories/opportunityRepository.mjs';
import { createUserRepository } from './repositories/userRepository.mjs';
import { authRoutes } from './routes/authRoutes.mjs';
import { contactRoutes } from './routes/contactRoutes.mjs';
import { customerRoutes } from './routes/customerRoutes.mjs';
import { opportunityRoutes } from './routes/opportunityRoutes.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const emptyUserRepository = {
  async findByIdWithRoles() {
    return null;
  },
  async findByUsernameWithRoles() {
    return null;
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
  async findById() {
    return null;
  },
  async updateWorkflowState() {
    throw new Error('Opportunity repository is not configured');
  }
};

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const shouldCreatePool = !options.userRepository && config.databaseUrl;
  const pool = options.pool || (shouldCreatePool ? createPool(config) : null);
  const userRepository = options.userRepository || (pool ? createUserRepository(pool) : emptyUserRepository);
  const customerRepository = options.customerRepository || (pool ? createCustomerRepository(pool) : emptyCustomerRepository);
  const contactRepository = options.contactRepository || (pool ? createContactRepository(pool) : emptyContactRepository);
  const opportunityRepository = options.opportunityRepository || (pool ? createOpportunityRepository(pool) : emptyOpportunityRepository);
  const sessionStore = 'sessionStore' in options ? options.sessionStore : createSessionStore(pool);
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(dirname, 'views'));
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
  app.use(authRoutes(userRepository));
  app.use(customerRoutes({ customerRepository }));
  app.use(contactRoutes({ customerRepository, contactRepository }));
  app.use(opportunityRoutes({ customerRepository, contactRepository, opportunityRepository }));

  app.get('/health', (req, res) => {
    res.json({ ok: true, app: 'BESTCRM' });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`BESTCRM listening on ${config.baseUrl}`);
  });
}
