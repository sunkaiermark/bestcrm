import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;

async function executable(filePath, contents) {
  await writeFile(filePath, contents, { mode: 0o755 });
}

function runScript(scriptPath, env) {
  return spawnSync('bash', [scriptPath], {
    encoding: 'utf8', env, timeout: 30_000
  });
}

async function scheduledFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-scheduled-backup-'));
  const bin = path.join(directory, 'bin');
  const state = path.join(directory, 'state');
  const app = path.join(directory, 'app');
  const flag = path.join(directory, 'run', 'write-maintenance');
  const backupScript = path.join(directory, 'fake-backup.sh');
  const verifier = path.join(app, 'scripts', 'verify-backup-artifacts.mjs');
  await mkdir(bin);
  await mkdir(state);
  await mkdir(path.dirname(verifier), { recursive: true });
  await writeFile(path.join(app, 'scripts', 'write-maintenance-capable'), 'yes\n');
  await writeFile(verifier, '// fixture verifier\n');
  await writeFile(path.join(state, 'bestcrm.service'), 'active\n');
  await writeFile(path.join(state, 'bestcrm-email-intake.service'), 'active\n');
  await writeFile(path.join(state, 'bestcrm-email-backfill.service'), 'inactive\n');
  await executable(path.join(bin, 'systemctl'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'action="$1"',
    'if [ "$action" = "is-active" ]; then',
    '  service="$3"',
    '  [ "$(<"$MOCK_ROOT/state/$service")" = "active" ]',
    'elif [ "$action" = "stop" ]; then',
    '  service="$2"',
    '  echo "stop $service" >> "$MOCK_ROOT/events"',
    '  [ "${MOCK_STOP_FAIL:-0}" != "1" ] || exit 33',
    '  echo inactive > "$MOCK_ROOT/state/$service"',
    'elif [ "$action" = "start" ]; then',
    '  service="$2"',
    '  echo "start $service" >> "$MOCK_ROOT/events"',
    '  [ "${MOCK_START_FAIL:-0}" != "1" ] || exit 34',
    '  echo active > "$MOCK_ROOT/state/$service"',
    'elif [ "$action" = "reset-failed" ]; then',
    '  exit 0',
    'else',
    '  exit 64',
    'fi',
    ''
  ].join('\n'));
  await executable(path.join(bin, 'curl'), '#!/usr/bin/env bash\nexit 0\n');
  await executable(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  await executable(backupScript, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'echo backup >> "$MOCK_ROOT/events"',
    '[ "$BESTCRM_ALLOW_APP_DURING_BACKUP" = "true" ]',
    '[ -f "$BESTCRM_WRITE_MAINTENANCE_FLAG" ]',
    '[ "$(<"$MOCK_ROOT/state/bestcrm-email-intake.service")" = "inactive" ]',
    '[ "${MOCK_BACKUP_FAIL:-0}" != "1" ] || exit 42',
    'echo "BESTCRM backup verified: $MOCK_ROOT/backup"',
    'echo "BESTCRM backup completed: $MOCK_ROOT/backup"',
    ''
  ].join('\n'));
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_ROOT: directory,
    BESTCRM_APP_DIR: app,
    BESTCRM_BACKUP_SCRIPT: backupScript,
    BESTCRM_BACKUP_VERIFIER: verifier,
    BESTCRM_DEPLOY_LOCK: path.join(directory, 'deploy.lock'),
    BESTCRM_WRITE_MAINTENANCE_FLAG: flag,
    BESTCRM_MAINTENANCE_DRAIN_SECONDS: '0'
  };
  return { directory, env, flag, state };
}

