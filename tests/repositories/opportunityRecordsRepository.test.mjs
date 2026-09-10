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
  origin_inquiry_id: '11',
  opportunity_no: 'OPP-20260605-abcdef12',
  title: 'Factory upgrade',
  customer_id: '10',
  customer_code: 'C000010',
  customer_name: 'Acme Co',
  primary_contact_id: '20',
  primary_contact_code: 'CT000020',
  primary_contact_name: 'Alice',
  requirement: 'Upgrade production line',
  estimated_amount: '120000.50',
  product_interest: 'Industrial mixer',
  project_type: 'automation',
  delivery_cycle: '45 days',
  expected_bid_date: '2026-07-10',
  status: STATUSES.DRAFT,
  salesperson_id: '7',
  salesperson_username: 'sales01',
  salesperson_display_name: 'Sales One',
  sales_manager_id: null,
  quotation_engineer_id: '3',
  quotation_engineer_username: 'lead01',
  quotation_engineer_display_name: 'Lead Engineer',
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
    originInquiryId: 11,
    opportunityNo: 'OPP-20260605-abcdef12',
    title: 'Factory upgrade',
    customerId: 10,
    customerCode: 'C000010',
    customerName: 'Acme Co',
    primaryContactId: 20,
    primaryContactCode: 'CT000020',
    primaryContactName: 'Alice',
    requirement: 'Upgrade production line',
    estimatedAmount: 120000.50,
    productInterest: 'Industrial mixer',
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10',
    status: STATUSES.DRAFT,
    salespersonId: 7,
    salespersonUsername: 'sales01',
    salespersonDisplayName: 'Sales One',
    salesManagerId: null,
    quotationEngineerId: 3,
    quotationEngineerUsername: 'lead01',
    quotationEngineerDisplayName: 'Lead Engineer',
    technicalManagerId: null,
    commercialManagerId: null,
    technicalPlanSubmitDate: null,
    acceptedQuotationPackageId: null,
    finalDealAmount: null,
    lostReason: null,
    wonDescription: null,
    archivedAt: null
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunities o/);
  assert.match(queryTarget.queries[0].sql, /JOIN customers c/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN contacts pc/);
  assert.match(queryTarget.queries[0].sql, /pc\.contact_code AS primary_contact_code/);
  assert.match(queryTarget.queries[0].sql, /JOIN users salesperson/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users quotation_engineer/);
  assert.match(queryTarget.queries[0].sql, /WHERE o\.salesperson_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /o\.status NOT IN \(\$2, \$3\)/);
  assert.deepEqual(queryTarget.queries[0].params, [7, STATUSES.LOST_ARCHIVED, STATUSES.CONTRACT_ARCHIVED]);
});

test('opportunity repository combines sales owner customer contact and keyword filters', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.listOpportunities({
    salespersonId: 7,
    customerId: 10,
    contactId: 20,
    searchTerm: 'Acme_100%'
  });

  const { sql, params } = queryTarget.queries[0];
  assert.match(sql, /o\.salesperson_id = \$1/);
  assert.match(sql, /o\.customer_id = \$2/);
  assert.match(sql, /o\.primary_contact_id = \$3/);
  assert.match(sql, /o\.opportunity_no ILIKE \$4/);
  assert.match(sql, /o\.title ILIKE \$4/);
  assert.match(sql, /c\.customer_code ILIKE \$4/);
  assert.match(sql, /c\.name ILIKE \$4/);
  assert.match(sql, /salesperson\.display_name ILIKE \$4/);
  assert.match(sql, /pc\.contact_code ILIKE \$4/);
  assert.match(sql, /pc\.name ILIKE \$4/);
  assert.match(sql, /o\.status NOT IN \(\$5, \$6\)/);
  assert.deepEqual(params, [
    7,
    10,
    20,
    '%Acme\\_100\\%%',
    STATUSES.LOST_ARCHIVED,
    STATUSES.CONTRACT_ARCHIVED
  ]);
});

