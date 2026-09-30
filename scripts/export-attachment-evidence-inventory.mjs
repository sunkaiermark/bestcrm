import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { inspectStoredAttachmentFile } from '../src/services/attachmentFileService.mjs';
import { unexpectedSharedAttachmentPaths } from '../src/services/attachmentSharedPathPolicy.mjs';
import { openVerifiedDevelopmentPrivateFile } from '../src/services/developmentPrivateFileStore.mjs';
import { isMainModule } from '../src/utils/moduleEntry.mjs';

const shaPattern = /^[a-f0-9]{64}$/;
const allowedModels = new Set([
  'opportunity_attachment',
  'inquiry_attachment',
  'inquiry_attachment_purge_job',
  'development_material_file'
]);

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid attachment evidence ${label}: ${value}`);
  }
  return parsed;
}

function nonnegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid attachment evidence ${label}: ${value}`);
  }
  return parsed;
}

function canonicalStoredPath(value) {
  const original = String(value ?? '').trim();
  const storedPath = original.replaceAll('\\', '/');
  if (
    !storedPath
    || /[\0-\x1f\x7f]/.test(storedPath)
    || storedPath.startsWith('/')
    || /^[a-z]:\//i.test(storedPath)
    || storedPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe attachment evidence path: ${original}`);
  }
  return storedPath;
}

function lifecycleState(row) {
  const value = String(row.lifecycle_state ?? '').trim();
  if (!value || /[\0-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid attachment evidence lifecycle state: ${value}`);
  }
  return value;
}

async function listAttachmentEvidenceRows(queryTarget) {
  const result = await queryTarget.query(`
    SELECT
      'opportunity_attachment'::text AS model,
      attachment.id AS record_id,
      attachment.stored_path,
      attachment.file_size,
      attachment.sha256,
      attachment.source_inquiry_attachment_id,
      CASE WHEN attachment.retired_at IS NULL THEN 'active' ELSE 'retired' END AS lifecycle_state,
      NULL::bigint AS topic_id
    FROM attachments attachment
    UNION ALL
    SELECT
      'inquiry_attachment'::text AS model,
      attachment.id AS record_id,
      attachment.stored_path,
      attachment.file_size,
      attachment.sha256,
      NULL::bigint AS source_inquiry_attachment_id,
      'retained'::text AS lifecycle_state,
      NULL::bigint AS topic_id
    FROM inquiry_attachments attachment
    UNION ALL
    SELECT
      'inquiry_attachment_purge_job'::text AS model,
      job.id AS record_id,
      job.stored_path,
      job.expected_size AS file_size,
      job.expected_sha256 AS sha256,
      NULL::bigint AS source_inquiry_attachment_id,
      job.status AS lifecycle_state,
      NULL::bigint AS topic_id
    FROM inquiry_attachment_purge_file_jobs job
    UNION ALL
    SELECT
      'development_material_file'::text AS model,
      activation.id AS record_id,
      version.stored_path,
      version.file_size,
      version.sha256,
      NULL::bigint AS source_inquiry_attachment_id,
      'active'::text AS lifecycle_state,
      material.topic_id
    FROM development_material_file_activations activation
    JOIN development_material_versions version
      ON version.id = activation.material_version_id
    JOIN development_materials material ON material.id = version.material_id
    ORDER BY model, record_id, stored_path
  `);
  return result.rows;
}

