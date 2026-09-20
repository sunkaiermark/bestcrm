import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function waitForServerStart(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`Server did not start before timeout. Output:\n${output}`));
    }, 3000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('BESTCRM listening')) {
        finish(resolve, output);
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code, signal) => {
      finish(reject, new Error(`Server exited before listening. code=${code} signal=${signal} output:\n${output}`));
    });
    child.on('error', (error) => {
      finish(reject, error);
    });
  });
}

test('GET /health returns ok', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, app: 'BESTCRM' });
});

test('GET / redirects to the workbench entry', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/workbench');
});

test('application write maintenance keeps health online and blocks business mutations before routing', async () => {
  const app = createApp({
    databaseUrl: '',
    sessionSecret: 'test-secret',
    writeMaintenanceFlagExists: () => true
  });

  const health = await request(app).get('/health');
  const mutation = await request(app)
    .post('/account/password')
    .set('Accept', 'application/json')
    .send({ currentPassword: 'ignored', newPassword: 'ignored' });
  const login = await request(app).post('/login').send({ username: 'missing', password: 'missing' });

  assert.equal(health.status, 200);
  assert.equal(mutation.status, 503);
  assert.equal(mutation.body.code, 'write_maintenance');
  assert.notEqual(login.status, 503);
});

test('GET /assets/sunkaier-logo.png serves the sidebar logo', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/assets/sunkaier-logo.png');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /image\/png/);
});

test('GET /assets/sunkaier-logo-login.png serves the login logo', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/assets/sunkaier-logo-login.png');

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /image\/png/);
});

test('a database-backed app starts the durable email purge file cleanup loop', () => {
  const starts = [];
  const repository = {};
  const cleanupHandle = { stop() {} };
  const app = createApp({
    databaseUrl: '',
    sessionSecret: 'test-secret',
    pool: { query() { throw new Error('unexpected query'); } },
    sessionStore: undefined,
    userRepository: {},
    emailArchiveRepository: repository,
    uploadDir: 'C:/bestcrm-test-uploads',
    startEmailPurgeFileCleanupLoop(dependencies, options) {
      starts.push({ dependencies, options });
      return cleanupHandle;
    }
  });

  assert.equal(starts.length, 1);
  assert.equal(starts[0].dependencies.emailArchiveRepository, repository);
  assert.equal(starts[0].dependencies.uploadDir, 'C:/bestcrm-test-uploads');
  assert.equal(app.locals.emailPurgeFileCleanup, cleanupHandle);
});

test('server entrypoint starts an HTTP listener when run directly', async (t) => {
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: '0',
      SESSION_SECRET: 'test-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    child.kill();
  });

  const output = await waitForServerStart(child);

  assert.match(output, /BESTCRM listening/);
});