test('opportunity repository lists permission-scoped sales owner customer and contact filter options', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  const options = await repository.listOpportunityFilterOptions({ visibleToUserId: 8 });

  assert.deepEqual(options, {
    salespeople: [{ id: 7, username: 'sales01', displayName: 'Sales One' }],
    customers: [{ id: 10, customerCode: 'C000010', name: 'Acme Co' }],
    contacts: [{ id: 20, contactCode: 'CT000020', name: 'Alice', customerId: 10, customerCode: 'C000010', customerName: 'Acme Co' }]
  });
  assert.match(queryTarget.queries[0].sql, /SELECT DISTINCT/);
  assert.match(queryTarget.queries[0].sql, /o\.salesperson_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_members om/);
  assert.match(queryTarget.queries[0].sql, /o\.status NOT IN \(\$2, \$3\)/);
  assert.deepEqual(queryTarget.queries[0].params, [8, STATUSES.LOST_ARCHIVED, STATUSES.CONTRACT_ARCHIVED]);
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

  assert.match(queryTarget.queries[0].sql, /o\.archived_at IS NULL/);
  assert.match(queryTarget.queries[0].sql, /o\.status NOT IN \(\$1, \$2\)/);
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
  assert.match(queryTarget.queries[0].sql, /o\.archived_at IS NOT NULL OR o\.status IN \(\$1, \$2\)/);
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
  assert.equal(opportunity.customerCode, 'C000010');
  assert.equal(opportunity.customerName, 'Acme Co');
  assert.equal(opportunity.primaryContactCode, 'CT000020');
  assert.equal(opportunity.primaryContactName, 'Alice');
  assert.equal(opportunity.salespersonDisplayName, 'Sales One');
  assert.match(queryTarget.queries[0].sql, /WHERE o\.id = \$1/);
});

test('opportunity repository creates draft opportunity rows', async () => {
  const queryTarget = createFakeQueryTarget([opportunityRow]);
  const repository = createOpportunityRepository(queryTarget);

  await repository.createOpportunity({
    originInquiryId: 11,
    opportunityNo: 'OPP-20260605-abcdef12',
    title: 'Factory upgrade',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production line',
    estimatedAmount: 120000.50,
    productInterest: 'Industrial mixer',
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10',
    status: STATUSES.DRAFT,
    salespersonId: 7
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunities/);
  assert.deepEqual(queryTarget.queries[0].params, [
    11,
    'OPP-20260605-abcdef12',
    'Factory upgrade',
    10,
    20,
    'Upgrade production line',
    120000.50,
    'Industrial mixer',
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
    productInterest: 'Mixer and packing line',
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
    'Mixer and packing line',
    'automation',
    '60 days',
    '2026-08-01',
    30
  ]);
});

test('opportunity repository archives and reopens without deleting the row', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '30', record_uid: '33333333-3333-4333-8333-333333333333' }]);
  const repository = createOpportunityRepository(queryTarget);

  const archived = await repository.archiveById(30, { actorUserId: 99, reason: 'Cancelled duplicate' });
  const reopened = await repository.reopenById(30, { actorUserId: 99, reason: 'Cancellation reversed' });

  assert.equal(archived, true);
  assert.equal(reopened, true);
  assert.match(queryTarget.queries[0].sql, /UPDATE opportunities/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO record_lifecycle_events/);
  assert.doesNotMatch(queryTarget.queries[0].sql, /DELETE FROM opportunities/);
  assert.deepEqual(queryTarget.queries[0].params, [30, 99, 'Cancelled duplicate']);
  assert.match(queryTarget.queries[1].sql, /archived_at = NULL/);
  assert.deepEqual(queryTarget.queries[1].params, [30, 99, 'Cancellation reversed']);
});

test('opportunity repository generates six digit opportunity numbers from sequence', async () => {
  const queryTarget = createFakeQueryTarget([{
    ...opportunityRow,
    opportunity_no: '800000'
  }]);
  const repository = createOpportunityRepository(queryTarget);

  const opportunity = await repository.createOpportunity({
    originInquiryId: 11,
    opportunityNo: null,
    title: 'Factory upgrade',
    customerId: 10,
    primaryContactId: 20,
    requirement: 'Upgrade production line',
    estimatedAmount: 120000.50,
    productInterest: 'Industrial mixer',
    projectType: 'automation',
    deliveryCycle: '45 days',
    expectedBidDate: '2026-07-10',
    status: STATUSES.DRAFT,
    salespersonId: 7
  });

  assert.equal(opportunity.opportunityNo, '800000');
  assert.match(queryTarget.queries[0].sql, /COALESCE\(\$2, nextval\('opportunity_no_seq'\)::text\)/);
  assert.deepEqual(queryTarget.queries[0].params, [
    11,
    null,
    'Factory upgrade',
    10,
    20,
    'Upgrade production line',
    120000.50,
    'Industrial mixer',
    'automation',
    '45 days',
    '2026-07-10',
    STATUSES.DRAFT,
    7
  ]);
});
