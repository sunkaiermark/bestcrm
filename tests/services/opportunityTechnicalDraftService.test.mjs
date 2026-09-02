import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  assignOpportunityTechnicalDraftSection,
  canCreateOpportunityTechnicalDraft,
  canEditOpportunityTechnicalDraftSection,
  canReviewOpportunityTechnicalDraft,
  generateOpportunityTechnicalDraft,
  markOpportunityTechnicalDraftReady,
  prefillTechnicalDraftVariables,
  renderTechnicalDraftContent,
  updateOpportunityTechnicalDraftSection,
  updateOpportunityTechnicalDraftVariables,
  validateTechnicalDraftVariables
} from '../../src/services/opportunityTechnicalDraftService.mjs';

const lead = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };
const support = { id: 4, roles: [ROLES.QUOTATION_ENGINEER] };
const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };

function opportunity() {
  return {
    id: 20,
    opportunityNo: 'OPP-20',
    title: 'MX Project',
    customerId: 8,
    primaryContactId: 9,
    salespersonId: 7,
    quotationEngineerId: 3,
    teamMembers: [{
      id: 11,
      userId: 4,
      roleCode: ROLES.QUOTATION_ENGINEER,
      isActive: true
    }]
  };
}

function variable(overrides = {}) {
  return {
    variableKey: 'capacity',
    labelEn: 'Capacity',
    labelZh: '处理能力',
    dataType: 'number',
    sourceField: 'capacity',
    sectionKey: 'design_parameters',
    isRequired: true,
    defaultValue: '',
    validationRules: { min: 1, max: 100 },
    ...overrides
  };
}

function section(overrides = {}) {
  return {
    key: 'design_parameters',
    labelEn: 'Design Parameters',
    labelZh: '设计参数',
    enabled: true,
    sortOrder: 1,
    sectionType: 'parameter_table',
    bodyEn: 'Standard values',
    bodyZh: '标准参数',
    tableRows: [['Item', 'Value']],
    condition: { operator: 'always', variableKey: '', value: '' },
    defaultClauseIds: [30],
    blocks: [],
    ...overrides
  };
}

function draft(overrides = {}) {
  const contentSchemaSnapshot = { schemaVersion: 1, sections: [section(), section({
    key: 'utilities',
    labelEn: 'Utilities',
    labelZh: '公用工程',
    sortOrder: 2,
    defaultClauseIds: []
  })] };
  const variableSchemaSnapshot = [variable()];
  const variableValues = { capacity: '' };
  return {
    id: 41,
    opportunityId: 20,
    status: 'draft',
    contentSchemaSnapshot,
    variableSchemaSnapshot,
    variableValues,
    selectedClauses: [],
    renderedContent: renderTechnicalDraftContent({
      contentSchema: contentSchemaSnapshot,
      variableSchema: variableSchemaSnapshot,
      variableValues,
      selectedClauses: []
    }),
    assignments: [{ id: 5, assigneeUserId: 4, sectionKey: 'design_parameters', isActive: true }],
    ...overrides
  };
}

test('only the appointed Project Lead Engineer can generate a project draft', () => {
  assert.equal(canCreateOpportunityTechnicalDraft(lead, opportunity()), true);
  assert.equal(canCreateOpportunityTechnicalDraft(support, opportunity()), false);
  assert.equal(canCreateOpportunityTechnicalDraft(salesperson, opportunity()), false);
});

test('only the assigned Technical Manager can review a pending technical draft', () => {
  const pending = draft({ status: 'pending' });
  const technicalManager = { id: 6, roles: [ROLES.TECHNICAL_MANAGER] };
  const otherManager = { id: 8, roles: [ROLES.TECHNICAL_MANAGER] };
  const assignedOpportunity = { ...opportunity(), technicalManagerId: 6 };
  assert.equal(canReviewOpportunityTechnicalDraft(technicalManager, assignedOpportunity, pending), true);
  assert.equal(canReviewOpportunityTechnicalDraft(otherManager, assignedOpportunity, pending), false);
  assert.equal(canReviewOpportunityTechnicalDraft(technicalManager, assignedOpportunity, draft()), false);
});

