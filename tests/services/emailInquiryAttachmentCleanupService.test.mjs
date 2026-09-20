import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cleanupNonInquiryEmailAttachments,
  listNonInquiryEmailAttachmentCandidates,
  nonInquiryEmailAttachmentCleanupStatuses
} from '../../src/services/emailInquiryAttachmentCleanupService.mjs';

function candidateRows() {
  return [
    {
      id: 11,
      inquiry_id: 21,
      inquiry_status: 'archived',
      original_name: 'notice.pdf',
      stored_path: 'email-inquiries/notice.pdf',
      file_size: 1200,
      sha256: 'a'.repeat(64)
    },
    {
      id: 12,
      inquiry_id: 22,
      inquiry_status: 'spam',
      original_name: 'seo.pdf',
      stored_path: 'email-inquiries/seo.pdf',
      file_size: 800,
      sha256: 'b'.repeat(64)
    }
  ];
}

test('listNonInquiryEmailAttachmentCandidates selects archived and spam email attachments', async () => {
  const calls = [];
  const queryTarget = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: candidateRows() };
    }
  };

  const candidates = await listNonInquiryEmailAttachmentCandidates(queryTarget);

  assert.deepEqual(nonInquiryEmailAttachmentCleanupStatuses(), ['archived', 'spam']);
  assert.deepEqual(calls[0].params, [['archived', 'spam']]);
  assert.match(calls[0].sql, /JOIN inquiries/i);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].id, 11);
  assert.equal(candidates[1].fileSize, 800);
});

test('cleanupNonInquiryEmailAttachments dry-run summarizes without deleting files or rows', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-cleanup-dry-'));
  const filePath = path.join(uploadDir, 'email-inquiries', 'notice.pdf');
  const deleteCalls = [];
  const queryTarget = {
    async query(sql) {
      if (/DELETE FROM inquiry_attachments/i.test(sql)) {
        deleteCalls.push(sql);
        return { rows: [], rowCount: 0 };
      }
      return { rows: candidateRows().slice(0, 1) };
    }
  };

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, 'keep-this-file', 'utf8');

    const result = await cleanupNonInquiryEmailAttachments({
      queryTarget,
      uploadDir,
      apply: false
    });

    assert.deepEqual(result, {
      mode: 'dry-run',
      candidates: 1,
      bytes: 1200,
      plannedInquiries: 0,
      purgedRecords: 0,
      queuedFiles: 0,
      purgeAuditIds: [],
      skipped: []
    });
    assert.equal(await readFile(filePath, 'utf8'), 'keep-this-file');
    assert.deepEqual(deleteCalls, []);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('cleanupNonInquiryEmailAttachments apply durably plans file cleanup without unlinking inline', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-cleanup-apply-'));
  const fileA = path.join(uploadDir, 'email-inquiries', 'notice.pdf');
  const fileB = path.join(uploadDir, 'email-inquiries', 'seo.pdf');
  const calls = [];
  const queryTarget = {
    async query() {
      calls.push(['select']);
      return { rows: candidateRows() };
    }
  };
  const attachmentIntegrityRepository = {
    async planInquiryAttachmentPurge(input) {
      calls.push(['plan', input]);
      return {
        purgeAuditId: input.inquiryId + 100,
        attachmentCount: 1,
        fileJobCount: 1
      };
    }
  };

  try {
    await mkdir(path.dirname(fileA), { recursive: true });
    await writeFile(fileA, 'notice', 'utf8');
    await writeFile(fileB, 'seo', 'utf8');

    const result = await cleanupNonInquiryEmailAttachments({
      queryTarget,
      attachmentIntegrityRepository,
      actorUserId: 99,
      apply: true
    });

    assert.deepEqual(result, {
      mode: 'apply',
      candidates: 2,
      bytes: 2000,
      plannedInquiries: 2,
      purgedRecords: 2,
      queuedFiles: 2,
      purgeAuditIds: [121, 122],
      skipped: []
    });
    assert.deepEqual(calls, [
      ['select'],
      ['plan', {
        inquiryId: 21,
        actorUserId: 99,
        reason: 'non_business_email_attachment_cleanup:archived',
        deleteInquiry: false
      }],
      ['plan', {
        inquiryId: 22,
        actorUserId: 99,
        reason: 'non_business_email_attachment_cleanup:spam',
        deleteInquiry: false
      }]
    ]);
    assert.equal(await readFile(fileA, 'utf8'), 'notice');
    assert.equal(await readFile(fileB, 'utf8'), 'seo');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
