import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachmentPreviewKind,
  extractDocxPlainText,
  extractXlsxPreview,
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

test('attachment preview kind separates direct, dxf, docx, spreadsheet, and unsupported files', () => {
  assert.equal(attachmentPreviewKind({ originalName: 'drawing.dwg', mimeType: 'application/octet-stream' }), 'unsupported-dwg');
  assert.equal(attachmentPreviewKind({ originalName: 'drawing.dxf', mimeType: 'application/octet-stream' }), 'dxf');
  assert.equal(attachmentPreviewKind({ originalName: 'proposal.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'docx');
  assert.equal(attachmentPreviewKind({ originalName: 'equipment.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'spreadsheet');
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

test('xlsx preview extracts worksheet names, shared strings, and cell values', () => {
  const workbook = createStoredZip([
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Equipment list" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships>
  <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
</Relationships>`
    },
    {
      name: 'xl/sharedStrings.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<sst><si><t>Equipment</t></si><si><t>Mixer &amp; reactor</t></si></sst>`
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<worksheet><sheetData>
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c></row>
  <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2</v></c><c r="C2" t="b"><v>1</v></c></row>
</sheetData></worksheet>`
    }
  ]);

  const preview = extractXlsxPreview(workbook);

  assert.equal(preview.sheets.length, 1);
  assert.equal(preview.sheets[0].name, 'Equipment list');
  assert.deepEqual(preview.sheets[0].columnLabels, ['A', 'B', 'C']);
  assert.deepEqual(preview.sheets[0].rows, [
    { number: 1, cells: ['Equipment', 'Quantity', ''] },
    { number: 2, cells: ['Mixer & reactor', '2', 'TRUE'] }
  ]);
  assert.equal(preview.truncated, false);
});
