import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadStatisticsFilters } from '../../src/domain/leadStatistics.mjs';

test('lead statistics use an inclusive visible date range and bounded source filter', () => {
  const filters = parseLeadStatisticsFilters({
    startOn: '2026-10-01', endOn: '2026-10-31',
    sourceChannel: 'referral', attributionOwnerUserId: '12', salesOwnerUserId: '7', page: '2'
  });
  assert.deepEqual(filters, {
    startOn: '2026-10-01', endOn: '2026-10-31', endDateExclusive: '2026-11-01',
    sourceChannel: 'referral', attributionOwnerUserId: 12, salesOwnerUserId: 7, page: 2, pageSize: 50
  });
  assert.throws(() => parseLeadStatisticsFilters({ sourceChannel: 'unverified' }), /Invalid source channel/);
  assert.throws(() => parseLeadStatisticsFilters({ startOn: '2026-11-01', endOn: '2026-10-31' }), /Start date/);
});
