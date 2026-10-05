import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailResponseRepository } from '../../src/repositories/emailResponseRepository.mjs';

test('opportunity email indicators query only supplied visible opportunity ids in one batch', async () => {
  const calls = [];
  const repository = createEmailResponseRepository({
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [{
        opportunity_id: '30',
        new_count: 2,
        new_message_id: '91',
        waiting_count: 1,
        waiting_message_id: '92',
        overdue_count: 3,
        overdue_message_id: '93',
        latest_received_at: '2026-10-05T04:00:00.000Z'
      }] };
    }
  });
  assert.deepEqual(await repository.listOpportunityEmailIndicators([]), []);
  assert.equal(calls.length, 0);

  const at = new Date('2026-10-05T08:00:00.000Z');
  const indicators = await repository.listOpportunityEmailIndicators([30, '30', 31, 0, -1, 'invalid'], at);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].parameters, [[30, 31], at, '105_email_reply_accountability.sql']);
  assert.match(calls[0].sql, /thread\.opportunity_id = ANY\(\$1::bigint\[\]\)/);
  assert.match(calls[0].sql, /thread\.triage_status = 'linked_opportunity'/);
  assert.match(calls[0].sql, /bestcrm_email_customer_reply_at\(inbound\.id\)/);
  assert.match(calls[0].sql, /WHERE replied_at IS NULL/);
  assert.match(calls[0].sql, /received_at \+ interval '8 hours'/);
  assert.deepEqual(indicators, [{
    opportunityId: 30,
    newCount: 2,
    newMessageId: 91,
    waitingCount: 1,
    waitingMessageId: 92,
    overdueCount: 3,
    overdueMessageId: 93,
    latestReceivedAt: '2026-10-05T04:00:00.000Z'
  }]);
});
