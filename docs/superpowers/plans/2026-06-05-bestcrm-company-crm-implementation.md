# BESTCRM Company CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first cloud-ready BESTCRM version with internal login, role permissions, customers, contacts, opportunity workflow, attachment preview/download, withdrawal, audit timeline, and deployment runbook.

**Architecture:** Implement one Express application with server-rendered pages, PostgreSQL persistence, session authentication, and focused service modules. Keep workflow rules in domain services, database access in repositories, and route handlers thin so the process is testable without a browser.

**Tech Stack:** Node.js 22+, Express, PostgreSQL, EJS, express-session, connect-pg-simple, bcryptjs, multer, node-postgres, zod, Node test runner, supertest, Playwright for browser verification.

---

## Implementation Boundaries

Build one deployable web app. Do not introduce React, Vue, external identity providers, multi-tenant SaaS isolation, mobile apps, BI dashboards, ERP modules, email/SMS notification delivery, or object storage in this first implementation.

Use PostgreSQL as the primary database. Local development may use a local PostgreSQL instance or Docker Compose; do not add browser localStorage persistence for business data.

## File Structure

- Create: `package.json` - scripts and runtime dependencies.
- Create: `.env.example` - required environment variables.
- Create: `.gitignore` - excludes dependencies, runtime uploads, and local env files.
- Create: `src/server.mjs` - Express app wiring and route registration.
- Create: `src/config.mjs` - environment parsing.
- Create: `src/db/pool.mjs` - PostgreSQL connection pool.
- Create: `src/db/migrate.mjs` - migration runner.
- Create: `src/db/seed.mjs` - first admin, roles, and demo workflow data.
- Create: `src/db/migrations/001_initial_schema.sql` - all first-version tables and constraints.
- Create: `src/domain/roles.mjs` - role codes and role helpers.
- Create: `src/domain/statuses.mjs` - opportunity status constants.
- Create: `src/domain/workflow.mjs` - workflow state transitions and permissions.
- Create: `src/domain/attachments.mjs` - attachment categories, preview support, and file policy.
- Create: `src/repositories/*.mjs` - database access by aggregate.
- Create: `src/services/*.mjs` - auth, users, customers, contacts, opportunities, workflow, attachments, todos.
- Create: `src/routes/*.mjs` - route groups.
- Create: `src/views/**/*.ejs` - server-rendered pages and partials.
- Create: `src/public/styles.css` - compact enterprise workbench styling.
- Create: `tests/**/*.test.mjs` - domain, repository, and route tests.
- Create: `docker-compose.yml` - local PostgreSQL for development.
- Create: `docs/deployment.md` - cloud deployment and backup runbook.

## Task 1: Project Scaffold and App Shell

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config.mjs`
- Create: `src/server.mjs`
- Create: `tests/smoke/server.test.mjs`

- [ ] **Step 1: Write the failing smoke test**

Create `tests/smoke/server.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';

test('GET /health returns ok', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, app: 'BESTCRM' });
});
```

- [ ] **Step 2: Run the smoke test and verify RED**

Run:

```powershell
npm test -- tests/smoke/server.test.mjs
```

Expected: FAIL because `package.json` or `src/server.mjs` does not exist.

- [ ] **Step 3: Add the minimal scaffold**

Create `package.json`:

```json
{
  "name": "bestcrm",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.mjs",
    "start": "node src/server.mjs",
    "test": "node --test",
    "db:migrate": "node src/db/migrate.mjs",
    "db:seed": "node src/db/seed.mjs"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "connect-pg-simple": "^10.0.0",
    "dotenv": "^16.4.7",
    "ejs": "^3.1.10",
    "express": "^4.19.2",
    "express-session": "^1.18.0",
    "multer": "^1.4.5-lts.1",
    "pg": "^8.13.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.1",
    "supertest": "^7.0.0"
  }
}
```

Create `.env.example`:

```text
NODE_ENV=development
PORT=3000
BASE_URL=http://127.0.0.1:3000
DATABASE_URL=postgres://bestcrm:bestcrm@127.0.0.1:5432/bestcrm
SESSION_SECRET=change-this-session-secret
UPLOAD_DIR=./var/uploads
MAX_UPLOAD_MB=25
```

Create `.gitignore`:

```text
node_modules/
.env
var/
coverage/
playwright-report/
test-results/
```

Create `src/config.mjs`:

```js
import 'dotenv/config';

