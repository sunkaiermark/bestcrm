import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAttachmentIntegrityRepository } from '../../src/repositories/attachmentIntegrityRepository.mjs';

function expectedIdentityDigest(rows) {
  const canonical = [...rows]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((row) => `${row.id}\0${row.stored_path}\0${row.file_size}\0${row.sha256}\n`)
    .join('');
  return createHash('sha256').update(canonical).digest('hex');
}

function planningPool({ inquiry, attachments }) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (/FROM inquiries i[\s\S]*FOR UPDATE OF i/i.test(statement)) return { rows: inquiry ? [inquiry] : [] };
      if (/FROM inquiry_attachments[\s\S]*FOR UPDATE/i.test(statement)) return { rows: attachments };
      if (/INSERT INTO inquiry_attachment_purge_audits/i.test(statement)) return { rows: [{ id: '91' }], rowCount: 1 };
      if (/INSERT INTO inquiry_attachment_purge_file_jobs/i.test(statement)) return { rows: [{ id: '101' }], rowCount: 1 };
      if (/DELETE FROM inquiry_attachments/i.test(statement)) return { rows: [], rowCount: attachments.length };
      if (/DELETE FROM inquiries/i.test(statement)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); }
  };
  return {
    calls,
    pool: { async connect() { return client; } }
  };
}

test('planInquiryAttachmentPurge atomically records aggregate identity and guarded jobs before deletion', async () => {
  const attachments = [
    { id: '12', inquiry_id: '21', stored_path: 'email-inquiries/b.pdf', file_size: '7', sha256: 'b'.repeat(64) },
    { id: '11', inquiry_id: '21', stored_path: 'email-inquiries/a.pdf', file_size: '5', sha256: 'a'.repeat(64) }
  ];
  const { pool, calls } = planningPool({
    inquiry: {
      id: '21', converted_opportunity_id: null, matched_customer_id: null, matched_contact_id: null,
      has_origin_opportunity: false, has_business_email_thread: false, has_customer_approval: false
    },
    attachments
  });
  const repository = createAttachmentIntegrityRepository(pool, {
    operationIdFactory: () => '11111111-1111-4111-8111-111111111111'
  });

  const result = await repository.planInquiryAttachmentPurge({
    inquiryId: 21,
    actorUserId: 99,
    reason: 'administrator_deleted_provisional_inquiry',
    deleteInquiry: true
  });

  assert.deepEqual(result, {
    purgeAuditId: 91,
    operationId: '11111111-1111-4111-8111-111111111111',
    inquiryId: 21,
    attachmentCount: 2,
    totalBytes: 12,
    identityDigest: expectedIdentityDigest(attachments),
    fileJobCount: 2,
    inquiryDeleted: true
  });
  const auditCall = calls.find((call) => /INSERT INTO inquiry_attachment_purge_audits/i.test(call.sql));
  assert.deepEqual(auditCall.params, [
    '11111111-1111-4111-8111-111111111111', 21,
    'administrator_deleted_provisional_inquiry', 2, 12,
    expectedIdentityDigest(attachments), 99
  ]);
  const guardIndex = calls.findIndex((call) => /bestcrm\.inquiry_attachment_purge/.test(call.sql));
  const deleteIndex = calls.findIndex((call) => /DELETE FROM inquiry_attachments/i.test(call.sql));
  assert.ok(guardIndex > 0 && guardIndex < deleteIndex);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  assert.ok(calls.every((call) => !/DELETE FROM inquiry_attachment_purge_audits/i.test(call.sql)));
});

test('planInquiryAttachmentPurge rejects converted and other business-linked inquiries before audit creation', async () => {
  for (const inquiry of [
    { id: '21', converted_opportunity_id: '40', matched_customer_id: null, matched_contact_id: null, has_origin_opportunity: false, has_business_email_thread: false, has_customer_approval: false },
    { id: '22', converted_opportunity_id: null, matched_customer_id: null, matched_contact_id: null, has_origin_opportunity: true, has_business_email_thread: false, has_customer_approval: false },
    { id: '23', converted_opportunity_id: null, matched_customer_id: '20', matched_contact_id: null, has_origin_opportunity: false, has_business_email_thread: false, has_customer_approval: false }
  ]) {
    const { pool, calls } = planningPool({ inquiry, attachments: [] });
    const repository = createAttachmentIntegrityRepository(pool);
    await assert.rejects(
      () => repository.planInquiryAttachmentPurge({ inquiryId: inquiry.id, actorUserId: 99, reason: 'delete', deleteInquiry: true }),
      (error) => error.code === 'inquiry_attachment_purge_forbidden'
    );
    assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
    assert.ok(calls.every((call) => !/INSERT INTO inquiry_attachment_purge_audits/i.test(call.sql)));
  }
});

test('planInquiryAttachmentPurge refuses an unverified legacy attachment', async () => {
  const { pool } = planningPool({
    inquiry: {
      id: '21', converted_opportunity_id: null, matched_customer_id: null, matched_contact_id: null,
      has_origin_opportunity: false, has_business_email_thread: false, has_customer_approval: false
    },
    attachments: [{ id: '11', inquiry_id: '21', stored_path: 'email-inquiries/a.pdf', file_size: '5', sha256: null }]
  });
  const repository = createAttachmentIntegrityRepository(pool);
  await assert.rejects(
    () => repository.planInquiryAttachmentPurge({ inquiryId: 21, actorUserId: 99, reason: 'delete', deleteInquiry: true }),
    (error) => error.code === 'inquiry_attachment_unverified'
  );
});

test('cleanup repository methods use guarded leases and retain the permanent audit', async () => {
  const calls = [];
  const queryTarget = {
    async query(sql, params = []) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if (/RETURNING job\.\*/i.test(statement)) return { rows: [{
        id: '101', purge_audit_id: '91', stored_path: 'email-inquiries/a.pdf', expected_size: '5',
        expected_sha256: 'a'.repeat(64), status: 'processing', attempt_count: '2'
      }] };
      if (/DELETE FROM inquiry_attachment_purge_file_jobs/i.test(statement)) return { rows: [{ purge_audit_id: '91' }], rowCount: 1 };
      if (/SELECT count\(\*\)/i.test(statement)) return { rows: [{ count: '0' }] };
      return { rows: [], rowCount: 1 };
    }
  };
  const repository = createAttachmentIntegrityRepository(queryTarget);

  const jobs = await repository.claimInquiryAttachmentPurgeJobs({ workerId: 'worker-1', limit: 10, leaseSeconds: 60 });
  assert.deepEqual(jobs[0], {
    id: 101,
    purgeAuditId: 91,
    storedPath: 'email-inquiries/a.pdf',
    expectedSize: 5,
    expectedSha256: 'a'.repeat(64),
    status: 'processing',
    attemptCount: 2
  });
  assert.match(calls[0].sql, /set_config\('bestcrm\.inquiry_attachment_file_cleanup', 'enabled', true\)/);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);

  assert.equal(await repository.completeInquiryAttachmentPurgeJob({ jobId: 101, workerId: 'worker-1' }), true);
  assert.ok(calls.some((call) => /INSERT INTO inquiry_attachment_purge_events[\s\S]*'completed'/i.test(call.sql)));
  assert.ok(calls.every((call) => !/DELETE FROM inquiry_attachment_purge_audits/i.test(call.sql)));
});
