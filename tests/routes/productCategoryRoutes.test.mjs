import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function loggedInCategoryAgent(role, { opportunity = {}, thread = {} } = {}) {
  const user = {
    id: role === ROLES.QUOTATION_ENGINEER ? 9 : 7,
    username: 'category-reviewer',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Category Reviewer',
    isActive: true,
    roles: [role]
  };
  const calls = [];
  const opportunityRecord = {
    id: 30,
    salespersonId: 7,
    salesManagerId: 8,
    quotationEngineerId: 9,
    archivedAt: null,
    ...opportunity
  };
  const emailThread = {
    id: 40,
    mailboxKey: 'sales@sunkaier.com',
    opportunityId: null,
    ...thread
  };
  const app = createApp({
    databaseUrl: '',
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; }
    },
    productCategoryRepository: {
      async setConfirmed(...args) {
        calls.push(args);
        return { id: args[1], confirmed_product_category_codes: args[2] };
      }
    },
    inquiryRepository: {
      async findById(id) {
        return Number(id) === 11
          ? { id: 11, submissionType: 'sales_lead', createdBy: 7 }
          : null;
      }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) {
        return Number(id) === 30 ? opportunityRecord : null;
      }
    },
    emailArchiveRepository: {
      async findThreadById(id) { return Number(id) === 40 ? emailThread : null; },
      async getThreadDetail(id) { return Number(id) === 40 ? emailThread : null; }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({
    username: user.username,
    password: 'ChangeMe123!'
  });
  return { agent, calls };
}

test('lead category confirmation saves multiple validated categories and an explicit empty selection', async () => {
  const { agent, calls } = await loggedInCategoryAgent(ROLES.SALESPERSON);
  const saved = await agent.post('/lead-submissions/11/product-categories').type('form').send({
    productCategoriesSubmitted: '1',
    confirmedProductCategoryCodes: ['process-line', 'mixers', 'mixers']
  });
  assert.equal(saved.status, 302);
  assert.equal(saved.headers.location, '/lead-submissions/11?categoriesSaved=1');
  assert.deepEqual(calls[0], ['inquiry', 11, ['mixers', 'process-line'], 7]);

  const cleared = await agent.post('/lead-submissions/11/product-categories').type('form').send({
    productCategoriesSubmitted: '1'
  });
  assert.equal(cleared.status, 302);
  assert.deepEqual(calls[1], ['inquiry', 11, [], 7]);
});

test('category review rejects incomplete forms and unknown categories before saving', async () => {
  const { agent, calls } = await loggedInCategoryAgent(ROLES.ADMINISTRATOR);
  const incomplete = await agent.post('/lead-submissions/11/product-categories').type('form').send({
    confirmedProductCategoryCodes: 'mixers'
  });
  assert.equal(incomplete.status, 400);
  const invalid = await agent.post('/lead-submissions/11/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'arbitrary-category'
  });
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
});

test('opportunity viewers without business responsibility cannot change classification', async () => {
  const { agent, calls } = await loggedInCategoryAgent(ROLES.QUOTATION_ENGINEER);
  const response = await agent.post('/opportunities/30/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'reactors'
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('salesperson can confirm categories on their opportunity but not an archived one', async () => {
  const active = await loggedInCategoryAgent(ROLES.SALESPERSON);
  const response = await active.agent.post('/opportunities/30/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: ['reactors', 'mixers']
  });
  assert.equal(response.status, 302);
  assert.deepEqual(active.calls[0], ['opportunity', 30, ['mixers', 'reactors'], 7]);

  const archived = await loggedInCategoryAgent(ROLES.SALESPERSON, {
    opportunity: { archivedAt: '2026-09-01T00:00:00.000Z' }
  });
  const denied = await archived.agent.post('/opportunities/30/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'reactors'
  });
  assert.equal(denied.status, 403);
  assert.equal(archived.calls.length, 0);

  const administrator = await loggedInCategoryAgent(ROLES.ADMINISTRATOR, {
    opportunity: { archivedAt: '2026-09-01T00:00:00.000Z' }
  });
  const reviewed = await administrator.agent.post('/opportunities/30/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'reactors'
  });
  assert.equal(reviewed.status, 302);
  assert.deepEqual(administrator.calls[0], ['opportunity', 30, ['reactors'], 7]);
});

test('shared unlinked email review requires manager authority', async () => {
  const salesperson = await loggedInCategoryAgent(ROLES.SALESPERSON);
  const denied = await salesperson.agent.post('/email-center/threads/40/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'pumps'
  });
  assert.equal(denied.status, 403);
  const manager = await loggedInCategoryAgent(ROLES.SALES_MANAGER);
  const saved = await manager.agent.post('/email-center/threads/40/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'pumps'
  });
  assert.equal(saved.status, 302);
  assert.deepEqual(manager.calls[0], ['email_thread', 40, ['pumps'], 7]);
});

test('linked email review follows the opportunity business owner, not supporting engineers', async () => {
  const owner = await loggedInCategoryAgent(ROLES.SALESPERSON, {
    thread: { opportunityId: 30 }
  });
  const saved = await owner.agent.post('/email-center/threads/40/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: ['pumps', 'reactors']
  });
  assert.equal(saved.status, 302);
  assert.deepEqual(owner.calls[0], ['email_thread', 40, ['pumps', 'reactors'], 7]);

  const engineer = await loggedInCategoryAgent(ROLES.QUOTATION_ENGINEER, {
    thread: { opportunityId: 30 }
  });
  const denied = await engineer.agent.post('/email-center/threads/40/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'pumps'
  });
  assert.equal(denied.status, 403);
  assert.equal(engineer.calls.length, 0);
});

test('spam or archived email is not reviewed as a business product record', async () => {
  const { agent, calls } = await loggedInCategoryAgent(ROLES.ADMINISTRATOR, {
    thread: { archiveDisposition: 'spam', triageStatus: 'spam' }
  });
  const response = await agent.post('/email-center/threads/40/product-categories').type('form').send({
    productCategoriesSubmitted: '1', confirmedProductCategoryCodes: 'pumps'
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});
