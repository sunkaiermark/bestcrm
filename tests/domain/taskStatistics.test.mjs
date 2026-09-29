import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskStatisticsFilters } from '../../src/domain/taskStatistics.mjs';

const now = new Date('2026-09-29T00:00:00.000Z');

test('task statistics month, quarter and year boundaries are Shanghai calendar dates', () => {
  assert.deepEqual(parseTaskStatisticsFilters({}, now), {
    period: 'month', startYear: 2026, startUnit: 9, endYear: 2026, endUnit: 9, userId: null,
    page: 1, pageSize: 50, startDate: '2026-09-01', endDate: '2026-10-01'
  });
  assert.deepEqual(parseTaskStatisticsFilters({ period: 'quarter', startYear: '2026',
    startUnit: '4', endYear: '2027', endUnit: '2', userId: '7', page: '2' }, now), {
    period: 'quarter', startYear: 2026, startUnit: 4, endYear: 2027, endUnit: 2,
    userId: 7, page: 2, pageSize: 50,
    startDate: '2026-10-01', endDate: '2027-07-01'
  });
  assert.deepEqual(parseTaskStatisticsFilters({ period: 'year', startYear: '2024',
    endYear: '2026' }, now), {
    period: 'year', startYear: 2024, startUnit: null, endYear: 2026, endUnit: null,
    userId: null, page: 1, pageSize: 50,
    startDate: '2024-01-01', endDate: '2027-01-01'
  });
  assert.deepEqual(parseTaskStatisticsFilters({ year: '2025', month: '2' }, now), {
    period: 'month', startYear: 2025, startUnit: 2, endYear: 2025, endUnit: 2,
    userId: null, page: 1, pageSize: 50,
    startDate: '2025-02-01', endDate: '2025-03-01'
  });
});

test('task statistics rejects malformed filters before database access', () => {
  for (const query of [
    { period: 'week' }, { year: '2026 OR 1=1' }, { month: '13' },
    { period: 'quarter', quarter: '0' }, { userId: '-1' }, { page: '0' },
    { period: 'month', startYear: '2026', startUnit: '10', endYear: '2026', endUnit: '9' },
    { period: 'quarter', startYear: '2026', startUnit: '5', endYear: '2027', endUnit: '1' },
    { period: 'year', startYear: '2027', endYear: '2026' }
  ]) {
    assert.throws(() => parseTaskStatisticsFilters(query, now), { statusCode: 400 });
  }
});
