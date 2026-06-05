import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';

test('GET /health returns ok', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, app: 'BESTCRM' });
});
