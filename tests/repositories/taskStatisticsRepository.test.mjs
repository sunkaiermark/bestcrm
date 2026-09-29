import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStatisticsRepository } from '../../src/repositories/taskStatisticsRepository.mjs';

test('task report uses bounded parameterized union and retains missing completion dates', async () => {
  const calls = [];
  const queryTarget = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM users\n')) {
        return { rows: [{ id: '7', display_name: 'A', is_active: false }] };
      }
      if (sql.includes('count(*)::integer AS total')) {
        return { rows: [{ total: 2, completed: 1, cancelled: 0,
          subprojects: 1, unassigned: 1 }] };
      }
      return { rows: [{ source_type: 'development_subproject', source_id: '91',
        user_id: null, user_name: null, user_is_active: null,
        project_no: 'RDP-9', project_name: 'Mixer', task_title: 'Seal', task_summary: '',
        planned_start: '2026-10-01', planned_end: '2026-10-20',
        actual_completed: null, status: 'planned', opportunity_id: null }] };
    }
  };
  const repository = createTaskStatisticsRepository(queryTarget);
  assert.deepEqual(await repository.listUsers(), [{ id: 7, name: 'A', isActive: false }]);
  const report = await repository.getReport({ startDate: '2026-10-01', endDate: '2027-01-01',
    userId: null, page: 2, pageSize: 50 });
  assert.equal(report.summary.unassigned, 1);
  assert.equal(report.rows[0].userId, null);
  assert.equal(report.rows[0].actualCompleted, null);
  assert.equal(report.rows[0].projectName, 'Mixer');
  assert.deepEqual(calls[1].params, ['2026-10-01', '2027-01-01', null]);
  assert.deepEqual(calls[2].params, ['2026-10-01', '2027-01-01', null, 50, 50]);
  assert.match(calls[1].sql, /UNION ALL/);
  assert.match(calls[1].sql, /left\(subproject\.summary, 300\)/);
  assert.match(calls[1].sql, /CASE WHEN item.status = 'completed'/);
  assert.match(calls[2].sql, /LIMIT \$4 OFFSET \$5/);
});
