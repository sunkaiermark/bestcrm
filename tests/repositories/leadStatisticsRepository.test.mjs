import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadStatisticsRepository } from '../../src/repositories/leadStatisticsRepository.mjs';

test('lead statistics preserve immutable source attribution and count only signed project executions as orders', async () => {
  const calls = [];
  const queryTarget = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SELECT DISTINCT owner.id')) {
        return { rows: [{ id: '8', display_name: 'Source owner', is_active: true }] };
      }
      if (sql.includes('GROUP BY source_channel')) {
        return { rows: [{ source_channel: 'referral', source_owner_user_id: '8',
          source_owner_name: 'Source owner', source_owner_label: '', lead_count: '3',
          opportunity_count: '2', win_recorded_count: '1', signed_order_count: '1' }] };
      }
      if (sql.includes('LIMIT $6 OFFSET $7')) {
        return { rows: [{ inquiry_id: '41', submission_type: 'sales_lead',
          created_at: '2026-10-20T01:00:00.000Z', company_name: 'Acme', subject: 'Reactor',
          product_interest: 'Reactor', source_channel: 'referral',
          source_owner_name: 'Source owner', source_owner_label: '', sales_owner_name: 'Sales owner',
          lead_lifecycle_state: 'nurture', lead_next_follow_up_on: '2026-10-30', status: 'new',
          opportunity_id: null, opportunity_no: null, signed_order_id: null }] };
      }
      return { rows: [{ lead_count: '3', opportunity_count: '2', win_recorded_count: '1', signed_order_count: '1' }] };
    }
  };
  const repository = createLeadStatisticsRepository(queryTarget);
  assert.deepEqual(await repository.listAttributionOwners(), [{ id: 8, name: 'Source owner', isActive: true }]);
  assert.deepEqual(await repository.listSalesOwners(), [{ id: 8, name: 'Source owner', isActive: true }]);
  const report = await repository.getReport({
    startOn: '2026-10-01', endDateExclusive: '2026-11-01',
    sourceChannel: 'referral', attributionOwnerUserId: 8, salesOwnerUserId: 6, page: 2, pageSize: 50
  });
  assert.deepEqual(report.summary, { leadCount: 3, opportunityCount: 2, winRecordedCount: 1, signedOrderCount: 1 });
  assert.equal(report.groups[0].sourceOwnerName, 'Source owner');
  assert.equal(report.details[0].salesOwnerName, 'Sales owner');
  const summaryCall = calls.find((call) => call.sql.includes('contract_approval_in_progress'));
  const groupCall = calls.find((call) => call.sql.includes('GROUP BY source_channel'));
  const detailCall = calls.find((call) => call.sql.includes('LIMIT $6 OFFSET $7'));
  assert.deepEqual(summaryCall.params, ['2026-10-01', '2026-11-01', 'referral', 8, 6]);
  assert.match(summaryCall.sql, /source_attribution_channel/);
  assert.match(summaryCall.sql, /project_executions execution/);
  assert.match(detailCall.sql, /inquiry\.submission_type/);
  assert.match(detailCall.sql, /inquiry\.lead_lifecycle_state/);
  assert.match(detailCall.sql, /SELECT id AS inquiry_id, submission_type, created_at, company_name/);
  assert.ok(groupCall);
  assert.deepEqual(detailCall.params, ['2026-10-01', '2026-11-01', 'referral', 8, 6, 50, 50]);
});
