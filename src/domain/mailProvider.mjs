const PROVIDER_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export const MAIL_PROVIDER_CAPABILITIES = Object.freeze({
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
  PUSH: 'push'
});

export const MAIL_PROVIDER_NAMES = Object.freeze({
  GOOGLE_GMAIL: 'google_gmail',
  IMAP_SMTP: 'imap_smtp'
});

const CAPABILITY_OPERATIONS = Object.freeze({
  [MAIL_PROVIDER_CAPABILITIES.INBOUND]: Object.freeze(['listChanges', 'getMessage']),
  [MAIL_PROVIDER_CAPABILITIES.OUTBOUND]: Object.freeze(['sendMessage']),
  [MAIL_PROVIDER_CAPABILITIES.PUSH]: Object.freeze(['startWatch', 'renewWatch', 'stopWatch'])
});

const BASE_OPERATIONS = Object.freeze(['verifyConnection', 'getProfile']);
const ALL_OPERATIONS = Object.freeze([
  ...BASE_OPERATIONS,
  ...new Set(Object.values(CAPABILITY_OPERATIONS).flat())
]);

export class MailProviderContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailProviderContractError';
  }
}

export class MailProviderCapabilityError extends Error {
  constructor(providerName, capability) {
    super(`Mail provider ${providerName} does not support ${capability}`);
    this.name = 'MailProviderCapabilityError';
    this.providerName = providerName;
    this.capability = capability;
  }
}

export function normalizeMailProviderName(value) {
  const providerName = String(value || '').trim().toLowerCase();
  if (!PROVIDER_NAME_PATTERN.test(providerName)) {
    throw new MailProviderContractError('Mail provider name is invalid');
  }
  return providerName;
}

export function normalizeMailboxAddress(value) {
  const mailboxAddress = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(mailboxAddress)) {
    throw new MailProviderContractError('Mail provider mailbox address is invalid');
  }
  return mailboxAddress;
}

function normalizeCapabilities(values) {
  if (!Array.isArray(values)) {
    throw new MailProviderContractError('Mail provider capabilities must be an array');
  }
  const supported = new Set(Object.values(MAIL_PROVIDER_CAPABILITIES));
  const capabilities = [...new Set((values || []).map((value) => String(value || '').trim().toLowerCase()))]
    .filter(Boolean)
    .sort();
  for (const capability of capabilities) {
    if (!supported.has(capability)) {
      throw new MailProviderContractError(`Unknown mail provider capability: ${capability}`);
    }
  }
  if (capabilities.includes(MAIL_PROVIDER_CAPABILITIES.PUSH)
    && !capabilities.includes(MAIL_PROVIDER_CAPABILITIES.INBOUND)) {
    throw new MailProviderContractError('Mail provider push capability requires inbound capability');
  }
  return Object.freeze(capabilities);
}

function requiredOperations(capabilities) {
  return [
    ...BASE_OPERATIONS,
    ...new Set(capabilities.flatMap((capability) => CAPABILITY_OPERATIONS[capability]))
  ];
}

export function defineMailProviderAdapter({
  providerName,
  mailboxAddress,
  capabilities = [],
  client
} = {}) {
  const normalizedProviderName = normalizeMailProviderName(providerName);
  const normalizedMailboxAddress = normalizeMailboxAddress(mailboxAddress);
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  if (!client || typeof client !== 'object') {
    throw new MailProviderContractError('Mail provider client is required');
  }

  for (const operation of requiredOperations(normalizedCapabilities)) {
    if (typeof client[operation] !== 'function') {
      throw new MailProviderContractError(`Mail provider operation is required: ${operation}`);
    }
  }

  const adapter = {
    providerName: normalizedProviderName,
    mailboxAddress: normalizedMailboxAddress,
    capabilities: normalizedCapabilities,
    supports(capability) {
      return normalizedCapabilities.includes(String(capability || '').trim().toLowerCase());
    }
  };

  for (const operation of ALL_OPERATIONS) {
    adapter[operation] = (...args) => {
      const requiredCapability = Object.entries(CAPABILITY_OPERATIONS)
        .find(([, operations]) => operations.includes(operation))?.[0];
      if (requiredCapability && !adapter.supports(requiredCapability)) {
        throw new MailProviderCapabilityError(normalizedProviderName, requiredCapability);
      }
      if (typeof client[operation] !== 'function') {
        throw new MailProviderContractError(`Mail provider operation is unavailable: ${operation}`);
      }
      return client[operation](...args);
    };
  }

  return Object.freeze(adapter);
}