export async function exportAttachmentEvidenceInventory({
  queryTarget,
  uploadDir,
  outputPath,
  strict = false
}) {
  if (!queryTarget || typeof queryTarget.query !== 'function') {
    throw new Error('queryTarget is required');
  }
  if (!uploadDir) throw new Error('uploadDir is required');
  if (!outputPath) throw new Error('outputPath is required');

  const rows = await listAttachmentEvidenceRows(queryTarget);
  const entries = [];
  let totalBytes = 0;
  let unverifiedCount = 0;

  for (const row of rows) {
    const model = String(row.model ?? '').trim();
    if (!allowedModels.has(model)) {
      throw new Error(`Invalid attachment evidence model: ${model}`);
    }
    const recordId = positiveInteger(row.record_id, 'record id');
    const storedPath = canonicalStoredPath(row.stored_path);
    const sourceInquiryAttachmentId = row.source_inquiry_attachment_id == null
      ? null : positiveInteger(row.source_inquiry_attachment_id, 'source inquiry attachment id');
    if (sourceInquiryAttachmentId !== null && model !== 'opportunity_attachment') {
      throw new Error(`Invalid attachment evidence source: ${storedPath}`);
    }
    const expectedSize = nonnegativeInteger(row.file_size, 'file size');
    const databaseSha256 = String(row.sha256 ?? '').trim();
    if (databaseSha256 && !shaPattern.test(databaseSha256)) {
      throw new Error(`Invalid attachment evidence checksum: ${storedPath}`);
    }

    let inspected;
    if (model === 'development_material_file') {
      if (!databaseSha256) {
        throw new Error(`Research file checksum is required: ${storedPath}`);
      }
      const topicId = positiveInteger(row.topic_id, 'topic id');
      const handle = await openVerifiedDevelopmentPrivateFile({
        uploadDir, storedPath, topicId,
        expectedSize, expectedSha256: databaseSha256
      });
      await handle.close();
      inspected = { fileSize: expectedSize, sha256: databaseSha256 };
    } else {
      inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
    }
    if (inspected.fileSize !== expectedSize) {
      throw new Error(`Attachment evidence size mismatch: ${storedPath}`);
    }
    if (databaseSha256 && inspected.sha256 !== databaseSha256) {
      throw new Error(`Attachment evidence checksum mismatch: ${storedPath}`);
    }
    const verified = Boolean(databaseSha256);
    if (!verified) unverifiedCount += 1;
    totalBytes += inspected.fileSize;
    entries.push({
      model,
      recordId,
      storedPath,
      size: inspected.fileSize,
      sha256: inspected.sha256,
      lifecycleState: lifecycleState(row),
      verified,
      ...(sourceInquiryAttachmentId === null ? {} : { sourceInquiryAttachmentId })
    });
  }

  const unexpectedPaths = unexpectedSharedAttachmentPaths(entries);
  if (unexpectedPaths.size) {
    throw new Error(`Duplicate attachment evidence path: ${[...unexpectedPaths][0]}`);
  }

  if (strict && unverifiedCount > 0) {
    throw new Error(`Found ${unverifiedCount} unverified attachment evidence record(s)`);
  }

  entries.sort((left, right) => (
    left.model.localeCompare(right.model)
    || left.recordId - right.recordId
    || left.storedPath.localeCompare(right.storedPath)
  ));
  const inventoryText = entries.length
    ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
    : '';
  const resolvedOutputPath = path.resolve(outputPath);
  const temporaryPath = `${resolvedOutputPath}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, inventoryText, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, resolvedOutputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return {
    fileCount: entries.length,
    totalBytes,
    unverifiedCount,
    inventorySha256: createHash('sha256').update(inventoryText).digest('hex'),
    outputPath: resolvedOutputPath
  };
}

function parseArguments(argv) {
  const options = { strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--strict') {
      options.strict = true;
      continue;
    }
    if (!['--output', '--upload-dir'].includes(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key === '--output' ? 'outputPath' : 'uploadDir'] = value;
    index += 1;
  }
  if (!options.outputPath) throw new Error('--output is required');
  return options;
}

if (isMainModule(import.meta.url)) {
  let pool;
  try {
    const config = loadConfig();
    const options = parseArguments(process.argv.slice(2));
    pool = createPool(config);
    const result = await exportAttachmentEvidenceInventory({
      queryTarget: pool,
      uploadDir: options.uploadDir || config.uploadDir,
      outputPath: options.outputPath,
      strict: options.strict
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
