import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { writeMaintenance } from '../../src/middleware/writeMaintenance.mjs';

function createHarness({ active }) {
  const app = express();
  app.use(express.json());
  app.use(writeMaintenance({
    flagPath: '/run/bestcrm/write-maintenance',
    flagExists: () => active
  }));
  app.get('/records', (req, res) => res.json({ ok: true, maintenance: res.locals.writeMaintenanceActive }));
  app.post('/records', (req, res) => res.json({ ok: true }));
  app.post('/login', (req, res) => res.json({ ok: true }));
  app.post('/login/verify-totp', (req, res) => res.json({ ok: true }));
  app.post('/logout', (req, res) => res.json({ ok: true }));
  return app;
}

test('write maintenance keeps reads available and exposes banner state', async () => {
  const response = await request(createHarness({ active: true })).get('/records');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, maintenance: true });
});

test('write maintenance rejects business mutations with retry metadata', async () => {
  const response = await request(createHarness({ active: true }))
    .post('/records')
    .set('Accept', 'application/json')
    .send({ name: 'blocked' });

  assert.equal(response.status, 503);
  assert.equal(response.headers['retry-after'], '60');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.code, 'write_maintenance');
});

test('write maintenance leaves authentication continuity available', async () => {
  const app = createHarness({ active: true });
  assert.equal((await request(app).post('/login')).status, 200);
  assert.equal((await request(app).post('/login/verify-totp')).status, 200);
  assert.equal((await request(app).post('/logout')).status, 200);
});

test('write maintenance is transparent when the flag is absent', async () => {
  const response = await request(createHarness({ active: false })).post('/records').send({ name: 'saved' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});
