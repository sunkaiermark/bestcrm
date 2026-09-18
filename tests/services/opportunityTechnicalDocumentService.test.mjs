import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canManageOpportunityTechnicalDocuments,
  createOpportunityTechnicalDocumentVersionOne,
  normalizeOpportunityEquipmentInput,
  parseEquipmentTechnicalParameters,
  saveUploadedOpportunityTechnicalDocumentVersion
} from '../../src/services/opportunityTechnicalDocumentService.mjs';

const actor = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };
const opportunity = {
  id: 20, opportunityNo: 'OPP-20', title: 'Polymer Mixer', customerId: 8,
  customerName: 'Acme', quotationEngineerId: 3, archivedAt: null
};

function equipment(overrides = {}) {
  return {
    id: 11, opportunityId: 20, itemNo: 1, productCategoryCode: 'mixer',
    equipmentName: 'Main Mixer', model: 'MX-10', quantity: 2,
    technicalParameters: [{ key: 'capacity', label: 'Capacity', value: '10 t/h' }],
    archivedAt: null, ...overrides
  };
}

function template() {
  return {
    id: 5, templateCode: 'MIX-TA', name: 'Mixer Agreement', documentType: 'technical_agreement',
    nameEn: 'Mixer Agreement', nameZh: '搅拌机技协议',
    productCategoryCode: 'mixer', productFamily: '搅拌机', language: 'bilingual', isActive: true,
    currentPublishedRevisionId: 9,
    revisions: [{
      id: 9, revisionNo: 2, status: 'published',
      contentSchema: { schemaVersion: 1, sections: [{
        key: 'design_parameters', labelEn: 'Design Parameters', labelZh: '设计参数',
        sortOrder: 1, enabled: true, bodyEn: 'English body.', bodyZh: '中文内容。',
        tableRowsEn: [['Item', 'Value']], tableRowsZh: [['项目', '数值']],
        condition: { operator: 'always' }, defaultClauseIds: []
      }] },
      variables: [{
        variableKey: 'capacity', labelEn: 'Capacity', labelZh: '处理能力',
        sourceField: 'capacity', sectionKey: 'design_parameters', defaultValue: ''
      }]
    }]
  };
}

test('only the assigned active Quotation Engineer manages technical documents', () => {
  assert.equal(canManageOpportunityTechnicalDocuments(actor, opportunity), true);
  assert.equal(canManageOpportunityTechnicalDocuments({ id: 4, roles: [ROLES.QUOTATION_ENGINEER] }, opportunity), false);
  assert.equal(canManageOpportunityTechnicalDocuments(actor, { ...opportunity, archivedAt: '2026-09-15' }), false);
});

test('equipment input uses the fixed product catalogue and structured unique parameter keys', () => {
  const normalized = normalizeOpportunityEquipmentInput({
    productCategoryCode: 'sk3000e_kneader',
    equipmentName: 'Kneader A',
    model: 'SK3000E',
    quantity: '2',
    technicalParameters: 'capacity | 处理能力 | 10 t/h\npressure | 6 bar'
  });
  assert.equal(normalized.productCategoryCode, 'sk3000e_kneader');
  assert.equal(normalized.quantity, 2);
  assert.deepEqual(normalized.technicalParameters[0], { key: 'capacity', label: '处理能力', value: '10 t/h' });
  assert.throws(() => parseEquipmentTechnicalParameters('capacity | 10\ncapacity | 20'), /must be unique/);
});

test('combined Technical Agreement V1 freezes every item and exact published template revision', async () => {
  const calls = [];
  const item = equipment();
  const currentTemplate = template();
  const repositories = {
    opportunityTechnicalDocumentRepository: {
      async listEquipmentByOpportunity() { return [item]; },
      async findDocumentByIdentity() { return null; },
      async createDocumentVersionOne(input) { calls.push(['create', input]); return { documentId: 30, versionId: 40, versionNo: 1 }; }
    },
    technicalTemplateRepository: {
      async listTemplates(filter) { calls.push(['listTemplates', filter]); return [currentTemplate]; },
      async getTemplateDetail() { return currentTemplate; },
      async listClauses() { return []; }
    },
    technicalMaterialDocumentService: {
      async generateVersionOne(input) {
        calls.push(['generate', input]);
        return [
          { format: 'docx', originalName: 'v1.docx', mimeType: 'docx', content: Buffer.from('docx'), byteSize: 4, sha256: 'a'.repeat(64) },
          { format: 'pdf', originalName: 'v1.pdf', mimeType: 'pdf', content: Buffer.from('pdf'), byteSize: 3, sha256: 'b'.repeat(64) }
        ];
      }
    }
  };
  const created = await createOpportunityTechnicalDocumentVersionOne(repositories, actor, opportunity, {
    documentType: 'technical_agreement', equipmentItemIds: ['11'], language: 'en'
  });
  assert.equal(created.versionNo, 1);
  const stored = calls.find(([name]) => name === 'create')[1];
  assert.equal(stored.documentCode, 'OPP-20-TECHNICAL-AGREEMENT');
  assert.equal(stored.versionItems[0].templateRevisionNo, 2);
  assert.equal(stored.versionItems[0].renderedContent.variables[0].value, '10 t/h');
  assert.equal(stored.sourceSnapshot.equipment[0].templateRevisionId, 9);
  assert.equal(stored.sourceSnapshot.language, 'en');
  assert.equal(calls.find(([name]) => name === 'generate')[1].language, 'en');
});

