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
      async query(sql) {
        if (sql.includes('outbound_sent_messages')) {
          return { rows: [{ outbound_sent_messages: 0, outbound_sent_without_mime: 0 }] };
        }
        if (sql.includes('email_outbound_mime_artifacts artifact')) return { rows: [] };
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
      async query(sql) {
        if (sql.includes('outbound_sent_messages')) {
          return { rows: [{ outbound_sent_messages: 0, outbound_sent_without_mime: 0 }] };
        }
        if (sql.includes('email_outbound_mime_artifacts artifact')) return { rows: [] };
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
      async query(sql) {
        if (sql.includes('outbound_sent_messages')) {
          return { rows: [{ outbound_sent_messages: 0, outbound_sent_without_mime: 0 }] };
        }
        if (sql.includes('email_outbound_mime_artifacts artifact')) return { rows: [] };
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

test('email evidence audit verifies canonical outbound MIME and rebuild readiness', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-evidence-audit-'));
  const outboundPath = `email-outbound/${'a'.repeat(64)}/${'b'.repeat(16)}.eml`;
  const outboundContent = Buffer.from('Message-ID: <crm-1@sunkaier.com>\r\n\r\nSent body');
  try {
    await mkdir(path.dirname(path.join(uploadDir, ...outboundPath.split('/'))), { recursive: true });
    await writeFile(path.join(uploadDir, ...outboundPath.split('/')), outboundContent);
    const queryTarget = {
      async query(sql) {
        if (sql.includes('FROM email_raw_messages raw')) return { rows: [] };
        if (sql.includes('inbound_messages')) {
          return { rows: [{ inbound_messages: 0, inbound_missing_raw: 0 }] };
        }
        if (sql.includes('email_raw_malware_events')) {
          return { rows: [{ malware_security_events: 0 }] };
        }
        if (sql.includes('outbound_sent_messages')) {
          return { rows: [{ outbound_sent_messages: 1, outbound_sent_without_mime: 0 }] };
        }
        if (sql.includes('email_outbound_mime_artifacts artifact')) {
          return { rows: [{
            id: '31', message_id: '91', stored_path: outboundPath,
            file_size: String(outboundContent.length), sha256: sha256(outboundContent),
            rfc_message_id: '<crm-1@sunkaier.com>', canonical_message_id: '<crm-1@sunkaier.com>'
          }] };
        }
        throw new Error(`Unexpected audit query: ${sql}`);
      }
    };

    const result = await auditEmailRawArchive({ queryTarget, uploadDir });
    assert.equal(result.outboundMimeArtifacts, 1);
    assert.equal(result.outboundMimeVerified, 1);
    assert.deepEqual(result.outboundMimeMismatches, []);
    assert.deepEqual(result.outboundMimeUnexpectedFiles, []);
    assert.equal(result.outboundSentMessages, 1);
    assert.equal(result.outboundSentWithoutMime, 0);
    assert.equal(result.readyToRebuildEmailEvidence, true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('email evidence audit reports missing, wrong-size, wrong-hash, and sent-without-MIME failures', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-email-evidence-audit-fail-'));
  const missingPath = `email-outbound/${'1'.repeat(64)}/${'a'.repeat(16)}.eml`;
  const wrongSizePath = `email-outbound/${'2'.repeat(64)}/${'b'.repeat(16)}.eml`;
  const wrongHashPath = `email-outbound/${'3'.repeat(64)}/${'c'.repeat(16)}.eml`;
  try {
    await mkdir(path.dirname(path.join(uploadDir, ...wrongSizePath.split('/'))), { recursive: true });
    await mkdir(path.dirname(path.join(uploadDir, ...wrongHashPath.split('/'))), { recursive: true });
    await writeFile(path.join(uploadDir, ...wrongSizePath.split('/')), 'size');
    await writeFile(path.join(uploadDir, ...wrongHashPath.split('/')), 'same-size');
    const rows = [
      { id: '41', message_id: '101', stored_path: missingPath, file_size: '7', sha256: sha256('missing'), rfc_message_id: '<m1>', canonical_message_id: '<m1>' },
      { id: '42', message_id: '102', stored_path: wrongSizePath, file_size: '99', sha256: sha256('size'), rfc_message_id: '<m2>', canonical_message_id: '<m2>' },
      { id: '43', message_id: '103', stored_path: wrongHashPath, file_size: String(Buffer.byteLength('same-size')), sha256: sha256('different'), rfc_message_id: '<m3>', canonical_message_id: '<m3>' }
    ];
    const queryTarget = {
      async query(sql) {
        if (sql.includes('FROM email_raw_messages raw')) return { rows: [] };
        if (sql.includes('inbound_messages')) {
          return { rows: [{ inbound_messages: 0, inbound_missing_raw: 0 }] };
        }
        if (sql.includes('email_raw_malware_events')) {
          return { rows: [{ malware_security_events: 0 }] };
        }
        if (sql.includes('outbound_sent_messages')) {
          return { rows: [{ outbound_sent_messages: 4, outbound_sent_without_mime: 1 }] };
        }
        if (sql.includes('email_outbound_mime_artifacts artifact')) return { rows };
        throw new Error(`Unexpected audit query: ${sql}`);
      }
    };

    const result = await auditEmailRawArchive({ queryTarget, uploadDir });
    assert.deepEqual(result.outboundMimeMismatches, [
      { id: 41, messageId: 101, storedPath: missingPath, reason: 'missing_file' },
      { id: 42, messageId: 102, storedPath: wrongSizePath, reason: 'size_mismatch' },
      { id: 43, messageId: 103, storedPath: wrongHashPath, reason: 'sha256_mismatch' }
    ]);
    assert.equal(result.outboundMimeVerified, 0);
    assert.equal(result.outboundSentWithoutMime, 1);
    assert.equal(result.readyToRebuildEmailEvidence, false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