export function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    baseUrl: env.BASE_URL || 'http://127.0.0.1:3000',
    databaseUrl: env.DATABASE_URL || '',
    sessionSecret: env.SESSION_SECRET || 'dev-session-secret',
    uploadDir: env.UPLOAD_DIR || './var/uploads',
    maxUploadMb: Number(env.MAX_UPLOAD_MB || 25)
  };
}
```

Create `src/server.mjs`:

```js
import express from 'express';
import { loadConfig } from './config.mjs';

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const app = express();

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

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
```

- [ ] **Step 4: Install dependencies and verify GREEN**

Run:

```powershell
npm install
npm test -- tests/smoke/server.test.mjs
```

Expected: PASS for `GET /health returns ok`.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json .env.example .gitignore src/config.mjs src/server.mjs tests/smoke/server.test.mjs
git commit -m "feat: scaffold BESTCRM express app"
```

## Task 2: Database Schema and Migration Runner

**Files:**
- Create: `docker-compose.yml`
- Create: `src/db/pool.mjs`
- Create: `src/db/migrate.mjs`
- Create: `src/db/migrations/001_initial_schema.sql`
- Create: `tests/db/schema.test.mjs`

- [ ] **Step 1: Write the failing schema test**

Create `tests/db/schema.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../../src/db/migrations/001_initial_schema.sql', import.meta.url);

test('initial schema declares first-version tables', async () => {
  const sql = await readFile(schemaPath, 'utf8');
  for (const table of [
    'users',
    'roles',
    'user_roles',
    'customers',
    'contacts',
    'opportunities',
    'technical_solutions',
    'commercial_quotes',
    'quote_items',
    'contract_approvals',
    'contract_approval_steps',
    'attachments',
    'workflow_events',
    'todos',
    'approval_settings'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /sales_manager_id/);
  assert.doesNotMatch(sql, /department_manager_id/);
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```powershell
npm test -- tests/db/schema.test.mjs
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Add migration infrastructure and schema**

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: bestcrm
      POSTGRES_USER: bestcrm
      POSTGRES_PASSWORD: bestcrm
    ports:
      - "5432:5432"
    volumes:
      - bestcrm_pgdata:/var/lib/postgresql/data

volumes:
  bestcrm_pgdata:
```

Create `src/db/pool.mjs`:

```js
import pg from 'pg';
import { loadConfig } from '../config.mjs';

export function createPool(config = loadConfig()) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  return new pg.Pool({ connectionString: config.databaseUrl });
}
```

Create `src/db/migrate.mjs`:

```js
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './pool.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, 'migrations');

