import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isMainModule } from '../src/utils/moduleEntry.mjs';

const execFileAsync = promisify(execFile);
const versionPattern = /^v\d{4}\.\d{2}\.\d{2}-\d{2}-rc\.\d+$/;
const disabledEmailFlags = [
  'CRM_EMAIL_CENTER_ENABLED',
  'EMAIL_INTAKE_ENABLED',
  'EMAIL_RAW_ARCHIVE_ENABLED',
  'EMAIL_RAW_MALWARE_SCAN_ENABLED',
  'EMAIL_RAW_BACKFILL_ENABLED',
  'CRM_EMAIL_SENDING_ENABLED',
  'GOOGLE_MAIL_ENABLED',
  'GOOGLE_MAIL_INBOUND_ENABLED',
  'GOOGLE_MAIL_OUTBOUND_ENABLED',
  'GOOGLE_MAIL_PUSH_ENABLED'
];

function parseEnvExample(envExample) {
  const values = new Map();
  for (const line of String(envExample || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

function normalizedPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function validateReleaseVersion(version) {
  const value = String(version || '').trim();
  if (!versionPattern.test(value)) {
    throw new Error('Release version must match vYYYY.MM.DD-NN-rc.N');
  }
  return value;
}

export function forbiddenReleasePath(filePath) {
  const value = normalizedPath(filePath);
  const basename = value.split('/').at(-1) || '';
  if (basename === '.env' || (/^\.env\./i.test(basename) && basename !== '.env.example')) return true;
  if (/(^|\/)(node_modules|\.git|\.codex-tmp|\.playwright-cli|output|coverage|playwright-report|test-results)(\/|$)/i.test(value)) return true;
  if (/(^|\/)(var\/uploads|uploads)(\/|$)/i.test(value)) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(basename)) return true;
  if (/^bestcrm-.*\.(zip|tar|tgz|tar\.gz)$/i.test(basename)) return true;
  return false;
}

export function assertSafeReleaseTree(paths) {
  const forbidden = paths.map(normalizedPath).filter(forbiddenReleasePath);
  if (forbidden.length) {
    throw new Error(`Release tree contains forbidden files: ${forbidden.join(', ')}`);
  }
  if (!paths.includes('package.json') || !paths.includes('src/server.mjs')) {
    throw new Error('Release tree is missing the application entrypoint');
  }
}

export function assertEmailFlagsDisabled(envExample) {
  const values = parseEnvExample(envExample);
  const enabled = disabledEmailFlags.filter((key) => values.get(key) !== 'false');
  if (enabled.length) {
    throw new Error(`Release candidate must keep email flags false: ${enabled.join(', ')}`);
  }
}

export function assertAuthenticatorMfaReleaseDefaults(envExample) {
  const values = parseEnvExample(envExample);
  if (values.get('LOGIN_TOTP_2FA_ENABLED') !== 'false') {
    throw new Error('Release candidate must keep LOGIN_TOTP_2FA_ENABLED=false');
  }
  if (values.get('LOGIN_TOTP_TRUST_DAYS') !== '10') {
    throw new Error('Release candidate must keep LOGIN_TOTP_TRUST_DAYS=10');
  }
  const credentialKeys = ['TOTP_ENCRYPTION_KEY', 'TOTP_RECOVERY_CODE_PEPPER'];
  const populated = credentialKeys.filter((key) => values.get(key) !== '');
  if (populated.length) {
    throw new Error(`Release candidate must not contain Authenticator credentials: ${populated.join(', ')}`);
  }
}

export async function assertPortableShellScripts(rootDir, paths) {
  for (const filePath of paths.filter((item) => item.endsWith('.sh'))) {
    const content = await readFile(path.join(rootDir, filePath));
    if (content.includes(13)) {
      throw new Error(`Release shell script must use LF line endings: ${filePath}`);
    }
  }
}

export async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout.trim();
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--version', '--ref', '--output-dir'].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2).replace('-dir', 'Dir')] = value;
    index += 1;
  }
  return options;
}

export async function buildReleaseCandidate({
  cwd = process.cwd(),
  version,
  ref = 'HEAD',
  outputDir = path.join(cwd, 'output', 'releases')
}) {
  const releaseVersion = validateReleaseVersion(version);
  const commit = await git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const treeText = await git(cwd, ['ls-tree', '-r', '--name-only', commit]);
  const paths = treeText ? treeText.split(/\r?\n/).map(normalizedPath) : [];
  assertSafeReleaseTree(paths);
  assertEmailFlagsDisabled(await git(cwd, ['show', `${commit}:.env.example`]));
  assertAuthenticatorMfaReleaseDefaults(await git(cwd, [
    'show',
    `${commit}:docs/deployment/templates/bestcrm.env.example`
  ]));

  const absoluteOutputDir = path.resolve(cwd, outputDir);
  await mkdir(absoluteOutputDir, { recursive: true });
  const archiveName = `bestcrm-${releaseVersion}.zip`;
  const archivePath = path.join(absoluteOutputDir, archiveName);
  const rehearsalDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-release-candidate-'));
  const rehearsalArchive = path.join(rehearsalDir, archiveName);
  try {
    await rm(archivePath, { force: true });
    await git(cwd, ['archive', '--format=zip', `--output=${archivePath}`, commit]);
    await git(cwd, ['archive', '--format=zip', `--output=${rehearsalArchive}`, commit]);
    const [sha256, rehearsalSha256] = await Promise.all([
      sha256File(archivePath),
      sha256File(rehearsalArchive)
    ]);
    if (sha256 !== rehearsalSha256) {
      throw new Error('Repeated git archive output is not reproducible');
    }
    const extractedArchive = path.join(rehearsalDir, 'extracted');
    await mkdir(extractedArchive, { recursive: true });
    await execFileAsync('tar', ['-xf', archivePath, '-C', extractedArchive], {
      cwd,
      windowsHide: true
    });
    await assertPortableShellScripts(extractedArchive, paths);
    const migrations = paths.filter((item) => item.startsWith('src/db/migrations/') && item.endsWith('.sql')).sort();
    const manifest = {
      schemaVersion: 1,
      version: releaseVersion,
      commit,
      sourceRef: ref,
      archive: archiveName,
      sha256,
      reproducibleArchiveVerified: true,
      trackedEntryCount: paths.length,
      firstMigration: migrations[0] || null,
      latestMigration: migrations.at(-1) || null,
      emailFeatureFlags: Object.fromEntries(disabledEmailFlags.map((key) => [key, false])),
      authenticatorMfa: {
        enabled: false,
        trustDays: 10,
        productionCredentialsIncluded: false
      },
      generatedAt: new Date().toISOString()
    };
    const manifestPath = path.join(absoluteOutputDir, `${archiveName}.manifest.json`);
    const checksumPath = path.join(absoluteOutputDir, `${archiveName}.sha256`);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeFile(checksumPath, `${sha256}  ${archiveName}\n`, 'utf8');
    return { archivePath, manifestPath, checksumPath, ...manifest };
  } finally {
    await rm(rehearsalDir, { recursive: true, force: true });
  }
}

if (isMainModule(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await buildReleaseCandidate(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
