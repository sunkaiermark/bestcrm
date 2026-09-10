import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormSubmissionRepository } from '../../src/repositories/formSubmissionRepository.mjs';

function row(overrides = {}) {
  return {
    token: 'submission_token_123456789',
    actor_user_id: 7,
    request_method: 'POST',
    request_path: '/opportunities/30/workflow',
    state: 'processing',
    response_status: null,
    response_location: '',
    newly_claimed: true,
    created_at: '2026-09-11T01:00:00Z',
    completed_at: null,
    ...overrides
  };
}

test('form submission repository atomically claims one token', async () => {
  const calls = [];
  const repository = createFormSubmissionRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [row()] };
    }
  });

  const result = await repository.claim({
    token: 'submission_token_123456789',
    actorUserId: 7,
    requestMethod: 'POST',
    requestPath: '/opportunities/30/workflow'
  });

  assert.equal(result.newlyClaimed, true);
  assert.equal(result.actorUserId, 7);
  assert.match(calls[0].sql, /ON CONFLICT \(token\) DO NOTHING/);
  assert.deepEqual(calls[0].params, [
    'submission_token_123456789', 7, 'POST', '/opportunities/30/workflow'
  ]);
});

test('form submission repository completes and releases only the matching processing action', async () => {
  const calls = [];
  const repository = createFormSubmissionRepository({
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('UPDATE')) {
        return { rows: [row({ state: 'completed', response_status: 302, response_location: '/opportunities/30' })] };
      }
      return { rows: [], rowCount: 1 };
    }
  });

  const completed = await repository.complete({
    token: 'submission_token_123456789',
    actorUserId: 7,
    requestMethod: 'POST',
    requestPath: '/opportunities/30/workflow',
    state: 'completed',
    responseStatus: 302,
    responseLocation: '/opportunities/30'
  });
  const released = await repository.release({
    token: 'submission_token_123456789',
    actorUserId: 7,
    requestMethod: 'POST',
    requestPath: '/opportunities/30/workflow'
  });

  assert.equal(completed.state, 'completed');
  assert.equal(released, true);
  assert.match(calls[0].sql, /state = 'processing'/);
  assert.match(calls[1].sql, /DELETE FROM form_submission_idempotency/);
});
