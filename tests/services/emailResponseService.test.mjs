import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeCustomerEmail,
  processEmailReplyReminders
} from '../../src/services/emailResponseService.mjs';

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    emailArchiveRepository: {
      async findMessageById() { return { id: 11, threadId: 2, direction: 'inbound' }; },
      async findThreadById() { return { id: 2, opportunityId: 20, triageStatus: 'linked_opportunity' }; }
    },
    opportunityRepository: {
      async getOpportunityDetail() { return { id: 20, salespersonId: 7 }; }
    },
    emailResponseRepository: {
      async acknowledge(...args) {
        calls.push(args);
        return { messageId: 11, confirmedBy: 7, confirmedAt: args[2] };
      }
    },
    ...overrides
  };
}

test('only the current opportunity owner can explicitly confirm each inbound message', async () => {
  const deps = dependencies();
  const at = new Date('2026-10-02T04:00:00Z');
  await assert.rejects(
    acknowledgeCustomerEmail(deps, { id: 2 }, 11, at),
    { statusCode: 403 }
  );
  assert.equal(deps.calls.length, 0);
  const result = await acknowledgeCustomerEmail(deps, { id: 7 }, 11, at);
  assert.equal(result.confirmation.confirmedBy, 7);
  assert.deepEqual(deps.calls[0], [11, 7, at]);
});

test('old mail is not eligible for receipt confirmation and a page read does not confirm it', async () => {
  const deps = dependencies({
    emailResponseRepository: { async acknowledge() { return null; } }
  });
  await assert.rejects(
    acknowledgeCustomerEmail(deps, { id: 7 }, 11),
    { statusCode: 409 }
  );
});

test('eight-natural-hour reminder processing respects write maintenance and queues linked then pending mail', async () => {
  const calls = [];
  const repo = {
    async queueDueLinkedReminders(at) { calls.push(['linked', at]); return { created: 2, queued_sms: 2 }; },
    async queueDueUnassignedReminders(at) { calls.push(['unassigned', at]); return { created: 1 }; }
  };
  const at = new Date('2026-10-02T04:00:00Z');
  const paused = await processEmailReplyReminders(repo, {
    at, writeMaintenanceFlagPath: '/run/bestcrm/write-maintenance', writeMaintenanceFlagExists: () => true
  });
  assert.equal(paused.paused, true);
  assert.equal(calls.length, 0);
  const result = await processEmailReplyReminders(repo, { at });
  assert.deepEqual(result, { paused: false, linked: 2, unassigned: 1, smsQueued: 2 });
  assert.deepEqual(calls, [['linked', at], ['unassigned', at]]);
});
