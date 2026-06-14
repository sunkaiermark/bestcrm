import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const directPreviewMimeTypes = new Set([
  'application/pdf',
  'text/plain'
]);

function extensionFromAttachment(attachment) {
  return path.extname(String(attachment?.originalName || attachment?.storedPath || '')).toLowerCase();
}

export function attachmentPreviewKind(attachment) {
  const extension = extensionFromAttachment(attachment);
  if (extension === '.dwg') {
    return 'unsupported-dwg';
  }
  if (extension === '.dxf') {
    return 'dxf';
  }
  if (extension === '.docx') {
    return 'docx';
  }
  if (extension === '.doc') {
    return 'unsupported-doc';
  }
  if (directPreviewMimeTypes.has(attachment?.mimeType) || attachment?.mimeType?.startsWith('image/')) {
    return 'direct';
  }
  return 'download-only';
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function dxfPairs(text) {
  const lines = String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const pairs = [];
  for (let index = 0; index < lines.length - 1; index += 2) {
    pairs.push({
      code: lines[index].trim(),
      value: lines[index + 1].trim()
    });
  }
  return pairs;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLineEntity(pairs, start) {
  const line = { x1: null, y1: null, x2: null, y2: null };
  let index = start + 1;
  while (index < pairs.length && pairs[index].code !== '0') {
    const { code, value } = pairs[index];
    if (code === '10') line.x1 = numberValue(value);
    if (code === '20') line.y1 = numberValue(value);
    if (code === '11') line.x2 = numberValue(value);
    if (code === '21') line.y2 = numberValue(value);
    index += 1;
  }
  if ([line.x1, line.y1, line.x2, line.y2].every((value) => value !== null)) {
    return { entity: { type: 'line', ...line }, next: index };
  }
  return { entity: null, next: index };
}

function readLightweightPolyline(pairs, start) {
  const points = [];
  let pendingX = null;
  let index = start + 1;
  while (index < pairs.length && pairs[index].code !== '0') {
    const { code, value } = pairs[index];
    if (code === '10') {
      pendingX = numberValue(value);
    }
    if (code === '20' && pendingX !== null) {
      const y = numberValue(value);
      if (y !== null) {
        points.push([pendingX, y]);
      }
      pendingX = null;
    }
    index += 1;
  }
  if (points.length > 1) {
    return { entity: { type: 'polyline', points }, next: index };
  }
  return { entity: null, next: index };
}

function dxfEntities(text) {
  const pairs = dxfPairs(text);
  const entities = [];
  for (let index = 0; index < pairs.length;) {
    const value = pairs[index].value.toUpperCase();
    if (pairs[index].code === '0' && value === 'LINE') {
      const result = readLineEntity(pairs, index);
      if (result.entity) entities.push(result.entity);
      index = result.next;
      continue;
    }
    if (pairs[index].code === '0' && value === 'LWPOLYLINE') {
      const result = readLightweightPolyline(pairs, index);
      if (result.entity) entities.push(result.entity);
      index = result.next;
      continue;
    }
    index += 1;
  }
  return entities;
}

function boundsForEntities(entities) {
  const points = [];
  for (const entity of entities) {
    if (entity.type === 'line') {
      points.push([entity.x1, entity.y1], [entity.x2, entity.y2]);
    }
    if (entity.type === 'polyline') {
      points.push(...entity.points);
    }
  }
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

export function renderDxfPreview(text) {
  const entities = dxfEntities(text);
  const bounds = boundsForEntities(entities);
  const padding = 20;
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const viewBox = [
    bounds.minX - padding,
    -(bounds.maxY + padding),
    width + padding * 2,
    height + padding * 2
  ].join(' ');
  const elements = entities.map((entity) => {
    if (entity.type === 'line') {
      return `<line x1="${entity.x1}" y1="${-entity.y1}" x2="${entity.x2}" y2="${-entity.y2}" />`;
    }
    const points = entity.points.map(([x, y]) => `${x},${-y}`).join(' ');
    return `<polyline points="${escapeXml(points)}" />`;
  }).join('\n');

  return {
    entityCount: entities.length,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="DXF preview">
  <g fill="none" stroke="#0B0F6E" stroke-width="1.5" vector-effect="non-scaling-stroke">
    ${elements}
  </g>
</svg>`
  };
}

function findEndOfCentralDirectory(buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }
  return -1;
}

function zipEntryBuffer(buffer, entryName) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) {
    return null;
  }
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      return null;
    }
    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const filenameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const filename = buffer.subarray(centralOffset + 46, centralOffset + 46 + filenameLength).toString('utf8');
    if (filename === entryName) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) {
        return data;
      }
      if (compressionMethod === 8) {
        return inflateRawSync(data);
      }
      return null;
    }
    centralOffset += 46 + filenameLength + extraLength + commentLength;
  }
  return null;
}

function decodeXmlEntities(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function stripXmlTags(value) {
  return String(value).replace(/<[^>]+>/g, '');
}

export function extractDocxPlainText(buffer) {
  try {
    const documentXml = zipEntryBuffer(buffer, 'word/document.xml');
    if (!documentXml) {
      return [];
    }
    const xml = documentXml.toString('utf8');
    const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
    return paragraphs.map((paragraph) => {
      const textNodes = paragraph.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [];
      return textNodes.map((node) => decodeXmlEntities(stripXmlTags(node))).join('');
    }).map((paragraph) => paragraph.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
