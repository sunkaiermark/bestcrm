import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {
  DEVELOPMENT_FILE_MAX_BYTES, assertDevelopmentDeclaredMimeType, inspectDevelopmentFile
} from '../../src/services/developmentFileInspectionService.mjs';

const cleanScanner = {
  async scanFile() {
    return {
      verdict: 'clean', engine: 'isolated-test-scanner', engineVersion: '1',
      signatureVersion: 'test', completedAt: new Date().toISOString()
    };
  }
};

test('P3c research file inspection rejects unsafe formats and scan failures before storage', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-file-'));
  const stagingPath = path.join(directory, 'generated-private-staging');
  async function inspect(name, content, scanner = cleanScanner) {
    await writeFile(stagingPath, content);
    return inspectDevelopmentFile({ stagingPath, originalName: name, scanner });
  }
  try {
    assert.equal(assertDevelopmentDeclaredMimeType('research.pdf', 'application/pdf'),
      'application/pdf');
    assert.throws(() => assertDevelopmentDeclaredMimeType('research.pdf', 'image/png'),
      (error) => error.code === 'mime_mismatch');
    const pdf = await inspect('research.pdf', Buffer.from('%PDF-1.7\n1 0 obj\n'));
    assert.equal(pdf.mimeType, 'application/pdf');
    assert.equal(pdf.fileSize, 17);
    assert.match(pdf.sha256, /^[0-9a-f]{64}$/);
    assert.equal(pdf.scan.engine, 'isolated-test-scanner');
    const dwg = await inspect('model.DWG', Buffer.from('AC1032\0binary'));
    assert.equal(dwg.extension, '.dwg');
    const step = await inspect('part.step', Buffer.from('ISO-10303-21;\nHEADER;'));
    assert.equal(step.mimeType, 'model/step');

    const docx = new JSZip();
    docx.file('[Content_Types].xml', '<Types/>');
    docx.file('word/document.xml', '<w:document/>');
    const docxData = await docx.generateAsync({ type: 'nodebuffer' });
    assert.equal((await inspect('note.docx', docxData)).extension, '.docx');
    await assert.rejects(inspect('note.xlsx', docxData),
      (error) => error.code === 'content_mismatch');
    docx.file('word/vbaProject.bin', Buffer.from('macro'));
    await assert.rejects(inspect('macro.docx', await docx.generateAsync({ type: 'nodebuffer' })),
      (error) => error.code === 'content_mismatch');
    await assert.rejects(inspect('archive.zip', docxData),
      (error) => error.code === 'format_not_allowed');
    await assert.rejects(inspect('script.exe', Buffer.from('MZ')),
      (error) => error.code === 'format_not_allowed');
    await assert.rejects(inspect('../escape.pdf', Buffer.from('%PDF-1.7')),
      (error) => error.code === 'invalid_filename');
    await assert.rejects(inspect('forged.pdf', Buffer.from('not a PDF')),
      (error) => error.code === 'content_mismatch');
    await assert.rejects(inspect('binary.csv', Buffer.from([0, 1, 2])),
      (error) => error.code === 'content_mismatch');
    await assert.rejects(inspect('research.pdf', Buffer.from('%PDF-1.7'), null),
      (error) => error.code === 'scanner_unavailable' && error.statusCode === 503);
    await assert.rejects(inspect('research.pdf', Buffer.from('%PDF-1.7'), {
      async scanFile() { return { verdict: 'malware' }; }
    }), (error) => error.code === 'malware_detected');
    await assert.rejects(inspect('research.pdf', Buffer.from('%PDF-1.7'), {
      async scanFile() { throw new Error('private scanner path'); }
    }), (error) => error.code === 'scanner_error' && !error.message.includes('private'));
    await assert.rejects(inspect('research.pdf', Buffer.from('%PDF-1.7'), {
      async scanFile() { return { verdict: 'clean' }; }
    }), (error) => error.code === 'scanner_error');
    await assert.rejects(inspect('research.pdf', Buffer.from('%PDF-1.7'), {
      async scanFile() {
        return { verdict: 'clean', engine: 'clamav', engineVersion: '1',
          signatureVersion: 'test', completedAt: '2020-01-01T00:00:00Z' };
      }
    }), (error) => error.code === 'scanner_error');
    await assert.rejects(inspect('research.pdf', Buffer.from('%PDF-1.7'), {
      async scanFile() {
        await writeFile(stagingPath, Buffer.from('%PDF-1.7\nchanged'));
        return { verdict: 'clean' };
      }
    }), (error) => error.code === 'file_changed');
    await writeFile(stagingPath, Buffer.from('%PDF-1.7'));
    await truncate(stagingPath, DEVELOPMENT_FILE_MAX_BYTES + 1);
    await assert.rejects(inspectDevelopmentFile({
      stagingPath, originalName: 'oversized.pdf', scanner: cleanScanner
    }), (error) => error.code === 'invalid_size');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