test('generation freezes the current published template and prefills known project data', async () => {
  const created = [];
  const template = {
    id: 5,
    templateCode: 'MX-100',
    name: 'Mixer Agreement',
    productModel: 'MX-100',
    language: 'bilingual',
    isActive: true,
    currentPublishedRevisionId: 9,
    revisions: [{
      id: 9,
      revisionNo: 2,
      status: 'published',
      contentSchema: { schemaVersion: 1, sections: [section()] },
      variables: [
        variable({ variableKey: 'customer_name', dataType: 'text', sourceField: 'customer_name', sectionKey: 'cover_and_parties', validationRules: {} }),
        variable({ variableKey: 'product_model', dataType: 'text', sourceField: 'product_model', validationRules: {} }),
        variable()
      ]
    }]
  };
  const repositories = {
    technicalTemplateRepository: {
      async getTemplateDetail() { return template; },
      async listClauses() {
        return [{ id: 30, clauseCode: 'FAT-01', revisionNo: 1, revisionLabel: 'FAT-01-R1', title: 'FAT', language: 'bilingual', content: 'FAT required', conditionSchema: {}, status: 'published' }];
      }
    },
    opportunityTechnicalDraftRepository: {
      async getGenerationContext() {
        return {
          customerName: 'Acme',
          contactName: 'Lee',
          opportunityTitle: 'MX Project',
          requirementSummary: '10 t/h mixer',
          productName: 'Mixer',
          deliveryDestination: 'Singapore',
          opportunityOwner: 'Sales One',
          capacity: ''
        };
      },
      async createDraft(input) { created.push(input); return { id: 41, draftRevisionNo: 1, ...input }; }
    }
  };

  const result = await generateOpportunityTechnicalDraft(repositories, lead, opportunity(), 5);

  assert.equal(result.id, 41);
  assert.equal(created[0].templateRevisionId, 9);
  assert.equal(created[0].templateRevisionNoSnapshot, 2);
  assert.equal(created[0].language, 'bilingual');
  assert.equal(created[0].variableValues.customer_name, 'Acme');
  assert.equal(created[0].variableValues.product_model, 'MX-100');
  assert.equal(created[0].selectedClauses[0].revisionLabel, 'FAT-01-R1');
  assert.equal(created[0].validationIssues[0].variableKey, 'capacity');
  assert.notEqual(created[0].contentSchemaSnapshot, template.revisions[0].contentSchema);
});

test('English Chinese and bilingual templates preserve their selected generation language', async () => {
  for (const language of ['en', 'zh', 'bilingual']) {
    const created = [];
    const repositories = {
      technicalTemplateRepository: {
        async getTemplateDetail() {
          return {
            id: 5,
            templateCode: `MX-${language}`,
            name: 'Agreement',
            productModel: '',
            language,
            isActive: true,
            currentPublishedRevisionId: 9,
            revisions: [{ id: 9, revisionNo: 1, status: 'published', contentSchema: { schemaVersion: 1, sections: [section()] }, variables: [] }]
          };
        },
        async listClauses() { return []; }
      },
      opportunityTechnicalDraftRepository: {
        async getGenerationContext() { return {}; },
        async createDraft(input) { created.push(input); return input; }
      }
    };
    await generateOpportunityTechnicalDraft(repositories, lead, opportunity(), 5);
    assert.equal(created[0].language, language);
    assert.equal(created[0].renderedContent.sections.length, 1);
  }
});

test('variable validation reports required, range and approved-list issues', () => {
  const schema = [
    variable(),
    variable({ variableKey: 'pressure', labelEn: 'Pressure', labelZh: '压力', sourceField: 'pressure', validationRules: { min: 1, max: 10 } }),
    variable({ variableKey: 'material', labelEn: 'Material', labelZh: '材质', dataType: 'text', sourceField: 'material', validationRules: { allowedValues: ['SS304', 'SS316L'] } })
  ];
  const issues = validateTechnicalDraftVariables(schema, { capacity: '', pressure: 20, material: 'CS' });
  assert.deepEqual(issues.map((issue) => issue.code), ['required', 'maximum', 'allowed_values']);
});

test('conditions alter inclusion without executing template expressions', () => {
  const conditional = section({
    key: 'utilities',
    condition: { operator: 'equals', variableKey: 'material', value: 'SS316L' },
    defaultClauseIds: []
  });
  const content = renderTechnicalDraftContent({
    contentSchema: { schemaVersion: 1, sections: [conditional] },
    variableSchema: [],
    variableValues: { material: 'CS' },
    selectedClauses: []
  });
  assert.equal(content.sections[0].included, false);
});

