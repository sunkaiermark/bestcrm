import { readFileSync, statSync } from 'node:fs';

const COMPANY_MAILBOX_PATTERN = /^[^\s@<>]+@sunkaier[.]com$/i;
const EXCLUDED_FOLDER_PATTERN = /(^|[\/._ -])(spam|junk|trash|deleted)([\/._ -]|$)|垃圾|广告|已删除|删除|废件/i;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function text(value) {
  return String(value || '').trim();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseAccounts(contents, sourceName) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid email intake accounts JSON: ${sourceName}`);
  }
  const accounts = Array.isArray(parsed) ? parsed : parsed?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('Email intake accounts file must contain a non-empty accounts array');
  }
  return accounts;
}

function normalizeHistoricalSince(value, accountAddress, mailbox) {
  const input = text(value);
  if (!input) return '';
  const parsed = new Date(`${input}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== input) {
    throw new Error(`Historical import date must be YYYY-MM-DD for ${accountAddress}/${mailbox}`);
  }
  return input;
}

function normalizeFolder(folder, accountAddress, accountHistoricalSince) {
  const mailbox = text(typeof folder === 'string' ? folder : folder?.name);
  const direction = text(typeof folder === 'string' ? '' : folder?.direction).toLowerCase() || 'inbound';
  if (!mailbox) throw new Error(`Mailbox folder is required for ${accountAddress}`);
  if (!['inbound', 'outbound'].includes(direction)) {
    throw new Error(`Mailbox folder direction must be inbound or outbound for ${accountAddress}`);
  }
  if (EXCLUDED_FOLDER_PATTERN.test(mailbox)) {
    throw new Error(`Spam, junk, trash, and deleted folders cannot be imported: ${accountAddress}/${mailbox}`);
  }
  return {
    mailbox,
    direction,
    historicalSince: normalizeHistoricalSince(
      typeof folder === 'string' ? accountHistoricalSince : folder?.historicalSince || accountHistoricalSince,
      accountAddress,
      mailbox
    )
  };
}

function authorizationPassword(account, env, address) {
  const passwordEnv = text(account?.passwordEnv);
  if (passwordEnv && !ENV_NAME_PATTERN.test(passwordEnv)) {
    throw new Error(`Invalid authorization password environment name for ${address}`);
  }
  return String(account?.password || (passwordEnv ? env[passwordEnv] : '') || '');
}

export function normalizeEmailIntakeSources(config, accounts, { env = process.env } = {}) {
  const defaults = config.emailIntake || {};
  const seenAddresses = new Set();
  const seenSources = new Set();
  const sources = [];

  for (const account of accounts) {
    if (account?.enabled === false) continue;
    const address = text(account?.address || account?.mailboxKey || account?.user).toLowerCase();
    if (!COMPANY_MAILBOX_PATTERN.test(address)) {
      throw new Error(`Personal email intake address must use @sunkaier.com: ${address || '(blank)'}`);
    }
    if (seenAddresses.has(address)) throw new Error(`Duplicate email intake account: ${address}`);
    seenAddresses.add(address);

    const host = text(account.host || defaults.host);
    const user = text(account.user || address);
    const password = authorizationPassword(account, env, address);
    if (!host || !user || !password) {
      throw new Error(`IMAP host, user, and authorization password are required for ${address}`);
    }
    const folders = Array.isArray(account.folders) && account.folders.length
      ? account.folders
      : [{ name: 'INBOX', direction: 'inbound' }];
    if (account.markSeen === true) {
      throw new Error(`Personal mailbox intake cannot change provider read state: ${address}`);
    }

    for (const folder of folders.map((value) => normalizeFolder(value, address, account.historicalSince))) {
      const sourceKey = `${address}\n${folder.mailbox.toLowerCase()}`;
      if (seenSources.has(sourceKey)) {
        throw new Error(`Duplicate email intake folder: ${address}/${folder.mailbox}`);
      }
      seenSources.add(sourceKey);
      sources.push({
        enabled: true,
        host,
        port: positiveInteger(account.port, defaults.port || 993),
        secure: account.secure === undefined ? defaults.secure !== false : account.secure !== false,
        user,
        password,
        mailbox: folder.mailbox,
        mailboxKey: address,
        direction: folder.direction,
        historicalSince: folder.historicalSince,
        pollIntervalMs: positiveInteger(account.pollIntervalMs, defaults.pollIntervalMs || 300000),
        maxMessages: Math.min(positiveInteger(account.maxMessages, defaults.maxMessages || 20), 50),
        markSeen: false
      });
    }
  }
  if (!sources.length) throw new Error('Email intake accounts file has no enabled mailbox sources');
  return sources;
}

export function loadEmailIntakeSources(config, {
  readFile = readFileSync,
  statFile = readFile === readFileSync ? statSync : null,
  accountsFile = config.emailIntake?.accountsFile,
  env = process.env
} = {}) {
  const filePath = text(accountsFile);
  if (!filePath) {
    return [{ ...config.emailIntake, direction: 'inbound' }];
  }
  if (statFile && process.platform !== 'win32') {
    const mode = statFile(filePath).mode & 0o777;
    if ((mode & 0o027) !== 0) {
      throw new Error('Email intake accounts file must not be writable by group or accessible by others');
    }
  }
  const accounts = parseAccounts(readFile(filePath, 'utf8'), filePath);
  return normalizeEmailIntakeSources(config, accounts, { env });
}

export async function assertEmailIntakeMailboxAssignments(
  sources,
  emailArchiveRepository,
  { sharedMailboxKey = 'sales@sunkaier.com' } = {}
) {
  const shared = text(sharedMailboxKey).toLowerCase();
  const personalAddresses = [...new Set(sources
    .map((source) => text(source.mailboxKey).toLowerCase())
    .filter((address) => address && address !== shared))];
  for (const address of personalAddresses) {
    const ownerId = await emailArchiveRepository.findActivePersonalMailboxOwner(address);
    if (!ownerId) throw new Error(`Personal mailbox is not assigned to an active CRM user: ${address}`);
  }
  return personalAddresses.length;
}
