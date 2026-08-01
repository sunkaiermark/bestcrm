import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityRepository } from '../../src/repositories/opportunityRepository.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

const opportunityRow = {
  id: '30',
  opportunity_no: 'OPP-20260605-abcdef12',
  title: 'Factory upgrade',
  customer_id: '10',
  customer_name: 'Acme Co',
  primary_contact_id: '20',
  primary_contact_name: 'Alice',
  requirement: 'Upgrade production line',
  estimated_amount: '120000.50',
  project_type: 'automation',
  delivery_cycle: '45 days',
  expected_bid_date: '2026-07-10',
  status: STATUSES.DRAFT,
  salesperson_id: '7',
  salesperson_username: 'sales01',
  salesperson_display_name: 'Sales One',
  sales_manager_id: null,
  quotation_engineer_id: null,
  technical_manager_id: null,
  commercial_manager_id: null,
  final_deal_amount: null,
  lost_reason: null,
  won_description: null,
  archived_at: null
};

test('opportunity repository lists opportunities with customer and contact names', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunities = await repository.listOpportunities({ salespersonId: 7 });

  assert.deepEqual(opportunities, [{
    id: 30,
    opportunityNo: 'OPP-20260605-abcdef12',
    title: 'Factory upgrade',
    customerId: 10,
    customerName: 'Acme Co',
    primaryContactId: 20,
    primaryContactName: 'Alice',
    requirement: 'Upgrade production line',
    estimatedAmount: 120000.50,
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10',
    status: STATUSES.DRAFT,
    salespersonId: 7,
    salespersonUsername: 'sales01',
    salespersonDisplayName: 'Sales One',
    salesManagerId: null,
    quotationEngineerId: null,
    technicalManagerId: null,
    commercialManagerId: null,
    finalDealAmount: null,
    lostReason: null,
    wonDescription: null,
    archivedAt: null
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunities o/);
  assert.match(queryTarget.queries[0].sql, /JOIN customers c/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN contacts pc/);
  assert.match(queryTarget.queries[0].sql, /JOIN users salesperson/);
  assert.match(queryTarget.queries[0].sql, /WHERE o\.salesperson_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.status NOT IN \(\$2, \$3\)/);
  assert.deepEqual(queryTarget.queries[0].params, [7, STATUSES.LOST_ARCHIVED, STATUSES.CONTRACT_ARCHIVED]);
});

test('opportunity repository filters visible opportunities for owners assignees and active team members', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.listOpportunities({ visibleToUserId: 8 });

  assert.match(queryTarget.queries[0].sql, /o\.salesperson_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.sales_manager_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.quotation_engineer_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.technical_manager_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.commercial_manager_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_members om/);
  assert.match(queryTarget.queries[0].sql, /om\.opportunity_id = o\.id/);
  assert.match(queryTarget.queries[0].sql, /om\.user_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /om\.is_active = true/);
  assert.match(queryTarget.queries[0].sql, /o\.status NOT IN \(\$2, \$3\)/);
  assert.deepEqual(queryTarget.queries[0].params, [8, STATUSES.LOST_ARCHIVED, STATUSES.CONTRACT_ARCHIVED]);
});

test('opportunity repository excludes archived opportunities by default', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.listOpportunities();

  assert.match(queryTarget.queries[0].sql, /WHERE o\.status NOT IN \(\$1, \$2\)/);
  assert.deepEqual(queryTarget.queries[0].params, [STATUSES.LOST_ARCHIVED, STATUSES.CONTRACT_ARCHIVED]);
});

test('opportunity repository can list only archived opportunities', async () => {
  const queryTarget = createFakeQueryTarget([{
    ...opportunityRow,
    status: STATUSES.CONTRACT_ARCHIVED,
    archived_at: '2026-07-31T10:00:00.000Z'
  }]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunities = await repository.listOpportunities({ archiveScope: 'archived' });

  assert.equal(opportunities[0].status, STATUSES.CONTRACT_ARCHIVED);
  assert.match(queryTarget.queries[0].sql, /WHERE o\.status IN \(\$1, \$2\)/);
  assert.deepEqual(queryTarget.queries[0].params, [STATUSES.LOST_ARCHIVED, STATUSES.CONTRACT_ARCHIVED]);
});

test('opportunity repository can list all opportunities including archived', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.listOpportunities({ archiveScope: 'all' });

  assert.doesNotMatch(queryTarget.queries[0].sql, /o\.status (?:NOT )?IN/);
  assert.deepEqual(queryTarget.queries[0].params, []);
});

test('opportunity repository gets detail with customer and contact names', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunity = await repository.getOpportunityDetail(30);

  assert.equal(opportunity.id, 30);
  assert.equal(opportunity.customerName, 'Acme Co');
  assert.equal(opportunity.primaryContactName, 'Alice');
  assert.equal(opportunity.salespersonDisplayName, 'Sales One');
  assert.match(queryTarget.queries[0].sql, /WHERE o\.id = \$1/);
});

test('opportunity repository creates draft opportunity rows', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.createOpportunity({
    opportunityNo: 'OPP-20260605-abcdef12',
    title: 'Factory upgrade',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production line',
    estimatedAmount: 120000.50,
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10',
    status: STATUSES.DRAFT,
    salespersonId: 7
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunities/);
  assert.deepEqual(queryTarget.queries[0].params, [
    'OPP-20260605-abcdef12',
    'Factory upgrade',
    10,
    20,
    'Upgrade production line',
    120000.50,
    'automation',
    '45 days',
    '2026-07-10',
    STATUSES.DRAFT,
    7
  ]);
});

test('opportunity repository updates editable opportunity fields', async () => {
  const queryTarget = createFakeQueryTarget([{
    ...opportunityRow,
    title: 'Factory upgrade revised',
    requirement: 'Upgrade production and packing lines'
  }]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunity = await repository.updateOpportunity(30, {
    title: 'Factory upgrade revised',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production and packing lines',
    estimatedAmount: 180000,
    projectType: 'automation',
    deliveryCycle: '60 days',
    expectedBidDate: '2026-08-01'
  });

  assert.equal(opportunity.title, 'Factory upgrade revised');
  assert.match(queryTarget.queries[0].sql, /UPDATE opportunities/);
  assert.match(queryTarget.queries[0].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[0].params, [
    'Factory upgrade revised',
    10,
    20,
    'Upgrade production and packing lines',
    180000,
    'automation',
    '60 days',
    '2026-08-01',
    30
  ]);
});

test('opportunity repository deletes opportunity rows by id', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.deleteById(30);

  assert.match(queryTarget.queries[0].sql, /DELETE FROM opportunities WHERE id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [30]);
});

test('opportunity repository generates six digit opportunity numbers from sequence', async () => {
  const queryTarget = createFakeQueryTarget([{
    ...opportunityRow,
    opportunity_no: '800000'
  }]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunity = await repository.createOpportunity({
    opportunityNo: null,
    title: 'Factory upgrade',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production line',
    estimatedAmount: 120000.50,
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10',
    status: STATUSES.DRAFT,
    salespersonId: 7
  });

  assert.equal(opportunity.opportunityNo, '800000');
  assert.match(queryTarget.queries[0].sql, /COALESCE\(\$1, nextval\('opportunity_no_seq'\)::text\)/);
  assert.deepEqual(queryTarget.queries[0].params, [
    null,
    'Factory upgrade',
    10,
    20,
    'Upgrade production line',
    120000.50,
    'automation',
    '45 days',
    '2026-07-10',
    STATUSES.DRAFT,
    7
  ]);
});