test('one combined document supports multiple equipment items from multiple product categories', async () => {
  const mixer = equipment();
  const cutter = equipment({
    id: 12,
    itemNo: 2,
    productCategoryCode: 'rubber_cutter',
    equipmentName: 'Rubber Cutter',
    model: 'RC-20'
  });
  const mixerTemplate = template();
  const cutterTemplate = {
    ...template(),
    id: 6,
    templateCode: 'RC-TA',
    name: 'Rubber Cutter Agreement',
    productCategoryCode: 'rubber_cutter',
    currentPublishedRevisionId: 10,
    revisions: [{ ...template().revisions[0], id: 10, revisionNo: 3 }]
  };
  let stored;
  const repositories = {
    opportunityTechnicalDocumentRepository: {
      async listEquipmentByOpportunity() { return [mixer, cutter]; },
      async findDocumentByIdentity() { return null; },
      async createDocumentVersionOne(input) { stored = input; return { documentId: 31, versionId: 42, versionNo: 1 }; }
    },
    technicalTemplateRepository: {
      async listTemplates() { return [mixerTemplate, cutterTemplate]; },
      async getTemplateDetail(id) { return Number(id) === 5 ? mixerTemplate : cutterTemplate; },
      async listClauses() { return []; }
    },
    technicalMaterialDocumentService: {
      async generateVersionOne() {
        return [
          { format: 'docx', originalName: 'v1.docx', mimeType: 'docx', content: Buffer.from('docx'), byteSize: 4, sha256: 'a'.repeat(64) },
          { format: 'pdf', originalName: 'v1.pdf', mimeType: 'pdf', content: Buffer.from('pdf'), byteSize: 3, sha256: 'b'.repeat(64) }
        ];
      }
    }
  };
  await createOpportunityTechnicalDocumentVersionOne(repositories, actor, opportunity, {
    documentType: 'technical_agreement', equipmentItemIds: ['11', '12'], language: 'en'
  });
  assert.deepEqual(stored.versionItems.map((item) => item.productCategoryCode), ['mixer', 'rubber_cutter']);
  assert.deepEqual(stored.versionItems.map((item) => item.templateRevisionNo), [2, 3]);
  assert.equal(stored.primaryEquipmentItemId, null);
});

test('Chinese login freezes Chinese template text and excludes English standard clauses', async () => {
  const currentTemplate = template();
  currentTemplate.revisions[0].contentSchema.sections[0].defaultClauseIds = [30, 31];
  let stored;
  let generated;
  const repositories = {
    opportunityTechnicalDocumentRepository: {
      async listEquipmentByOpportunity() { return [equipment()]; },
      async findDocumentByIdentity() { return null; },
      async createDocumentVersionOne(input) {
        stored = input;
        return { documentId: 30, versionId: 40, versionNo: 1 };
      }
    },
    technicalTemplateRepository: {
      async listTemplates() { return [currentTemplate]; },
      async getTemplateDetail() { return currentTemplate; },
      async listClauses() {
        return [
          { id: 30, clauseCode: 'FAT-EN', revisionNo: 1, revisionLabel: 'FAT-EN-R1', title: 'English FAT', language: 'en', content: 'English clause.' },
          { id: 31, clauseCode: 'FAT-ZH', revisionNo: 1, revisionLabel: 'FAT-ZH-R1', title: '中文验收', language: 'zh', content: '中文条款。' }
        ];
      }
    },
    technicalMaterialDocumentService: {
      async generateVersionOne(input) {
        generated = input;
        return [
          { format: 'docx', originalName: 'v1.docx', mimeType: 'docx', content: Buffer.from('docx'), byteSize: 4, sha256: 'a'.repeat(64) },
          { format: 'pdf', originalName: 'v1.pdf', mimeType: 'pdf', content: Buffer.from('pdf'), byteSize: 3, sha256: 'b'.repeat(64) }
        ];
      }
    }
  };

  await createOpportunityTechnicalDocumentVersionOne(repositories, actor, opportunity, {
    documentType: 'technical_agreement', equipmentItemIds: ['11'], language: 'zh'
  });

  assert.equal(stored.sourceSnapshot.language, 'zh');
  assert.equal(stored.title, 'Polymer Mixer - 技术协议');
  assert.equal(stored.versionItems[0].templateName, '搅拌机技协议');
  assert.equal(stored.versionItems[0].productCategoryName, '搅拌机');
  assert.deepEqual(stored.versionItems[0].renderedContent.sections[0].clauses.map((clause) => clause.id), [31]);
  assert.equal(generated.language, 'zh');
});

