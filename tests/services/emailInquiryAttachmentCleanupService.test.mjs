import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cleanupNonInquiryEmailAttachments,
  listNonInquiryEmailAttachmentCandidates,
  nonInquiryEmailAttachmentCleanupStatuses
} from '../../src/services/emailInquiryAttachmentCleanupService.mjs';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function candidateRows() {
  return [
    {
      id: 11,
      inquiry_id: 21,
      inquiry_status: 'archived',
      original_name: 'notice.pdf',
      stored_path: 'email-inquiries/notice.pdf',
      file_size: 1200
    },
    {
      id: 12,
      inquiry_id: 22,
      inquiry_status: 'spam',
      original_name: 'seo.pdf',
      stored_path: 'email-inquiries/seo.pdf',
      file_size: 800
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
      deletedRecords: 0,
      deletedFiles: 0,
      skipped: []
    });
    assert.equal(await readFile(filePath, 'utf8'), 'keep-this-file');
    assert.deepEqual(deleteCalls, []);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('cleanupNonInquiryEmailAttachments apply removes files before deleting attachment rows', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-cleanup-apply-'));
  const fileA = path.join(uploadDir, 'email-inquiries', 'notice.pdf');
  const fileB = path.join(uploadDir, 'email-inquiries', 'seo.pdf');
  const calls = [];
  const queryTarget = {
    async query(sql, params) {
      if (/DELETE FROM inquiry_attachments/i.test(sql)) {
        calls.push(['delete', params[0], await exists(fileA), await exists(fileB)]);
        return { rows: [{ id: 11 }, { id: 12 }], rowCount: 2 };
      }
      calls.push(['select']);
      return { rows: candidateRows() };
    }
  };

  try {
    await mkdir(path.dirname(fileA), { recursive: true });
    await writeFile(fileA, 'notice', 'utf8');
    await writeFile(fileB, 'seo', 'utf8');

    const result = await cleanupNonInquiryEmailAttachments({
      queryTarget,
      uploadDir,
      apply: true
    });

    assert.deepEqual(result, {
      mode: 'apply',
      candidates: 2,
      bytes: 2000,
      deletedRecords: 2,
      deletedFiles: 2,
      skipped: []
    });
    assert.deepEqual(calls, [
      ['select'],
      ['delete', [11, 12], false, false]
    ]);
    assert.equal(await exists(fileA), false);
    assert.equal(await exists(fileB), false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
