import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditEmailRawArchive } from '../../src/services/emailRawArchiveAuditService.mjs';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('raw archive audit reconciles database indexes, clean scans, and immutable EML files', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-audit-'));
  const storedPath = 'email-raw/mailbox/44/7-a.eml';
  const content = Buffer.from('raw email');
  try {
    await mkdir(path.join(uploadDir, 'email-raw', 'mailbox', '44'), { recursive: true });
    await writeFile(path.join(uploadDir, ...storedPath.split('/')), content);
    let call = 0;
    const queryTarget = {
      async query() {
        call += 1;
        return call === 1
          ? { rows: [{
            id: '1', stored_path: storedPath, file_size: String(content.length), sha256: sha256(content),
            message_id: '10', latest_scan_verdict: 'clean'
          }] }
          : { rows: [{ inbound_messages: 1, inbound_missing_raw: 0 }] };
      }
    };

    const result = await auditEmailRawArchive({ queryTarget, uploadDir });
    assert.equal(result.verifiedFiles, 1);
    assert.deepEqual(result.mismatches, []);
    assert.deepEqual(result.unexpectedFiles, []);
    assert.deepEqual(result.rawIdentityConflicts, []);
    assert.equal(result.readyToEnforceRawNotNull, true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw archive audit reports missing, tampered, and unindexed files without deleting them', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-audit-fail-'));
  const storedPath = 'email-raw/mailbox/44/7-a.eml';
  const unexpectedPath = path.join(uploadDir, 'email-raw', 'mailbox', '44', '8-b.eml');
  try {
    await mkdir(path.dirname(unexpectedPath), { recursive: true });
    await writeFile(unexpectedPath, 'orphan');
    let call = 0;
    const queryTarget = {
      async query() {
        call += 1;
        return call === 1
          ? { rows: [{
            id: '1', stored_path: storedPath, file_size: '3', sha256: sha256('expected'),
            message_id: null, latest_scan_verdict: null
          }] }
          : { rows: [{ inbound_messages: 3, inbound_missing_raw: 2 }] };
      }
    };

    const result = await auditEmailRawArchive({ queryTarget, uploadDir });
    assert.deepEqual(result.mismatches, [{ id: 1, storedPath, reason: 'missing_file' }]);
    assert.deepEqual(result.unexpectedFiles, ['email-raw/mailbox/44/8-b.eml']);
    assert.equal(result.rawWithoutMessage, 1);
    assert.deepEqual(result.rawIdentityConflicts, []);
    assert.equal(result.rawWithoutCleanScan, 1);
    assert.equal(result.readyToEnforceRawNotNull, false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('raw archive audit lists indexed divergent Message-ID evidence for manual identity review', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-raw-audit-conflict-'));
  const storedPath = 'email-raw/mailbox/44/9-conflict.eml';
  const content = Buffer.from('conflicting raw email');
  try {
    await mkdir(path.join(uploadDir, 'email-raw', 'mailbox', '44'), { recursive: true });
    await writeFile(path.join(uploadDir, ...storedPath.split('/')), content);
    let call = 0;
    const queryTarget = {
      async query() {
        call += 1;
        return call === 1
          ? { rows: [{
            id: '9', stored_path: storedPath, file_size: String(content.length), sha256: sha256(content),
            provider_mailbox: 'INBOX', provider_uid_validity: '44', provider_uid: '9',
            message_id: null, latest_scan_verdict: 'clean',
            latest_processing_outcome: 'permanent_error',
            latest_processing_error_code: 'duplicate_email_identity_conflict'
          }] }
          : { rows: [{ inbound_messages: 1, inbound_missing_raw: 0 }] };
      }
    };

    const result = await auditEmailRawArchive({ queryTarget, uploadDir });
    assert.deepEqual(result.mismatches, []);
    assert.deepEqual(result.unexpectedFiles, []);
    assert.equal(result.rawWithoutMessage, 1);
    assert.deepEqual(result.rawIdentityConflicts, [{
      rawMessageId: 9,
      providerMailbox: 'INBOX',
      providerUidValidity: '44',
      providerUid: 9,
      storedPath
    }]);
    assert.equal(result.rawWithoutCleanScan, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