test('Datasheet requires exactly one item and blocks generation without its category template', async () => {
  await assert.rejects(
    createOpportunityTechnicalDocumentVersionOne({}, actor, opportunity, {
      documentType: 'datasheet', equipmentItemIds: [11, 12], language: 'en'
    }),
    (error) => error.statusCode === 400 && /exactly one/.test(error.message)
  );
  const repository = {
    opportunityTechnicalDocumentRepository: {
      async listEquipmentByOpportunity() { return [equipment()]; },
      async findDocumentByIdentity() { return null; }
    },
    technicalTemplateRepository: {
      async listTemplates() { return []; },
      async listClauses() { return []; }
    }
  };
  await assert.rejects(
    createOpportunityTechnicalDocumentVersionOne(repository, actor, opportunity, {
      documentType: 'datasheet', equipmentItemIds: 11, language: 'en'
    }),
    (error) => error.statusCode === 409 && /Missing current published Datasheet template/.test(error.message)
  );
});

async function validDocxBuffer() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<document/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('external edit creates a next version only when matching DOCX and PDF are both supplied', async () => {
  const calls = [];
  const repository = {
    async getDocumentDetail() { return { id: 30, currentVersionNo: 1, versions: [{ id: 40, versionNo: 1, items: [{ id: 11 }] }] }; },
    async addUploadedVersion(input) { calls.push(input); return { documentId: 30, versionId: 41, versionNo: 2 }; }
  };
  const created = await saveUploadedOpportunityTechnicalDocumentVersion(repository, actor, opportunity, 30, {
    changeSummary: 'Customer technical comments',
    sourceVersionNo: 1,
    docxFile: { originalname: 'edited.docx', buffer: await validDocxBuffer() },
    pdfFile: { originalname: 'edited.pdf', buffer: Buffer.from('%PDF-1.7\nupdated') }
  });
  assert.equal(created.versionNo, 2);
  assert.equal(calls[0].files.length, 2);
  assert.equal(calls[0].files[0].sha256.length, 64);

  await assert.rejects(
    saveUploadedOpportunityTechnicalDocumentVersion(repository, actor, opportunity, 30, {
      changeSummary: 'Bad pair',
      sourceVersionNo: 1,
      docxFile: { originalname: 'edited.docx', buffer: await validDocxBuffer() },
      pdfFile: { originalname: 'edited.pdf', buffer: Buffer.from('not a pdf') }
    }),
    (error) => error.statusCode === 400 && /valid PDF/.test(error.message)
  );
});

test('external edit rejects a stale source version before accepting replacement files', async () => {
  let mutationCalled = false;
  const repository = {
    async getDocumentDetail() {
      return {
        id: 30,
        currentVersionNo: 2,
        versions: [
          { id: 41, versionNo: 2, items: [{ id: 11 }] },
          { id: 40, versionNo: 1, items: [{ id: 11 }] }
        ]
      };
    },
    async addUploadedVersion() {
      mutationCalled = true;
    }
  };

  await assert.rejects(
    saveUploadedOpportunityTechnicalDocumentVersion(repository, actor, opportunity, 30, {
      changeSummary: 'Stale customer comments',
      sourceVersionNo: 1,
      docxFile: { originalname: 'edited.docx', buffer: await validDocxBuffer() },
      pdfFile: { originalname: 'edited.pdf', buffer: Buffer.from('%PDF-1.7\nupdated') }
    }),
    (error) => error.statusCode === 409 && /newer technical document version/.test(error.message)
  );
  assert.equal(mutationCalled, false);
});
