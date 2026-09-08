import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerUrl = new URL('../../scripts/install-email-intake-service.sh', import.meta.url);
const workerUrl = new URL('../../scripts/poll-email-inquiries.mjs', import.meta.url);

test('email intake service installer is fail-closed and uses the deployed worker', async () => {
  const source = await readFile(installerUrl, 'utf8');

  assert.match(source, /WorkingDirectory=\$\{APP_ROOT\}\/app/);
  assert.match(source, /EnvironmentFile=\$\{ENV_FILE\}/);
  assert.match(source, /ExecStart=\/usr\/bin\/node scripts\/poll-email-inquiries\.mjs/);
  assert.match(source, /Restart=on-failure/);
  assert.match(source, /RestartSec=300/);
  assert.match(source, /StartLimitBurst=3/);
  assert.match(source, /PrivateTmp=false/);
  assert.doesNotMatch(source, /PrivateTmp=true/);
  assert.match(source, /The unit was not enabled or started/);
  assert.doesNotMatch(source, /systemctl (?:enable|start|restart) bestcrm-email-intake/);
});

test('email intake worker cancels its polling wait during graceful shutdown', async () => {
  const source = await readFile(workerUrl, 'utf8');

  assert.match(source, /const stopController = new AbortController\(\);/);
  assert.match(source, /stopController\.abort\(\);/);
  assert.match(source, /delay\(intervalMs, undefined, \{ signal: stopController\.signal \}\)/);
  assert.match(source, /wait: waitForNextPoll/);
  assert.match(source, /await waitForNextPoll\(config\.emailIntake\.pollIntervalMs\)/);
});
