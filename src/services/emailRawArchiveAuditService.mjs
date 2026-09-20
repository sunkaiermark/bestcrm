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
      raw.provider_mailbox,
      raw.provider_uid_validity,
      raw.provider_uid,
      COALESCE(message.id, delivery.message_id) AS message_id,
      latest_scan.verdict AS latest_scan_verdict,
      latest_processing.outcome AS latest_processing_outcome,
      latest_processing.safe_error_code AS latest_processing_error_code
    FROM email_raw_messages raw
    LEFT JOIN email_messages message ON message.raw_message_id = raw.id
    LEFT JOIN email_message_mailbox_deliveries delivery ON delivery.raw_message_id = raw.id
    LEFT JOIN LATERAL (
      SELECT scan.verdict
      FROM email_raw_scan_attempts scan
      WHERE scan.raw_message_id = raw.id
      ORDER BY scan.attempt_no DESC
      LIMIT 1
    ) latest_scan ON true
    LEFT JOIN LATERAL (
      SELECT processing.outcome, processing.safe_error_code
      FROM email_raw_processing_attempts processing
      WHERE processing.raw_message_id = raw.id
      ORDER BY processing.attempt_no DESC
      LIMIT 1
    ) latest_processing ON true
    ORDER BY raw.id
  `);
  const coverage = await queryTarget.query(`
    SELECT
      count(*) FILTER (WHERE direction = 'inbound')::integer AS inbound_messages,
      count(*) FILTER (WHERE direction = 'inbound' AND raw_message_id IS NULL)::integer AS inbound_missing_raw
    FROM email_messages
  `);
  const malwareCoverage = await queryTarget.query(`
    SELECT count(*)::integer AS malware_security_events
    FROM email_raw_malware_events
  `);
  const outboundMimeResult = await queryTarget.query(`
    SELECT
      artifact.id,
      artifact.message_id,
      artifact.stored_path,
      artifact.file_size,
      artifact.sha256,
      artifact.rfc_message_id,
      message.message_id AS canonical_message_id
    FROM email_outbound_mime_artifacts artifact
    JOIN email_messages message ON message.id = artifact.message_id
    ORDER BY artifact.id
  `);
  const outboundCoverage = await queryTarget.query(`
    SELECT
      count(*)::integer AS outbound_sent_messages,
      count(*) FILTER (WHERE artifact.message_id IS NULL)::integer AS outbound_sent_without_mime
    FROM email_messages message
    LEFT JOIN email_outbound_mime_artifacts artifact ON artifact.message_id = message.id
    WHERE message.direction = 'outbound'
      AND message.delivery_status = 'sent'
      AND btrim(message.provider_mailbox) = ''
      AND message.provider_uid IS NULL
  `);
  const uploadRoot = path.resolve(uploadDir);
  const indexedPaths = new Set();
  const mismatches = [];
  let verifiedFiles = 0;
  let rawWithoutMessage = 0;
  let rawWithoutCleanScan = 0;
  const rawIdentityConflicts = [];

  for (const row of result.rows) {
    const storedPath = String(row.stored_path || '');
    indexedPaths.add(storedPath);
    if (!row.message_id) {
      rawWithoutMessage += 1;
      if (row.latest_processing_outcome === 'permanent_error'
        && row.latest_processing_error_code === 'duplicate_email_identity_conflict') {
        rawIdentityConflicts.push({
          rawMessageId: Number(row.id),
          providerMailbox: String(row.provider_mailbox || ''),
          providerUidValidity: String(row.provider_uid_validity || ''),
          providerUid: Number(row.provider_uid),
          storedPath
        });
      }
    }
    if (row.latest_scan_verdict !== 'clean') rawWithoutCleanScan += 1;
    const absolutePath = path.resolve(uploadRoot, ...storedPath.split('/'));
    if (!absolutePath.toLowerCase().startsWith(`${uploadRoot}${path.sep}`.toLowerCase())) {
      mismatches.push({ id: Number(row.id), storedPath, reason: 'path_escape' });
      continue;
    }
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        mismatches.push({ id: Number(row.id), storedPath, reason: 'not_regular_file' });
        continue;
      }
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
  const malwareSecurityEvents = Number(malwareCoverage.rows[0]?.malware_security_events || 0);
  const outboundMimeIndexedPaths = new Set();
  const outboundMimeMismatches = [];
  let outboundMimeVerified = 0;
  for (const row of outboundMimeResult.rows) {
    const storedPath = String(row.stored_path || '');
    const mismatchBase = {
      id: Number(row.id),
      messageId: Number(row.message_id),
      storedPath
    };
    outboundMimeIndexedPaths.add(storedPath);
    if (String(row.rfc_message_id || '').trim() !== String(row.canonical_message_id || '').trim()) {
      outboundMimeMismatches.push({ ...mismatchBase, reason: 'message_id_mismatch' });
      continue;
    }
    const absolutePath = path.resolve(uploadRoot, ...storedPath.split('/'));
    const outboundRoot = path.resolve(uploadRoot, 'email-outbound');
    if (!storedPath.startsWith('email-outbound/')
        || !absolutePath.toLowerCase().startsWith(`${outboundRoot}${path.sep}`.toLowerCase())) {
      outboundMimeMismatches.push({ ...mismatchBase, reason: 'path_escape' });
      continue;
    }
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        outboundMimeMismatches.push({ ...mismatchBase, reason: 'not_regular_file' });
        continue;
      }
      if (fileStat.size !== Number(row.file_size)) {
        outboundMimeMismatches.push({ ...mismatchBase, reason: 'size_mismatch' });
        continue;
      }
      if (await sha256File(absolutePath) !== row.sha256) {
        outboundMimeMismatches.push({ ...mismatchBase, reason: 'sha256_mismatch' });
        continue;
      }
      outboundMimeVerified += 1;
    } catch (error) {
      outboundMimeMismatches.push({
        ...mismatchBase,
        reason: error?.code === 'ENOENT' ? 'missing_file' : 'read_error'
      });
    }
  }
  const outboundMimeDiskFiles = await listEmlFiles(path.join(uploadRoot, 'email-outbound'));
  const outboundMimeUnexpectedFiles = outboundMimeDiskFiles
    .map((relative) => `email-outbound/${relative}`)
    .filter((storedPath) => !outboundMimeIndexedPaths.has(storedPath))
    .sort();
  const outboundSentMessages = Number(outboundCoverage.rows[0]?.outbound_sent_messages || 0);
  const outboundSentWithoutMime = Number(outboundCoverage.rows[0]?.outbound_sent_without_mime || 0);
  const readyToEnforceRawNotNull = inboundMissingRaw === 0
    && mismatches.length === 0
    && unexpectedFiles.length === 0
    && rawWithoutCleanScan === 0;
  return {
    indexedRawMessages: result.rows.length,
    verifiedFiles,
    mismatches,
    unexpectedFiles,
    rawWithoutMessage,
    rawIdentityConflicts,
    rawWithoutCleanScan,
    inboundMessages,
    inboundMissingRaw,
    malwareSecurityEvents,
    readyToEnforceRawNotNull,
    outboundMimeArtifacts: outboundMimeResult.rows.length,
    outboundMimeVerified,
    outboundMimeMismatches,
    outboundMimeUnexpectedFiles,
    outboundSentMessages,
    outboundSentWithoutMime,
    readyToRebuildEmailEvidence: readyToEnforceRawNotNull
      && rawWithoutMessage === 0
      && outboundMimeMismatches.length === 0
      && outboundMimeUnexpectedFiles.length === 0
      && outboundSentWithoutMime === 0
  };
}
