import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerUrl = new URL('../../scripts/install-email-backfill-service.sh', import.meta.url);

test('email backfill service installer is restartable and does not auto-start', async () => {
  const source = await readFile(installerUrl, 'utf8');

  assert.match(source, /WorkingDirectory=\$\{APP_ROOT\}\/app/);
  assert.match(source, /EnvironmentFile=\$\{ENV_FILE\}/);
  assert.match(source, /ExecStart=\/usr\/bin\/node scripts\/poll-email-inquiries\.mjs --backfill-continuous/);
  assert.match(source, /Restart=on-failure/);
  assert.match(source, /RestartSec=300/);
  assert.match(source, /StartLimitBurst=3/);
  assert.match(source, /The unit was not enabled or started/);
  assert.doesNotMatch(source, /systemctl (?:enable|start|restart) bestcrm-email-backfill/);
});