test('Supporting Engineers edit only assigned sections and attributed changes differ from the standard', async () => {
  const calls = [];
  const currentDraft = draft();
  const repository = {
    async updateSection(input) { calls.push(input); return input; }
  };
  assert.equal(canEditOpportunityTechnicalDraftSection(support, opportunity(), currentDraft, 'design_parameters'), true);
  assert.equal(canEditOpportunityTechnicalDraftSection(support, opportunity(), currentDraft, 'utilities'), false);

  await updateOpportunityTechnicalDraftSection(repository, support, opportunity(), currentDraft, 'design_parameters', {
    bodyEn: 'Project-specific 50 t/h',
    bodyZh: '项目参数 50 t/h',
    tableRows: 'Capacity | 50 t/h'
  });
  assert.equal(calls[0].standardChanged, true);
  assert.equal(calls[0].actorUserId, 4);
  assert.equal(calls[0].renderedContent.sections[0].lastEditedBy, 4);

  await assert.rejects(
    updateOpportunityTechnicalDraftSection(repository, support, opportunity(), currentDraft, 'utilities', {}),
    (error) => error.statusCode === 403
  );
});

test('submitted and approved technical drafts reject all content mutations', async () => {
  const repository = { async updateSection() { throw new Error('should not persist'); } };
  for (const status of ['pending', 'approved', 'rejected']) {
    assert.equal(canEditOpportunityTechnicalDraftSection(lead, opportunity(), draft({ status }), 'design_parameters'), false);
    await assert.rejects(
      updateOpportunityTechnicalDraftSection(repository, lead, opportunity(), draft({ status }), 'design_parameters', {}),
      (error) => error.statusCode === 409
    );
  }
});

test('Supporting Engineers update only variables belonging to their assigned section', async () => {
  const calls = [];
  const currentDraft = draft({
    variableSchemaSnapshot: [variable(), variable({ variableKey: 'voltage', sourceField: 'voltage_frequency', sectionKey: 'electrical_requirements' })],
    variableValues: { capacity: 10, voltage: 400 }
  });
  const repository = { async updateVariables(input) { calls.push(input); return input; } };
  await updateOpportunityTechnicalDraftVariables(repository, support, opportunity(), currentDraft, { capacity: '50' });
  assert.equal(calls[0].variableValues.capacity, 50);
  await assert.rejects(
    updateOpportunityTechnicalDraftVariables(repository, support, opportunity(), currentDraft, { voltage: '480' }),
    (error) => error.statusCode === 403
  );
});

test('readiness is blocked until required values and engineering ranges pass', async () => {
  const repository = { async markReady(input) { return input; } };
  await assert.rejects(
    markOpportunityTechnicalDraftReady(repository, lead, opportunity(), draft()),
    (error) => error.statusCode === 409 && error.details[0].code === 'required'
  );
  const ready = await markOpportunityTechnicalDraftReady(repository, lead, opportunity(), draft({ variableValues: { capacity: 50 } }));
  assert.equal(ready.actorUserId, 3);
});

test('section assignment accepts only active Supporting Engineers on the opportunity', async () => {
  const calls = [];
  const repository = { async addAssignment(input) { calls.push(input); return input; } };
  await assignOpportunityTechnicalDraftSection(repository, lead, opportunity(), draft(), {
    sectionKey: 'utilities',
    assigneeUserId: 4,
    dueDate: '2026-09-10'
  });
  assert.equal(calls[0].assigneeUserId, 4);
  await assert.rejects(
    assignOpportunityTechnicalDraftSection(repository, lead, opportunity(), draft(), { sectionKey: 'utilities', assigneeUserId: 99 }),
    (error) => error.statusCode === 400
  );
});

test('prefill uses defaults when an approved CRM source is unavailable', () => {
  const values = prefillTechnicalDraftVariables([
    variable({ variableKey: 'pressure', sourceField: 'pressure', defaultValue: '6', validationRules: {} })
  ], { pressure: '' }, { productModel: '' });
  assert.equal(values.pressure, 6);
});
