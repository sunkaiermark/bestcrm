import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAIL_PROVIDER_CAPABILITIES,
  MAIL_PROVIDER_NAMES,
  MailProviderCapabilityError,
  MailProviderContractError,
  defineMailProviderAdapter
} from '../../src/domain/mailProvider.mjs';

function completeClient() {
  return {
    verifyConnection: async () => ({ ok: true }),
    getProfile: async () => ({ emailAddress: 'sales@sunkaier.com' }),
    listChanges: async (cursor) => ({ cursor, messages: [] }),
    getMessage: async (id) => ({ id }),
    sendMessage: async (message) => ({ id: message.id }),
    startWatch: async () => ({ expiration: 1 }),
    renewWatch: async () => ({ expiration: 2 }),
    stopWatch: async () => ({ stopped: true })
  };
}

test('mail provider adapter normalizes identity and exposes declared capabilities', async () => {
  const adapter = defineMailProviderAdapter({
    providerName: ' Google_Gmail ',
    mailboxAddress: ' SALES@SUNKAIER.COM ',
    capabilities: [
      MAIL_PROVIDER_CAPABILITIES.PUSH,
      MAIL_PROVIDER_CAPABILITIES.OUTBOUND,
      MAIL_PROVIDER_CAPABILITIES.INBOUND,
      MAIL_PROVIDER_CAPABILITIES.INBOUND
    ],
    client: completeClient()
  });

  assert.equal(adapter.providerName, MAIL_PROVIDER_NAMES.GOOGLE_GMAIL);
  assert.equal(adapter.mailboxAddress, 'sales@sunkaier.com');
  assert.deepEqual(adapter.capabilities, ['inbound', 'outbound', 'push']);
  assert.equal(adapter.supports('INBOUND'), true);
  assert.deepEqual(await adapter.getMessage('gmail-1'), { id: 'gmail-1' });
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(Object.isFrozen(adapter.capabilities), true);
});

test('mail provider adapter validates required operations for its capabilities', () => {
  const client = completeClient();
  delete client.getMessage;

  assert.throws(
    () => defineMailProviderAdapter({
      providerName: MAIL_PROVIDER_NAMES.GOOGLE_GMAIL,
      mailboxAddress: 'sales@sunkaier.com',
      capabilities: [MAIL_PROVIDER_CAPABILITIES.INBOUND],
      client
    }),
    (error) => error instanceof MailProviderContractError
      && /getMessage/.test(error.message)
  );
});

test('push capability requires inbound and unsupported calls fail explicitly', () => {
  assert.throws(
    () => defineMailProviderAdapter({
      providerName: MAIL_PROVIDER_NAMES.GOOGLE_GMAIL,
      mailboxAddress: 'sales@sunkaier.com',
      capabilities: [MAIL_PROVIDER_CAPABILITIES.PUSH],
      client: completeClient()
    }),
    /push capability requires inbound capability/
  );

  const adapter = defineMailProviderAdapter({
    providerName: MAIL_PROVIDER_NAMES.IMAP_SMTP,
    mailboxAddress: 'sales@sunkaier.com',
    capabilities: [MAIL_PROVIDER_CAPABILITIES.INBOUND],
    client: completeClient()
  });
  assert.throws(
    () => adapter.sendMessage({ id: 'outbound-1' }),
    (error) => error instanceof MailProviderCapabilityError
      && error.capability === MAIL_PROVIDER_CAPABILITIES.OUTBOUND
  );
});

test('mail provider adapter rejects invalid provider names, mailboxes, and capabilities', () => {
  for (const options of [
    { providerName: '../gmail', mailboxAddress: 'sales@sunkaier.com', capabilities: [] },
    { providerName: 'google_gmail', mailboxAddress: 'not-an-email', capabilities: [] },
    { providerName: 'google_gmail', mailboxAddress: 'sales@sunkaier.com', capabilities: ['admin'] },
    { providerName: 'google_gmail', mailboxAddress: 'sales@sunkaier.com', capabilities: 'inbound' }
  ]) {
    assert.throws(
      () => defineMailProviderAdapter({ ...options, client: completeClient() }),
      MailProviderContractError
    );
  }
});
