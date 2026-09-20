import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { inspectStoredAttachmentFile } from './attachmentFileService.mjs';

function text(value) {
  return String(value || '').trim();
}

function validSha256(value) {
  return /^[0-9a-f]{64}$/.test(text(value));
}

function addIssue(issues, record, reason) {
  issues.push({
    model: record.model,
    id: Number(record.id),
    storedPath: text(record.storedPath),
    reason
  });
}

function opportunityLifecycleInvalid(record) {
  if (record.model !== 'opportunity_attachment') return false;
  const hasRetiredAt = Boolean(record.retiredAt);
  const hasRetiredBy = Number.isSafeInteger(Number(record.retiredBy)) && Number(record.retiredBy) > 0;
  const hasReason = Boolean(text(record.retirementReason));
  if (hasRetiredAt !== hasRetiredBy || hasRetiredAt !== hasReason) return true;
  if (record.replacedByAttachmentId && (!hasRetiredAt || record.replacementValid !== true)) return true;
  return false;
}

function ownedLegacyNamespace(storedPath) {
  const firstSegment = text(storedPath).replaceAll('\\', '/').split('/')[0];
  return /^\d{4}$/.test(firstSegment)
    || ['lead-submissions', 'email-inquiries', 'converted-inquiries'].includes(firstSegment);
}

async function listOwnedFiles(uploadDir) {
  const files = [];
  async function walk(directory, relativeDirectory = '') {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile() && ownedLegacyNamespace(relativePath)) {
        const fileStat = await stat(absolutePath);
        files.push({ storedPath: relativePath.split(path.sep).join('/'), size: Number(fileStat.size) });
      }
    }
  }
  await walk(path.resolve(uploadDir));
  return files.sort((left, right) => left.storedPath.localeCompare(right.storedPath));
}

function errorReason(error) {
  if (error?.code === 'invalid_stored_path') return 'invalid_stored_path';
  if (error?.code === 'ENOENT') return 'missing_file';
  if (error?.code === 'not_a_file') return 'not_a_file';
  return 'file_read_error';
}

export async function auditAttachmentIntegrity({ repository, uploadDir }) {
  if (typeof repository?.listAttachmentIntegrityRecords !== 'function') {
    throw new Error('Attachment integrity repository is not configured');
  }
  const records = await repository.listAttachmentIntegrityRecords();
  const knownPaths = typeof repository.listKnownAttachmentStoredPaths === 'function'
    ? await repository.listKnownAttachmentStoredPaths()
    : records.map((record) => record.storedPath);
  const knownPathSet = new Set(knownPaths.map(text).filter(Boolean));
  const pathCounts = new Map();
  for (const record of records) {
    const storedPath = text(record.storedPath);
    if (storedPath) pathCounts.set(storedPath, Number(pathCounts.get(storedPath) || 0) + 1);
  }

  const totals = {
    records: records.length,
    bytes: records.reduce((total, record) => total + Number(record.fileSize || 0), 0),
    verified: records.filter((record) => validSha256(record.sha256)).length,
    unverified: records.filter((record) => !validSha256(record.sha256)).length
  };
  const issues = [];
  for (const record of records) {
    const storedPath = text(record.storedPath);
    if (!validSha256(record.sha256)) addIssue(issues, record, 'unverified');
    if (Number(pathCounts.get(storedPath) || 0) > 1) addIssue(issues, record, 'duplicate_stored_path');
    if (opportunityLifecycleInvalid(record)) addIssue(issues, record, 'invalid_lifecycle');
    if (record.model === 'inquiry_attachment'
      && record.protectedBusinessHistory === true
      && record.purgeEligible === true) {
      addIssue(issues, record, 'protected_inquiry_purge_candidate');
    }
    try {
      const inspected = await inspectStoredAttachmentFile({ uploadDir, storedPath });
      if (Number(inspected.fileSize) !== Number(record.fileSize)) {
        addIssue(issues, record, 'file_size_mismatch');
      } else if (validSha256(record.sha256) && inspected.sha256 !== text(record.sha256).toLowerCase()) {
        addIssue(issues, record, 'file_hash_mismatch');
      }
    } catch (error) {
      addIssue(issues, record, errorReason(error));
    }
  }

  const orphanCandidates = (await listOwnedFiles(uploadDir))
    .filter((file) => !knownPathSet.has(file.storedPath));
  issues.sort((left, right) => left.model.localeCompare(right.model)
    || left.id - right.id
    || left.reason.localeCompare(right.reason));
  return {
    ok: issues.length === 0 && orphanCandidates.length === 0,
    totals,
    issues,
    orphanCandidates
  };
}
