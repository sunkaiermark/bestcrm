import path from 'node:path';

function extensionFrom(filename) {
  const extension = path.extname(String(filename || ''));
  return /^[\x20-\x7E]+$/.test(extension) ? extension : '';
}

function fallbackFilename(filename) {
  const value = String(filename || '');
  const ascii = value
    .replace(/[\r\n\t]/g, '_')
    .replace(/[^\x20-\x7E]/g, '')
    .replaceAll('\\', '_')
    .replaceAll('"', "'");
  const trimmed = ascii.trim();
  if (trimmed) {
    return trimmed;
  }
  return `attachment${extensionFrom(value)}`;
}

function encodeHeaderFilename(filename) {
  return encodeURIComponent(String(filename || 'attachment'))
    .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

export function inlineContentDisposition(filename) {
  return `inline; filename="${fallbackFilename(filename)}"; filename*=UTF-8''${encodeHeaderFilename(filename)}`;
}

export function attachmentContentDisposition(filename) {
  return `attachment; filename="${fallbackFilename(filename)}"; filename*=UTF-8''${encodeHeaderFilename(filename)}`;
}
