import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { csrfProtection } from '../../src/middleware/csrf.mjs';
import { submissionGuard } from '../../src/middleware/submissionGuard.mjs';

function memoryRepository() {
  const records = new Map();
  return {
    records,
    async claim(input) {
      const existing = records.get(input.token);
      if (existing) return { ...existing, newlyClaimed: false };
      const record = { ...input, state: 'processing', responseStatus: null, responseLocation: '' };
      records.set(input.token, record);
      return { ...record, newlyClaimed: true };
    },
    async complete(input) {
      const record = records.get(input.token);
      if (!record || record.state !== 'processing') return null;
      Object.assign(record, {
        state: input.state,
        responseStatus: input.responseStatus,
        responseLocation: input.responseLocation
      });
      return { ...record };
    },
    async release(input) {
      return records.delete(input.token);
    }
  };
}

function buildApp(repository) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.currentUser = { id: 7 };
    next();
  });
  app.use(submissionGuard({ repository, logger: { error() {} } }));
  let saves = 0;
  app.post('/save', async (req, res) => {
    saves += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    res.redirect('/saved');
  });
  app.post('/invalid', (req, res) => {
    saves += 1;
    res.status(400).send('invalid');
  });
  app.get('/count', (req, res) => res.json({ saves }));
  return app;
}

test('submission guard lets one concurrent request mutate and blocks the duplicate', async () => {
  const repository = memoryRepository();
  const app = buildApp(repository);
  const token = 'concurrent_submission_token_12345';

  const [first, second] = await Promise.all([
    request(app).post('/save').type('form').send({ _submissionToken: token }),
    request(app).post('/save').type('form').send({ _submissionToken: token })
  ]);

  assert.deepEqual([first.status, second.status].sort(), [302, 409]);
  assert.equal((await request(app).get('/count')).body.saves, 1);

  const replay = await request(app).post('/save').type('form').send({ _submissionToken: token });
  assert.equal(replay.status, 303);
  assert.equal(replay.headers.location, '/saved');
  assert.equal((await request(app).get('/count')).body.saves, 1);
});

test('submission guard releases a token after a correctable client error', async () => {
  const repository = memoryRepository();
  const app = buildApp(repository);
  const token = 'correctable_submission_token_12345';

  assert.equal((await request(app).post('/invalid').type('form').send({ _submissionToken: token })).status, 400);
  assert.equal(repository.records.has(token), false);
  assert.equal((await request(app).post('/invalid').type('form').send({ _submissionToken: token })).status, 400);
  assert.equal((await request(app).get('/count')).body.saves, 2);
});

test('submission guard rejects a token reused for another action', async () => {
  const repository = memoryRepository();
  repository.records.set('reused_submission_token_12345', {
    token: 'reused_submission_token_12345',
    actorUserId: 8,
    requestMethod: 'POST',
    requestPath: '/save',
    state: 'completed',
    responseStatus: 302,
    responseLocation: '/saved'
  });
  const app = buildApp(repository);

  const response = await request(app)
    .post('/save')
    .type('form')
    .send({ _submissionToken: 'reused_submission_token_12345' });

  assert.equal(response.status, 409);
  assert.match(response.text, /does not belong/);
});

test('csrf helper gives every rendered form its own submission token', () => {
  const req = { method: 'GET', session: {}, body: {}, get() { return ''; } };
  const res = { locals: {}, status() { return this; }, send() {} };
  let nextCalled = false;
  csrfProtection({ enabled: true })(req, res, () => { nextCalled = true; });

  const first = res.locals.csrfField();
  const second = res.locals.csrfField();
  const firstToken = first.match(/name="_submissionToken" value="([^"]+)"/)[1];
  const secondToken = second.match(/name="_submissionToken" value="([^"]+)"/)[1];

  assert.equal(nextCalled, true);
  assert.notEqual(firstToken, secondToken);
  assert.match(first, /name="_csrf"/);
});