export async function migrate(pool = createPool()) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (applied.rowCount > 0) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool();
  migrate(pool)
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
```

Create `src/db/migrations/001_initial_schema.sql` with the approved tables. Use `bigserial` primary keys, foreign keys for ownership, `numeric(14,2)` for money, `timestamptz` timestamps, and `text` status fields constrained by application services.

Key required columns:

```sql
CREATE TABLE users (
  id bigserial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  email text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE user_roles (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE customers (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  industry text,
  region text,
  address text,
  owner_user_id bigint NOT NULL REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  phone text,
  email text,
  wechat text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunities (
  id bigserial PRIMARY KEY,
  opportunity_no text NOT NULL UNIQUE,
  title text NOT NULL,
  customer_id bigint NOT NULL REFERENCES customers(id),
  primary_contact_id bigint REFERENCES contacts(id),
  requirement text NOT NULL,
  estimated_amount numeric(14,2),
  project_type text,
  delivery_cycle text,
  expected_bid_date date,
  status text NOT NULL,
  salesperson_id bigint NOT NULL REFERENCES users(id),
  sales_manager_id bigint REFERENCES users(id),
  quotation_engineer_id bigint REFERENCES users(id),
  technical_manager_id bigint REFERENCES users(id),
  commercial_manager_id bigint REFERENCES users(id),
  final_deal_amount numeric(14,2),
  lost_reason text,
  won_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE technical_solutions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  summary text NOT NULL,
  parameters text,
  implementation_plan text,
  submitted_by bigint NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commercial_quotes (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  total_price numeric(14,2) NOT NULL,
  payment_terms text,
  validity_date date,
  remarks text,
  submitted_by bigint NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote_items (
  id bigserial PRIMARY KEY,
  quote_id bigint NOT NULL REFERENCES commercial_quotes(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  specification text,
  unit text,
  quantity numeric(14,2) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  subtotal numeric(14,2) NOT NULL
);

CREATE TABLE contract_approvals (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  submitted_by bigint NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE contract_approval_steps (
  id bigserial PRIMARY KEY,
  contract_approval_id bigint NOT NULL REFERENCES contract_approvals(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  role_code text NOT NULL,
  reviewer_user_id bigint NOT NULL REFERENCES users(id),
  action text NOT NULL DEFAULT 'pending',
  comment text,
  acted_at timestamptz
);

CREATE TABLE attachments (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  category text NOT NULL,
  original_name text NOT NULL,
  stored_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  uploaded_by bigint NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_events (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id bigint NOT NULL REFERENCES users(id),
  target_user_id bigint REFERENCES users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE todos (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  assignee_user_id bigint NOT NULL REFERENCES users(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE approval_settings (
  id bigserial PRIMARY KEY,
  setting_key text NOT NULL,
  user_id bigint NOT NULL REFERENCES users(id),
  role_code text NOT NULL,
  sort_order integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);
```

- [ ] **Step 4: Verify schema test and migration execution**

Run:

```powershell
npm test -- tests/db/schema.test.mjs
docker compose up -d postgres
$env:DATABASE_URL='postgres://bestcrm:bestcrm@127.0.0.1:5432/bestcrm'
npm run db:migrate
```

Expected: schema test PASS; migration command exits 0.

- [ ] **Step 5: Commit**

```powershell
git add docker-compose.yml src/db tests/db
git commit -m "feat: add PostgreSQL schema and migrations"
```

## Task 3: Roles, Statuses, and Workflow Domain Rules

**Files:**
- Create: `src/domain/roles.mjs`
- Create: `src/domain/statuses.mjs`
- Create: `src/domain/workflow.mjs`
- Create: `tests/domain/workflow.test.mjs`

- [ ] **Step 1: Write failing workflow tests**

Create `tests/domain/workflow.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, getAllowedActions, transition } from '../../src/domain/workflow.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('salesperson can submit and withdraw initiation before Sales Manager approval', () => {
  const context = { userId: 1, roles: [ROLES.SALESPERSON], opportunity: { status: STATUSES.DRAFT, salespersonId: 1 } };
  assert.deepEqual(getAllowedActions(context), [ACTIONS.SUBMIT_INITIATION]);

  const submitted = transition(context, ACTIONS.SUBMIT_INITIATION, { salesManagerId: 2 });
  assert.equal(submitted.status, STATUSES.INITIATION_PENDING);

  const withdrawn = transition({ ...context, opportunity: submitted }, ACTIONS.WITHDRAW_INITIATION, { reason: 'revise amount' });
  assert.equal(withdrawn.status, STATUSES.DRAFT);
});

test('Sales Manager approval assigns quotation engineer and moves to technical work', () => {
  const context = {
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    opportunity: { status: STATUSES.INITIATION_PENDING, salespersonId: 1, salesManagerId: 2 }
  };

  const next = transition(context, ACTIONS.APPROVE_INITIATION, { quotationEngineerId: 3 });

  assert.equal(next.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(next.quotationEngineerId, 3);
});

test('quotation engineer can withdraw pending technical and commercial submissions', () => {
  const technical = transition({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    opportunity: { status: STATUSES.TECHNICAL_SOLUTION_PENDING, quotationEngineerId: 3 }
  }, ACTIONS.WITHDRAW_TECHNICAL_SOLUTION, { reason: 'replace drawing' });
  assert.equal(technical.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);

  const commercial = transition({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    opportunity: { status: STATUSES.COMMERCIAL_QUOTE_PENDING, quotationEngineerId: 3 }
  }, ACTIONS.WITHDRAW_COMMERCIAL_QUOTE, { reason: 'adjust payment terms' });
  assert.equal(commercial.status, STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS);
});
```

- [ ] **Step 2: Run workflow tests and verify RED**

Run:

```powershell
npm test -- tests/domain/workflow.test.mjs
```

Expected: FAIL because domain modules do not exist.

- [ ] **Step 3: Implement status, roles, and transition rules**

Create `src/domain/roles.mjs`:

```js
export const ROLES = Object.freeze({
  SALESPERSON: 'salesperson',
  SALES_MANAGER: 'sales_manager',
  QUOTATION_ENGINEER: 'quotation_engineer',
  TECHNICAL_MANAGER: 'technical_manager',
  COMMERCIAL_MANAGER: 'commercial_manager',
  LEGAL_REVIEWER: 'legal_reviewer',
  FINANCE_REVIEWER: 'finance_reviewer',
  GENERAL_MANAGER: 'general_manager',
  ADMINISTRATOR: 'administrator'
});

export function hasRole(user, role) {
  return user.roles.includes(role);
}
```

Create `src/domain/statuses.mjs` with every status from the spec:

```js
export const STATUSES = Object.freeze({
  DRAFT: 'draft',
  INITIATION_PENDING: 'initiation_pending',
  INITIATION_REJECTED: 'initiation_rejected',
  QUOTATION_ENGINEER_ASSIGNMENT_PENDING: 'quotation_engineer_assignment_pending',
  TECHNICAL_SOLUTION_IN_PROGRESS: 'technical_solution_in_progress',
  TECHNICAL_SOLUTION_PENDING: 'technical_solution_pending',
  TECHNICAL_SOLUTION_REJECTED: 'technical_solution_rejected',
  COMMERCIAL_QUOTE_IN_PROGRESS: 'commercial_quote_in_progress',
  COMMERCIAL_QUOTE_PENDING: 'commercial_quote_pending',
  COMMERCIAL_QUOTE_REJECTED: 'commercial_quote_rejected',
  CUSTOMER_NEGOTIATION: 'customer_negotiation',
  LOST_ARCHIVED: 'lost_archived',
  WON_CONTRACT_PENDING: 'won_contract_pending',
  CONTRACT_APPROVAL_IN_PROGRESS: 'contract_approval_in_progress',
  CONTRACT_REJECTED: 'contract_rejected',
  CONTRACT_ARCHIVED: 'contract_archived'
});
```

Create `src/domain/workflow.mjs` with `ACTIONS`, `getAllowedActions(context)`, and `transition(context, action, payload)`. Throw `Error('Action not allowed')` for invalid role, assignee, or status. Keep `quotation_engineer_assignment_pending` defined but route Sales Manager approval directly to `technical_solution_in_progress` because the approved design combines approval and assignment in one action.

- [ ] **Step 4: Verify workflow tests**

Run:

```powershell
npm test -- tests/domain/workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/domain tests/domain
git commit -m "feat: add opportunity workflow domain rules"
```

## Task 4: Authentication and Role-Based Access

**Files:**
- Create: `src/services/authService.mjs`
- Create: `src/middleware/auth.mjs`
- Create: `src/routes/authRoutes.mjs`
- Create: `src/views/auth/login.ejs`
- Create: `tests/services/authService.test.mjs`

- [ ] **Step 1: Write failing auth service tests**

Create `tests/services/authService.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, requireRole } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('password hashes verify only matching password', async () => {
  const hash = await hashPassword('ChangeMe123!');

  assert.equal(await verifyPassword('ChangeMe123!', hash), true);
  assert.equal(await verifyPassword('WrongPassword', hash), false);
});

test('requireRole allows administrator shortcut and rejects missing role', () => {
  assert.equal(requireRole({ roles: [ROLES.ADMINISTRATOR] }, ROLES.SALES_MANAGER), true);
  assert.equal(requireRole({ roles: [ROLES.SALES_MANAGER] }, ROLES.SALES_MANAGER), true);
  assert.throws(() => requireRole({ roles: [ROLES.SALESPERSON] }, ROLES.SALES_MANAGER), /Forbidden/);
});
```

- [ ] **Step 2: Run auth tests and verify RED**

Run:

```powershell
npm test -- tests/services/authService.test.mjs
```

Expected: FAIL because `authService.mjs` does not exist.

- [ ] **Step 3: Implement auth utilities and middleware**

Create `src/services/authService.mjs`:

```js
import bcrypt from 'bcryptjs';
import { ROLES } from '../domain/roles.mjs';

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export function requireRole(user, role) {
  if (!user) throw new Error('Unauthenticated');
  if (user.roles.includes(ROLES.ADMINISTRATOR) || user.roles.includes(role)) return true;
  throw new Error('Forbidden');
}
```

Create `src/middleware/auth.mjs`:

```js
export function attachCurrentUser(userRepository) {
  return async (req, res, next) => {
    const userId = req.session?.userId;
    req.currentUser = userId ? await userRepository.findByIdWithRoles(userId) : null;
    res.locals.currentUser = req.currentUser;
    next();
  };
}

export function requireLogin(req, res, next) {
  if (!req.currentUser) {
    res.redirect('/login');
    return;
  }
  next();
}
```

Create `src/routes/authRoutes.mjs` with:

```js
import { Router } from 'express';
import { verifyPassword } from '../services/authService.mjs';

export function authRoutes(userRepository) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.render('auth/login', { error: null });
  });

  router.post('/login', async (req, res) => {
    const user = await userRepository.findByUsernameWithRoles(req.body.username);
    const valid = user && user.isActive && await verifyPassword(req.body.password, user.passwordHash);
    if (!valid) {
      res.status(401).render('auth/login', { error: 'Invalid username or password' });
      return;
    }
    req.session.userId = user.id;
    res.redirect('/');
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  return router;
}
```

- [ ] **Step 4: Verify auth tests**

Run:

```powershell
npm test -- tests/services/authService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/authService.mjs src/middleware src/routes/authRoutes.mjs src/views/auth tests/services/authService.test.mjs
git commit -m "feat: add internal login and role checks"
```

## Task 5: Customer and Contact Records

**Files:**
- Create: `src/repositories/customerRepository.mjs`
- Create: `src/repositories/contactRepository.mjs`
- Create: `src/services/customerService.mjs`
- Create: `src/services/contactService.mjs`
- Create: `src/routes/customerRoutes.mjs`
- Create: `src/routes/contactRoutes.mjs`
- Create: `src/views/customers/*.ejs`
- Create: `src/views/contacts/*.ejs`
- Create: `tests/services/customerContactService.test.mjs`

- [ ] **Step 1: Write failing customer/contact service tests**

Create `tests/services/customerContactService.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { canMaintainCustomer, canMaintainContact } from '../../src/services/customerService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('salesperson maintains only owned customer records', () => {
  assert.equal(canMaintainCustomer({ id: 7, roles: [ROLES.SALESPERSON] }, { ownerUserId: 7 }), true);
  assert.equal(canMaintainCustomer({ id: 8, roles: [ROLES.SALESPERSON] }, { ownerUserId: 7 }), false);
});

test('administrator maintains all customer and contact records', () => {
  const admin = { id: 99, roles: [ROLES.ADMINISTRATOR] };
  assert.equal(canMaintainCustomer(admin, { ownerUserId: 7 }), true);
  assert.equal(canMaintainContact(admin, { customerOwnerUserId: 7 }), true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- tests/services/customerContactService.test.mjs
```

Expected: FAIL because `customerService.mjs` does not exist.

- [ ] **Step 3: Implement customer/contact permission helpers and repositories**

Create service helpers:

```js
import { ROLES } from '../domain/roles.mjs';

export function canMaintainCustomer(user, customer) {
  return user.roles.includes(ROLES.ADMINISTRATOR) || customer.ownerUserId === user.id;
}

export function canMaintainContact(user, contact) {
  return user.roles.includes(ROLES.ADMINISTRATOR) || contact.customerOwnerUserId === user.id;
}
```

Create repositories with functions `listCustomers`, `getCustomerDetail`, `createCustomer`, `updateCustomer`, `listContacts`, `getContactDetail`, `createContact`, and `updateContact`. Return camelCase objects from repository rows.

- [ ] **Step 4: Add list/detail routes and verify tests**

Run:

```powershell
npm test -- tests/services/customerContactService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/repositories src/services/customerService.mjs src/services/contactService.mjs src/routes/customerRoutes.mjs src/routes/contactRoutes.mjs src/views/customers src/views/contacts tests/services/customerContactService.test.mjs
git commit -m "feat: add customer and contact records"
```

## Task 6: Opportunity Workflow Service and Audit Timeline

**Files:**
- Create: `src/repositories/opportunityRepository.mjs`
- Create: `src/repositories/workflowEventRepository.mjs`
- Create: `src/repositories/todoRepository.mjs`
- Create: `src/services/opportunityService.mjs`
- Create: `src/services/workflowService.mjs`
- Create: `tests/services/workflowService.test.mjs`

- [ ] **Step 1: Write failing workflow service tests**

Create `tests/services/workflowService.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowEffects } from '../../src/services/workflowService.mjs';
import { ACTIONS } from '../../src/domain/workflow.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('Sales Manager approval creates todo and timeline event', () => {
  const effects = buildWorkflowEffects({
    actor: { id: 2, roles: [ROLES.SALES_MANAGER] },
    action: ACTIONS.APPROVE_INITIATION,
    before: { id: 10, status: STATUSES.INITIATION_PENDING, salespersonId: 1, salesManagerId: 2 },
    after: { id: 10, status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3 },
    payload: { quotationEngineerId: 3, comment: 'approved' }
  });

  assert.deepEqual(effects.todosToCreate, [{ opportunityId: 10, assigneeUserId: 3, title: 'Prepare technical solution' }]);
  assert.equal(effects.event.eventType, ACTIONS.APPROVE_INITIATION);
  assert.equal(effects.event.toStatus, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
});

test('withdraw closes current todo as withdrawn', () => {
  const effects = buildWorkflowEffects({
    actor: { id: 1, roles: [ROLES.SALESPERSON] },
    action: ACTIONS.WITHDRAW_INITIATION,
    before: { id: 10, status: STATUSES.INITIATION_PENDING, salespersonId: 1 },
    after: { id: 10, status: STATUSES.DRAFT },
    payload: { reason: 'revise requirement' }
  });

  assert.deepEqual(effects.todosToClose, [{ opportunityId: 10, status: 'withdrawn' }]);
  assert.equal(effects.event.comment, 'revise requirement');
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run:

```powershell
npm test -- tests/services/workflowService.test.mjs
```

Expected: FAIL because `workflowService.mjs` does not exist.

- [ ] **Step 3: Implement workflow service effects**

Create `buildWorkflowEffects` that maps domain transitions to repository operations:

- create `workflow_events` for every action
- create todo for quotation engineer after initiation approval
- create todo for technical manager after technical solution submission
- create todo for commercial manager after commercial quote submission
- create contract approval todo for legal reviewer after contract submission
- close pending todo with `completed_at` and status `withdrawn` for withdraw actions

- [ ] **Step 4: Verify tests**

Run:

```powershell
npm test -- tests/domain/workflow.test.mjs tests/services/workflowService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/repositories src/services/opportunityService.mjs src/services/workflowService.mjs tests/services/workflowService.test.mjs
git commit -m "feat: add opportunity workflow service"
```

## Task 7: Attachments, Preview, and Download

**Files:**
- Create: `src/domain/attachments.mjs`
- Create: `src/repositories/attachmentRepository.mjs`
- Create: `src/services/attachmentService.mjs`
- Create: `src/routes/attachmentRoutes.mjs`
- Create: `src/views/partials/attachments.ejs`
- Create: `tests/services/attachmentService.test.mjs`

- [ ] **Step 1: Write failing attachment tests**

Create `tests/services/attachmentService.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { canPreviewMimeType, canAccessAttachment, buildStoredFileName } from '../../src/services/attachmentService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('preview supports pdf images and plain text only', () => {
  assert.equal(canPreviewMimeType('application/pdf'), true);
  assert.equal(canPreviewMimeType('image/png'), true);
  assert.equal(canPreviewMimeType('text/plain'), true);
  assert.equal(canPreviewMimeType('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
});

test('attachment access follows opportunity visibility', () => {
  const user = { id: 1, roles: [ROLES.SALESPERSON] };
  assert.equal(canAccessAttachment(user, { salespersonId: 1 }), true);
  assert.equal(canAccessAttachment(user, { salespersonId: 2 }), false);
  assert.equal(canAccessAttachment({ id: 99, roles: [ROLES.ADMINISTRATOR] }, { salespersonId: 2 }), true);
});

test('stored file names do not reuse original names', () => {
  const stored = buildStoredFileName('contract final.pdf', 'application/pdf');
  assert.match(stored, /^[a-f0-9-]+\.pdf$/);
  assert.notEqual(stored, 'contract final.pdf');
});
```

- [ ] **Step 2: Run attachment tests and verify RED**

Run:

```powershell
npm test -- tests/services/attachmentService.test.mjs
```

Expected: FAIL because `attachmentService.mjs` does not exist.

- [ ] **Step 3: Implement attachment service and routes**

Create `src/services/attachmentService.mjs` exports:

- `canPreviewMimeType(mimeType)`
- `canAccessAttachment(user, opportunity)`
- `buildStoredFileName(originalName, mimeType)`
- `recordAttachmentUpload({ opportunityId, file, category, actor })`
- `recordAttachmentView({ attachmentId, actor, actionType })`

Create `src/routes/attachmentRoutes.mjs` routes:

- `POST /opportunities/:id/attachments` with multer upload to `UPLOAD_DIR`
- `GET /attachments/:id/preview` with auth and visibility checks
- `GET /attachments/:id/download` with auth and visibility checks

The route implementation must create a workflow event on upload, preview, and download, and must never serve files from `src/public`.

Use these categories:

```js
export const ATTACHMENT_CATEGORIES = Object.freeze([
  'initiation_material',
  'technical_solution',
  'drawing',
  'technical_parameter',
  'commercial_quote',
  'contract',
  'other'
]);
```

- [ ] **Step 4: Verify attachment tests**

Run:

```powershell
npm test -- tests/services/attachmentService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/domain/attachments.mjs src/repositories/attachmentRepository.mjs src/services/attachmentService.mjs src/routes/attachmentRoutes.mjs src/views/partials/attachments.ejs tests/services/attachmentService.test.mjs
git commit -m "feat: add attachment upload preview and download"
```

## Task 8: Server-Rendered Workbench and Opportunity Pages

**Files:**
- Create: `src/routes/workbenchRoutes.mjs`
- Create: `src/routes/opportunityRoutes.mjs`
- Create: `src/views/layout.ejs`
- Create: `src/views/workbench/index.ejs`
- Create: `src/views/opportunities/*.ejs`
- Create: `src/views/partials/actionPanel.ejs`
- Create: `src/views/partials/timeline.ejs`
- Create: `src/public/styles.css`
- Create: `tests/routes/workbenchRoutes.test.mjs`

- [ ] **Step 1: Write failing route test**

Create `tests/routes/workbenchRoutes.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';

test('anonymous user is redirected from workbench to login', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });
  const response = await request(app).get('/');

  assert.equal(response.status, 302);
  assert.match(response.headers.location, /\/login/);
});
```

- [ ] **Step 2: Run route test and verify RED**

Run:

```powershell
npm test -- tests/routes/workbenchRoutes.test.mjs
```

Expected: FAIL because the workbench route is not registered.

- [ ] **Step 3: Implement core pages**

Create these pages and partials:

- left navigation: Workbench, Opportunities, Customers, Contacts, Workflow Archive, Admin
- workbench: my todos, opportunities I created, opportunities assigned to me, recent workflow events
- opportunity list: filters for status, customer, owner, amount
- opportunity detail: summary, current process panel, action panel, customer/contact, technical solution, commercial quote, contract approval, attachments, timeline
- action panel uses `getAllowedActions` and current user roles
- no in-app text explaining keyboard shortcuts or implementation details

Style constraints:

- compact enterprise workbench
- left nav and dense content areas
- no marketing hero
- no nested cards
- fixed-size action buttons that do not shift layout

- [ ] **Step 4: Verify route test and syntax**

Run:

```powershell
npm test -- tests/routes/workbenchRoutes.test.mjs
node --check src/server.mjs
```

Expected: PASS and syntax check exits 0.

- [ ] **Step 5: Commit**

```powershell
git add src/routes src/views src/public tests/routes/workbenchRoutes.test.mjs
git commit -m "feat: add workbench and opportunity pages"
```

## Task 9: Seed Data, Admin Setup, and Contract Approval Chain

**Files:**
- Create: `src/db/seed.mjs`
- Create: `src/services/adminService.mjs`
- Create: `src/services/contractApprovalService.mjs`
- Create: `src/routes/adminRoutes.mjs`
- Create: `src/views/admin/*.ejs`
- Create: `tests/services/contractApprovalService.test.mjs`

- [ ] **Step 1: Write failing contract approval test**

Create `tests/services/contractApprovalService.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContractSteps, nextContractStep } from '../../src/services/contractApprovalService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('contract approval chain is legal finance general manager', () => {
  const steps = buildContractSteps({
    legalReviewerId: 10,
    financeReviewerId: 11,
    generalManagerId: 12
  });

  assert.deepEqual(steps.map((step) => step.roleCode), [
    ROLES.LEGAL_REVIEWER,
    ROLES.FINANCE_REVIEWER,
    ROLES.GENERAL_MANAGER
  ]);
  assert.equal(nextContractStep(steps).reviewerUserId, 10);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- tests/services/contractApprovalService.test.mjs
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement seed and admin services**

Create seed roles matching `ROLES`. Create first admin from environment:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ChangeMe123!
ADMIN_DISPLAY_NAME=Administrator
```

Implement admin pages for:

- users
- role assignment
- approval settings for Sales Manager, Technical Manager, Commercial Manager, Legal Reviewer, Finance Reviewer, General Manager

Implement contract approval service:

- create contract approval
- create ordered reviewer steps
- approve current step and advance
- reject current step to `contract_rejected`
- withdraw before current reviewer acts

- [ ] **Step 4: Verify contract tests**

Run:

```powershell
npm test -- tests/services/contractApprovalService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/db/seed.mjs src/services/adminService.mjs src/services/contractApprovalService.mjs src/routes/adminRoutes.mjs src/views/admin tests/services/contractApprovalService.test.mjs
git commit -m "feat: add admin setup and contract approval"
```

## Task 10: Deployment Runbook and End-to-End Verification

**Files:**
- Create: `docs/deployment.md`
- Create: `tests/e2e/opportunity-flow.spec.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write E2E test skeleton**

Create `tests/e2e/opportunity-flow.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

test('login page renders for cloud CRM', async ({ page }) => {
  await page.goto(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000/login');
  await expect(page.getByRole('heading', { name: /BESTCRM/i })).toBeVisible();
  await expect(page.getByLabel(/Username/i)).toBeVisible();
  await expect(page.getByLabel(/Password/i)).toBeVisible();
});
```

- [ ] **Step 2: Add Playwright script**

Modify `package.json` scripts:

```json
{
  "test:e2e": "playwright test"
}
```

- [ ] **Step 3: Write deployment runbook**

Create `docs/deployment.md` with:

- Ubuntu server prerequisites
- Node.js installation
- PostgreSQL setup
- `.env` placement and secret values
- `npm ci`
- `npm run db:migrate`
- `npm run db:seed`
- process manager command
- HTTPS reverse proxy notes
- daily PostgreSQL backup command
- daily upload directory backup command
- restore procedure for database and uploads

Include these backup commands:

```bash
pg_dump "$DATABASE_URL" > "/backups/bestcrm-$(date +%F).sql"
tar -czf "/backups/bestcrm-uploads-$(date +%F).tar.gz" "$UPLOAD_DIR"
```

- [ ] **Step 4: Verify all automated checks**

Run:

```powershell
npm test
npm run db:migrate
npm run db:seed
npm run test:e2e
```

Expected: all tests pass; migrations and seed exit 0; Playwright login page test passes against the running local app.

- [ ] **Step 5: Commit**

```powershell
git add docs/deployment.md tests/e2e/opportunity-flow.spec.mjs package.json package-lock.json
git commit -m "docs: add deployment and end-to-end verification"
```

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] `npm run db:migrate` exits 0 against PostgreSQL.
- [ ] `npm run db:seed` creates roles and first admin.
- [ ] `npm run test:e2e` passes against the local server.
- [ ] Browser check confirms login, workbench, opportunity detail, attachment preview/download, and action panel render without overlap on desktop width.
- [ ] Git history contains implementation commits by module.
- [ ] `git status --short --branch` is clean.

## Execution Recommendation

Use Subagent-Driven execution for Tasks 1-10. Each task has a clear ownership boundary and can be reviewed independently before the next task starts.
