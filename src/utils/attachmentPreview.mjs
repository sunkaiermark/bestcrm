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
  if (['.xlsx', '.xlsm', '.xltx', '.xltm'].includes(extension)) {
    return 'spreadsheet';
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

function zipEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) {
    return [];
  }
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (centralOffset + 46 > buffer.length || buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      return [];
    }
    const compressionMethod = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24);
    const filenameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const filename = buffer.subarray(centralOffset + 46, centralOffset + 46 + filenameLength).toString('utf8');
    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localOffset
    });
    centralOffset += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function zipEntryBuffer(buffer, entryName, maxOutputLength = 32 * 1024 * 1024) {
  const entry = zipEntries(buffer).find((candidate) => candidate.filename === entryName);
  if (!entry || entry.uncompressedSize > maxOutputLength) {
    return null;
  }
  const { compressionMethod, compressedSize, localOffset } = entry;
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    return null;
  }
  const localNameLength = buffer.readUInt16LE(localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  if (dataStart + compressedSize > buffer.length) {
    return null;
  }
  const data = buffer.subarray(dataStart, dataStart + compressedSize);
  if (compressionMethod === 0) {
    return data;
  }
  if (compressionMethod === 8) {
    try {
      return inflateRawSync(data, { maxOutputLength });
    } catch {
      return null;
    }
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

function xmlAttribute(attributes, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(attributes || '').match(new RegExp(`(?:^|\\s)${escapedName}=(['"])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeXmlEntities(match[2]) : '';
}

function textNodes(xml) {
  const nodes = String(xml || '').match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/gi) || [];
  return nodes.map((node) => decodeXmlEntities(stripXmlTags(node))).join('');
}

function spreadsheetColumnIndex(reference) {
  const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return null;
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value - 1;
}

function spreadsheetColumnLabel(index) {
  let value = Number(index) + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function spreadsheetCellValue(cellXml, cellType, sharedStrings) {
  if (cellType === 'inlineStr') {
    return textNodes(cellXml);
  }
  const rawValue = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1];
  if (cellType === 's') {
    const sharedIndex = Number(rawValue);
    return Number.isSafeInteger(sharedIndex) ? String(sharedStrings[sharedIndex] ?? '') : '';
  }
  if (cellType === 'b') {
    return rawValue === '1' ? 'TRUE' : rawValue === '0' ? 'FALSE' : '';
  }
  if (rawValue !== undefined) {
    return decodeXmlEntities(rawValue);
  }
  const formula = cellXml.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/i)?.[1];
  return formula === undefined ? '' : `=${decodeXmlEntities(formula)}`;
}

function spreadsheetSheetRows(sheetXml, sharedStrings, { maxRows, maxColumns }) {
  const rows = [];
  let maxColumn = -1;
  let truncated = false;
  let fallbackRowNumber = 1;
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/gi;
  for (let rowMatch = rowPattern.exec(sheetXml); rowMatch; rowMatch = rowPattern.exec(sheetXml)) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    const rowNumber = Number(xmlAttribute(rowMatch[1], 'r')) || fallbackRowNumber;
    fallbackRowNumber = rowNumber + 1;
    const cells = [];
    let fallbackColumn = 0;
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    for (let cellMatch = cellPattern.exec(rowMatch[2]); cellMatch; cellMatch = cellPattern.exec(rowMatch[2])) {
      const column = spreadsheetColumnIndex(xmlAttribute(cellMatch[1], 'r')) ?? fallbackColumn;
      fallbackColumn = column + 1;
      if (column >= maxColumns) {
        truncated = true;
        continue;
      }
      const value = spreadsheetCellValue(
        cellMatch[2] || '',
        xmlAttribute(cellMatch[1], 't'),
        sharedStrings
      );
      cells[column] = value;
      maxColumn = Math.max(maxColumn, column);
    }
    if (cells.some((value) => String(value || '') !== '')) {
      rows.push({ number: rowNumber, cells });
    }
  }
  const columnCount = Math.min(maxColumn + 1, maxColumns);
  return {
    rows: rows.map((row) => ({
      ...row,
      cells: Array.from({ length: columnCount }, (_, index) => row.cells[index] ?? '')
    })),
    columnLabels: Array.from({ length: columnCount }, (_, index) => spreadsheetColumnLabel(index)),
    truncated
  };
}

function spreadsheetSheetDefinitions(buffer, workbookXml) {
  const relationshipsXml = zipEntryBuffer(
    buffer,
    'xl/_rels/workbook.xml.rels',
    2 * 1024 * 1024
  )?.toString('utf8') || '';
  const relationshipTargets = new Map();
  const relationshipPattern = /<Relationship\b([^>]*?)\/?\s*>/gi;
  for (let match = relationshipPattern.exec(relationshipsXml); match; match = relationshipPattern.exec(relationshipsXml)) {
    const id = xmlAttribute(match[1], 'Id');
    const target = xmlAttribute(match[1], 'Target');
    if (!id || !target) continue;
    const normalized = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(path.posix.join('xl', target));
    if (normalized.startsWith('xl/worksheets/')) {
      relationshipTargets.set(id, normalized);
    }
  }
  const definitions = [];
  const sheetPattern = /<sheet\b([^>]*?)\/?\s*>/gi;
  for (let match = sheetPattern.exec(workbookXml); match; match = sheetPattern.exec(workbookXml)) {
    const relationshipId = xmlAttribute(match[1], 'r:id');
    const filename = relationshipTargets.get(relationshipId);
    if (!filename) continue;
    definitions.push({
      name: xmlAttribute(match[1], 'name') || `Sheet ${definitions.length + 1}`,
      filename
    });
  }
  if (definitions.length) return definitions;
  return zipEntries(buffer)
    .map((entry) => entry.filename)
    .filter((filename) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(filename))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((filename, index) => ({ name: `Sheet ${index + 1}`, filename }));
}

export function extractXlsxPreview(buffer, {
  maxSheets = 10,
  maxRows = 200,
  maxColumns = 40
} = {}) {
  try {
    const workbookXml = zipEntryBuffer(buffer, 'xl/workbook.xml', 2 * 1024 * 1024)?.toString('utf8') || '';
    const sharedStringsXml = zipEntryBuffer(buffer, 'xl/sharedStrings.xml', 32 * 1024 * 1024)?.toString('utf8') || '';
    const sharedStrings = (sharedStringsXml.match(/<si\b[\s\S]*?<\/si>/gi) || []).map(textNodes);
    const definitions = spreadsheetSheetDefinitions(buffer, workbookXml);
    let truncated = definitions.length > maxSheets;
    const sheets = definitions.slice(0, maxSheets).map((definition) => {
      const sheetXml = zipEntryBuffer(buffer, definition.filename, 32 * 1024 * 1024)?.toString('utf8') || '';
      const preview = spreadsheetSheetRows(sheetXml, sharedStrings, { maxRows, maxColumns });
      truncated ||= preview.truncated;
      return { name: definition.name, ...preview };
    });
    return { sheets, truncated, maxSheets, maxRows, maxColumns };
  } catch {
    return { sheets: [], truncated: false, maxSheets, maxRows, maxColumns };
  }
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
