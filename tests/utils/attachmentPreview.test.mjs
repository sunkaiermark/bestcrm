import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachmentPreviewKind,
  extractDocxPlainText,
  renderDxfPreview
} from '../../src/utils/attachmentPreview.mjs';

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data, 'utf8');
    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      name
    ]);
    localParts.push(localHeader, data);
    centralParts.push(Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      name
    ]));
    offset += localHeader.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ]);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test('attachment preview kind separates direct, dxf, docx, and unsupported dwg files', () => {
  assert.equal(attachmentPreviewKind({ originalName: 'drawing.dwg', mimeType: 'application/octet-stream' }), 'unsupported-dwg');
  assert.equal(attachmentPreviewKind({ originalName: 'drawing.dxf', mimeType: 'application/octet-stream' }), 'dxf');
  assert.equal(attachmentPreviewKind({ originalName: 'proposal.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'docx');
  assert.equal(attachmentPreviewKind({ originalName: 'old.doc', mimeType: 'application/msword' }), 'unsupported-doc');
  assert.equal(attachmentPreviewKind({ originalName: 'drawing.pdf', mimeType: 'application/pdf' }), 'direct');
});

test('dxf preview renders line entities into svg', () => {
  const dxf = `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
100
21
50
0
ENDSEC
0
EOF`;

  const preview = renderDxfPreview(dxf);

  assert.match(preview.svg, /<svg/);
  assert.match(preview.svg, /<line/);
  assert.equal(preview.entityCount, 1);
});

test('docx preview extracts paragraph text from document xml', () => {
  const docx = createStoredZip([{
    name: 'word/document.xml',
    data: `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second &amp; final</w:t></w:r></w:p>
  </w:body>
</w:document>`
  }]);

  assert.deepEqual(extractDocxPlainText(docx), ['First paragraph', 'Second & final']);
});
