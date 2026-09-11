import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEmailIntakeMailboxAssignments,
  loadEmailIntakeSources,
  normalizeEmailIntakeSources
} from '../../src/config/emailIntakeAccounts.mjs';

function config() {
  return {
    emailIntake: {
      enabled: true,
      accountsFile: '/etc/bestcrm/email-intake-accounts.json',
      host: 'imap.qiye.163.com',
      port: 993,
      secure: true,
      pollIntervalMs: 300000,
      maxMessages: 20,
      markSeen: false
    }
  };
}

test('personal email intake accounts expand into inbound and sent mailbox sources', () => {
  const sources = normalizeEmailIntakeSources(config(), [{
    address: 'MarkYang@SUNKAIER.COM',
    passwordEnv: 'EMAIL_INTAKE_PASSWORD_MARKYANG',
    historicalSince: '2026-01-01',
    folders: [
      { name: 'INBOX', direction: 'inbound' },
      { name: 'Sent Messages', direction: 'outbound', historicalSince: '2026-03-01' }
    ]
  }], { env: { EMAIL_INTAKE_PASSWORD_MARKYANG: 'imap-authorization-code' } });

  assert.deepEqual(sources.map((source) => ({
    mailboxKey: source.mailboxKey,
    mailbox: source.mailbox,
    direction: source.direction,
    user: source.user,
    historicalSince: source.historicalSince
  })), [{
    mailboxKey: 'markyang@sunkaier.com',
    mailbox: 'INBOX',
    direction: 'inbound',
    user: 'markyang@sunkaier.com',
    historicalSince: '2026-01-01'
  }, {
    mailboxKey: 'markyang@sunkaier.com',
    mailbox: 'Sent Messages',
    direction: 'outbound',
    user: 'markyang@sunkaier.com',
    historicalSince: '2026-03-01'
  }]);
});

test('accounts file loader does not expose authorization passwords in parse errors', () => {
  assert.throws(() => loadEmailIntakeSources(config(), {
    readFile: () => '{"accounts":[{"password":"secret-value"}',
    accountsFile: '/secure/accounts.json'
  }), (error) => {
    assert.doesNotMatch(error.message, /secret-value/);
    assert.match(error.message, /Invalid email intake accounts JSON/);
    return true;
  });
});

test('spam, junk, trash, and deleted folders are excluded from personal mailbox import', () => {
  assert.throws(() => normalizeEmailIntakeSources(config(), [{
    address: 'helena@sunkaier.com',
    password: 'imap-authorization-code',
    folders: [{ name: 'Junk', direction: 'inbound' }]
  }]), /cannot be imported/);
  assert.throws(() => normalizeEmailIntakeSources(config(), [{
    address: 'helena@sunkaier.com',
    password: 'imap-authorization-code',
    folders: [{ name: '已删除邮件', direction: 'inbound' }]
  }]), /cannot be imported/);
});

test('duplicate personal mailbox accounts fail closed', () => {
  assert.throws(() => normalizeEmailIntakeSources(config(), [{
    address: 'amber@sunkaier.com', password: 'one'
  }, {
    address: 'AMBER@SUNKAIER.COM', password: 'two'
  }]), /Duplicate email intake account/);
});

test('multi-mailbox intake cannot mark employee email as read', () => {
  const configured = config();
  configured.emailIntake.markSeen = true;
  const [source] = normalizeEmailIntakeSources(configured, [{
    address: 'john@sunkaier.com', password: 'authorization-code'
  }]);
  assert.equal(source.markSeen, false);
  assert.throws(() => normalizeEmailIntakeSources(configured, [{
    address: 'john@sunkaier.com', password: 'authorization-code', markSeen: true
  }]), /cannot change provider read state/);
});

test('historical import date and authorization environment names fail closed', () => {
  assert.throws(() => normalizeEmailIntakeSources(config(), [{
    address: 'shelly@sunkaier.com',
    password: 'authorization-code',
    historicalSince: '09/01/2026'
  }]), /YYYY-MM-DD/);
  assert.throws(() => normalizeEmailIntakeSources(config(), [{
    address: 'shelly@sunkaier.com',
    passwordEnv: 'not-safe-name'
  }]), /environment name/);
});

test('omitted historical date imports from the mailbox earliest retained message', () => {
  const sources = normalizeEmailIntakeSources(config(), [{
    address: 'john@sunkaier.com',
    password: 'authorization-code',
    folders: [
      { name: 'INBOX', direction: 'inbound' },
      { name: 'Sent Messages', direction: 'outbound' }
    ]
  }]);

  assert.deepEqual(sources.map((source) => source.historicalSince), ['', '']);
});

test('every personal mailbox source must resolve to one active CRM user', async () => {
  const lookups = [];
  const sources = [
    { mailboxKey: 'sales@sunkaier.com' },
    { mailboxKey: 'markyang@sunkaier.com' },
    { mailboxKey: 'markyang@sunkaier.com' },
    { mailboxKey: 'helena@sunkaier.com' }
  ];
  const repository = {
    async findActivePersonalMailboxOwner(address) {
      lookups.push(address);
      return address === 'markyang@sunkaier.com' ? 1 : null;
    }
  };

  await assert.rejects(
    () => assertEmailIntakeMailboxAssignments(sources, repository),
    /helena@sunkaier.com/
  );
  assert.deepEqual(lookups, ['markyang@sunkaier.com', 'helena@sunkaier.com']);
});