test('scheduled backup safely restores intake and removes only its own maintenance flag',
  { skip: !linuxRoot }, async () => {
    const fixture = await scheduledFixture();
    try {
      const result = runScript(path.join(root, 'scripts', 'backup-production-scheduled.sh'), fixture.env);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /BESTCRM scheduled backup finished/);
      assert.deepEqual((await readFile(path.join(fixture.directory, 'events'), 'utf8')).trim().split('\n'), [
        'stop bestcrm-email-intake.service', 'backup', 'start bestcrm-email-intake.service'
      ]);
      assert.equal((await readFile(path.join(fixture.state, 'bestcrm-email-intake.service'), 'utf8')).trim(), 'active');
      await assert.rejects(readFile(fixture.flag), { code: 'ENOENT' });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

test('scheduled backup restores service state after backup or service-stop failure',
  { skip: !linuxRoot }, async () => {
    for (const fault of ['MOCK_BACKUP_FAIL', 'MOCK_STOP_FAIL']) {
      const fixture = await scheduledFixture();
      try {
        const result = runScript(path.join(root, 'scripts', 'backup-production-scheduled.sh'), {
          ...fixture.env, [fault]: '1'
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /attempted to restore normal operation/);
        assert.equal((await readFile(path.join(fixture.state, 'bestcrm-email-intake.service'), 'utf8')).trim(), 'active');
        await assert.rejects(readFile(fixture.flag), { code: 'ENOENT' });
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }
  });

test('scheduled backup refuses an existing maintenance owner without changing services',
  { skip: !linuxRoot }, async () => {
    const fixture = await scheduledFixture();
    try {
      await mkdir(path.dirname(fixture.flag), { recursive: true });
      await writeFile(fixture.flag, 'owned by another operation\n');
      const result = runScript(path.join(root, 'scripts', 'backup-production-scheduled.sh'), fixture.env);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Another operation owns/);
      assert.equal(await readFile(fixture.flag, 'utf8'), 'owned by another operation\n');
      assert.equal((await readFile(path.join(fixture.state, 'bestcrm-email-intake.service'), 'utf8')).trim(), 'active');
      await assert.rejects(readFile(path.join(fixture.directory, 'events')), { code: 'ENOENT' });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

test('scheduled backup refuses active historical backfill without changing services',
  { skip: !linuxRoot }, async () => {
    const fixture = await scheduledFixture();
    try {
      await writeFile(path.join(fixture.state, 'bestcrm-email-backfill.service'), 'active\n');
      const result = runScript(path.join(root, 'scripts', 'backup-production-scheduled.sh'), fixture.env);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Historical email backfill is active/);
      assert.equal((await readFile(path.join(fixture.state, 'bestcrm-email-intake.service'), 'utf8')).trim(), 'active');
      await assert.rejects(readFile(fixture.flag), { code: 'ENOENT' });
      await assert.rejects(readFile(path.join(fixture.directory, 'events')), { code: 'ENOENT' });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

test('scheduled backup reports a failed email-intake restart instead of claiming success',
  { skip: !linuxRoot }, async () => {
    const fixture = await scheduledFixture();
    try {
      const result = runScript(path.join(root, 'scripts', 'backup-production-scheduled.sh'), {
        ...fixture.env, MOCK_START_FAIL: '1'
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Failed to restore email intake/);
      assert.doesNotMatch(result.stdout, /normal writes and email intake restored/);
      await assert.rejects(readFile(fixture.flag), { code: 'ENOENT' });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

test('production backup verifies before pruning and discards an unverified new backup',
  { skip: !linuxRoot }, async () => {
    for (const failVerification of [false, true]) {
      const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-backup-order-'));
      try {
        const bin = path.join(directory, 'bin');
        const app = path.join(directory, 'app');
        const backupDir = path.join(directory, 'backups');
        const uploads = path.join(directory, 'uploads');
        const oldBackup = path.join(backupDir, '20260901-010101');
        await mkdir(bin);
        await mkdir(path.join(app, 'scripts'), { recursive: true });
        await mkdir(oldBackup, { recursive: true });
        await mkdir(uploads);
        await writeFile(path.join(oldBackup, 'manifest.txt'), 'previous verified backup\n');
        await writeFile(path.join(uploads, 'document.txt'), 'customer attachment\n');
        await writeFile(path.join(directory, 'bestcrm.env'), 'DATABASE_URL=postgres://fixture\n');
        await executable(path.join(bin, 'systemctl'), '#!/usr/bin/env bash\nexit 1\n');
        await executable(path.join(bin, 'pg_dump'), '#!/usr/bin/env bash\necho "-- fixture database dump with enough bytes to verify"\n');
        const reader = path.join(app, 'scripts', 'read-env-value.mjs');
        const exporter = path.join(app, 'scripts', 'export-attachment-evidence-inventory.mjs');
        const verifier = path.join(app, 'scripts', 'verify-backup-artifacts.mjs');
        await writeFile(reader, "process.stdout.write('postgres://fixture');\n");
        await writeFile(exporter, [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync(process.argv[process.argv.indexOf('--output') + 1], '');",
          "process.stdout.write(JSON.stringify({ fileCount: 0, totalBytes: 0, unverifiedCount: 0 }));",
          ''
        ].join('\n'));
        await writeFile(verifier, failVerification
          ? 'process.exit(45);\n'
          : "import { existsSync } from 'node:fs';\n"
            + "const dir = process.argv[process.argv.indexOf('--backup-dir') + 1];\n"
            + "if (!existsSync(`${dir}/manifest.txt`)) process.exit(46);\n");
        const result = runScript(path.join(root, 'scripts', 'backup-production.sh'), {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          BESTCRM_APP_DIR: app,
          BESTCRM_ENV_FILE: path.join(directory, 'bestcrm.env'),
          BESTCRM_BACKUP_DIR: backupDir,
          BESTCRM_UPLOAD_DIR: uploads,
          BESTCRM_BACKUP_VERIFIER: failVerification
            ? verifier
            : path.join(root, 'scripts', 'verify-backup-artifacts.mjs'),
          BESTCRM_BACKUP_KEEP_DAYS: '1'
        });
        const entries = await readdir(backupDir);
        if (failVerification) {
          assert.notEqual(result.status, 0);
          assert.deepEqual(entries, ['20260901-010101']);
          assert.match(result.stderr, /Removing incomplete or unverified backup/);
        } else {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(entries.length, 1);
          assert.notEqual(entries[0], '20260901-010101');
          assert.match(result.stdout, /BESTCRM backup verified:/);
          assert.match(result.stdout, /BESTCRM backup completed:/);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

test('cron template invokes guarded backup and never calls the raw backup directly', async () => {
  const cron = await readFile(path.join(root, 'docs', 'deployment', 'templates', 'bestcrm-backup.cron'), 'utf8');
  const compatibility = await readFile(path.join(root, 'docs', 'deployment', 'templates', 'backup-bestcrm.sh'), 'utf8');
  assert.match(cron, /backup-production-scheduled\.sh/);
  assert.doesNotMatch(cron, /\/backup-production\.sh/);
  assert.match(compatibility, /exec bash \/opt\/bestcrm\/scripts\/backup-production-scheduled\.sh/);
  assert.doesNotMatch(compatibility, /\. "\$ENV_FILE"/);
});
