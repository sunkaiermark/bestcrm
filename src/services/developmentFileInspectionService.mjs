import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export const DEVELOPMENT_FILE_MAX_BYTES = 100 * 1024 * 1024;

const formats = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.dxf': 'application/dxf',
  '.dwg': 'application/acad',
  '.step': 'model/step',
  '.stp': 'model/step',
  '.iges': 'model/iges',
  '.igs': 'model/iges'
});

const declaredMimeAliases = Object.freeze({
  '.csv': ['application/vnd.ms-excel', 'text/plain'],
  '.dxf': ['application/x-dxf', 'image/vnd.dxf'],
  '.dwg': ['application/x-acad', 'image/vnd.dwg'],
  '.step': ['application/step', 'application/stp'],
  '.stp': ['application/step', 'application/stp'],
  '.iges': ['application/iges', 'application/igs'],
  '.igs': ['application/iges', 'application/igs']
});

export class DevelopmentFileInspectionError extends Error {
  constructor(message, code, statusCode = 422) {
    super(message);
    this.name = 'DevelopmentFileInspectionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function reject(message, code, statusCode) {
  throw new DevelopmentFileInspectionError(message, code, statusCode);
}

function filenameAndFormat(originalName) {
  const name = String(originalName || '');
  if (!name || name.length > 255 || name !== path.basename(name)
      || name.includes('\\') || name.includes(':') || /[\u0000-\u001f\u007f]/u.test(name)
      || name.startsWith('.')) {
    reject('Invalid research filename', 'invalid_filename');
  }
  const extension = path.extname(name).toLowerCase();
  const mimeType = formats[extension];
  if (!mimeType) reject('Research file format is not allowed', 'format_not_allowed');
  return { originalName: name, extension, mimeType };
}

export function assertDevelopmentDeclaredMimeType(originalName, declaredMimeType) {
  const { extension, mimeType } = filenameAndFormat(originalName);
  const declared = String(declaredMimeType || '').split(';', 1)[0].trim().toLowerCase();
  // Browser uploads of engineering exchange files may have no registered
  // MIME. The content signature check remains mandatory after this gate.
  const accepted = [mimeType, ...(declaredMimeAliases[extension] || []),
    'application/octet-stream'];
  if (!accepted.includes(declared)) {
    reject('Declared research file type does not match its filename', 'mime_mismatch');
  }
  return mimeType;
}

async function hashFile(stagingPath) {
  const hash = createHash('sha256');
  let fileSize = 0;
  for await (const chunk of createReadStream(stagingPath)) {
    hash.update(chunk);
    fileSize += chunk.length;
  }
  return { fileSize, sha256: hash.digest('hex') };
}

function isUtf8Text(content) {
  if (content.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

async function isExpectedOoxml(content, extension) {
  if (content.length < 4 || content.subarray(0, 4).toString('hex') !== '504b0304') {
    return false;
  }
  try {
    const archive = await JSZip.loadAsync(content, { checkCRC32: false });
    const names = Object.keys(archive.files);
    const entries = Object.values(archive.files);
    const entrySizes = entries.filter((entry) => !entry.dir)
      .map((entry) => Number(entry._data?.uncompressedSize));
    const totalUncompressed = entrySizes.reduce((sum, size) => sum + size, 0);
    if (names.length > 1000 || !names.includes('[Content_Types].xml')
        || entrySizes.some((size) => !Number.isSafeInteger(size) || size < 0)
        || !Number.isSafeInteger(totalUncompressed)
        || totalUncompressed > 200 * 1024 * 1024
        || entries.some((entry) => entry.unsafeOriginalName
          && entry.unsafeOriginalName !== entry.name)
        || names.some((name) => name.startsWith('/') || name.includes('..')
          || /(^|\/)(vbaProject\.bin|activeX|embeddings)(\/|$)/i.test(name))) {
      return false;
    }
    return names.includes(extension === '.docx' ? 'word/document.xml' : 'xl/workbook.xml');
  } catch {
    return false;
  }
}

async function matchesContent(content, extension) {
  if (extension === '.pdf') return content.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.png') return content.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (extension === '.jpg' || extension === '.jpeg') {
    return content.length >= 4 && content.subarray(0, 3).toString('hex') === 'ffd8ff'
      && content.subarray(-2).toString('hex') === 'ffd9';
  }
  if (extension === '.docx' || extension === '.xlsx') {
    return isExpectedOoxml(content, extension);
  }
  if (extension === '.csv' || extension === '.txt') return isUtf8Text(content);
  if (extension === '.dwg') return /^AC10\d{2}/.test(content.subarray(0, 8).toString('ascii'));
  if (extension === '.dxf') {
    const prefix = content.subarray(0, 96).toString('ascii');
    return prefix.startsWith('AutoCAD Binary DXF')
      || /^\s*0\r?\nSECTION\b/.test(prefix);
  }
  if (extension === '.step' || extension === '.stp') {
    return /^\s*ISO-10303-21\s*;/i.test(content.subarray(0, 128).toString('ascii'));
  }
  if (extension === '.iges' || extension === '.igs') {
    const firstLine = content.subarray(0, 160).toString('ascii').split(/\r?\n/, 1)[0];
    return firstLine.length >= 73 && firstLine[72] === 'S';
  }
  return false;
}

/** Inspect a private staging file; this function does not publish or store it. */
export async function inspectDevelopmentFile({ stagingPath, originalName, scanner }) {
  const format = filenameAndFormat(originalName);
  const { extension, mimeType } = format;
  if (!scanner || typeof scanner.scanFile !== 'function') {
    reject('Research file scanning is unavailable', 'scanner_unavailable', 503);
  }
  const initial = await lstat(stagingPath);
  if (!initial.isFile() || initial.size <= 0 || initial.size > DEVELOPMENT_FILE_MAX_BYTES) {
    reject('Research file is empty or exceeds the 100 MB limit', 'invalid_size');
  }
  const content = await readFile(stagingPath);
  if (!(await matchesContent(content, extension))) {
    reject('Research file contents do not match the allowed format', 'content_mismatch');
  }
  const sha256 = createHash('sha256').update(content).digest('hex');
  let scan;
  const scanStartedAt = Date.now();
  try {
    scan = await scanner.scanFile(stagingPath, { sha256, fileSize: content.length });
  } catch {
    reject('Research file scanning failed', 'scanner_error', 503);
  }
  if (scan?.verdict !== 'clean') {
    reject('Research file did not pass security scanning',
      scan?.verdict === 'malware' ? 'malware_detected' : 'scanner_error',
      scan?.verdict === 'malware' ? 422 : 503);
  }
  const final = await lstat(stagingPath);
  const finalHash = await hashFile(stagingPath);
  if (final.size !== initial.size || final.mtimeMs !== initial.mtimeMs
      || final.ino !== initial.ino || content.length !== initial.size
      || finalHash.fileSize !== content.length || finalHash.sha256 !== sha256) {
    reject('Research file changed during inspection', 'file_changed', 409);
  }
  const completedAt = Date.parse(scan.completedAt);
  if (!String(scan.engine || '').trim()
      || !String(scan.engineVersion || '').trim()
      || !String(scan.signatureVersion || '').trim()
      || !Number.isFinite(completedAt)
      || completedAt < scanStartedAt - 60_000
      || completedAt > Date.now() + 60_000) {
    reject('Research file scan record is incomplete', 'scanner_error', 503);
  }
  return {
    originalName: format.originalName, extension, mimeType, fileSize: content.length, sha256,
    scan: {
      engine: String(scan.engine || ''),
      engineVersion: String(scan.engineVersion || ''),
      signatureVersion: String(scan.signatureVersion || ''),
      completedAt: String(scan.completedAt || '')
    }
  };
}
