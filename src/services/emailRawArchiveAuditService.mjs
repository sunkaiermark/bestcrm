import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function listEmlFiles(directory, root = directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.staging') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listEmlFiles(absolutePath, root));
    } else if (entry.isFile() && entry.name.endsWith('.eml')) {
      files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
    }
  }
  return files;
}

export async function auditEmailRawArchive({ queryTarget, uploadDir }) {
  const result = await queryTarget.query(`
    SELECT
      raw.id,
      raw.stored_path,
      raw.file_size,
      raw.sha256,
      message.id AS message_id,
      latest_scan.verdict AS latest_scan_verdict
    FROM email_raw_messages raw
    LEFT JOIN email_messages message ON message.raw_message_id = raw.id
    LEFT JOIN LATERAL (
      SELECT scan.verdict
      FROM email_raw_scan_attempts scan
      WHERE scan.raw_message_id = raw.id
      ORDER BY scan.attempt_no DESC
      LIMIT 1
    ) latest_scan ON true
    ORDER BY raw.id
  `);
  const coverage = await queryTarget.query(`
    SELECT
      count(*) FILTER (WHERE direction = 'inbound')::integer AS inbound_messages,
      count(*) FILTER (WHERE direction = 'inbound' AND raw_message_id IS NULL)::integer AS inbound_missing_raw
    FROM email_messages
  `);
  const uploadRoot = path.resolve(uploadDir);
  const indexedPaths = new Set();
  const mismatches = [];
  let verifiedFiles = 0;
  let rawWithoutMessage = 0;
  let rawWithoutCleanScan = 0;

  for (const row of result.rows) {
    const storedPath = String(row.stored_path || '');
    indexedPaths.add(storedPath);
    if (!row.message_id) rawWithoutMessage += 1;
    if (row.latest_scan_verdict !== 'clean') rawWithoutCleanScan += 1;
    const absolutePath = path.resolve(uploadRoot, ...storedPath.split('/'));
    if (!absolutePath.toLowerCase().startsWith(`${uploadRoot}${path.sep}`.toLowerCase())) {
      mismatches.push({ id: Number(row.id), storedPath, reason: 'path_escape' });
      continue;
    }
    try {
      const fileStat = await stat(absolutePath);
      if (fileStat.size !== Number(row.file_size)) {
        mismatches.push({ id: Number(row.id), storedPath, reason: 'size_mismatch' });
        continue;
      }
      if (await sha256File(absolutePath) !== row.sha256) {
        mismatches.push({ id: Number(row.id), storedPath, reason: 'sha256_mismatch' });
        continue;
      }
      verifiedFiles += 1;
    } catch (error) {
      mismatches.push({
        id: Number(row.id),
        storedPath,
        reason: error?.code === 'ENOENT' ? 'missing_file' : 'read_error'
      });
    }
  }

  const diskFiles = await listEmlFiles(path.join(uploadRoot, 'email-raw'));
  const unexpectedFiles = diskFiles
    .map((relative) => `email-raw/${relative}`)
    .filter((storedPath) => !indexedPaths.has(storedPath))
    .sort();
  const inboundMessages = Number(coverage.rows[0]?.inbound_messages || 0);
  const inboundMissingRaw = Number(coverage.rows[0]?.inbound_missing_raw || 0);
  return {
    indexedRawMessages: result.rows.length,
    verifiedFiles,
    mismatches,
    unexpectedFiles,
    rawWithoutMessage,
    rawWithoutCleanScan,
    inboundMessages,
    inboundMissingRaw,
    readyToEnforceRawNotNull: inboundMissingRaw === 0
      && mismatches.length === 0
      && unexpectedFiles.length === 0
      && rawWithoutCleanScan === 0
  };
}
