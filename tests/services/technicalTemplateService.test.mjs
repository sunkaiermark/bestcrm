import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  addTechnicalTemplateRevisionVariable,
  canAuthorTechnicalTemplates,
  canManageTechnicalVariableCatalog,
  canViewTechnicalTemplate,
  canViewTechnicalTemplateLibrary,
  createTechnicalClause,
  createTechnicalTemplate,
  createTechnicalVariableDefinition,
  getTechnicalTemplateDetail,
  listTechnicalTemplates,
  normalizeRevisionVariableInput,
  normalizeTechnicalSectionInput,
  normalizeTechnicalTemplateInput,
  normalizeVariableDefinitionInput,
  publishTechnicalTemplateRevision,
  updateTechnicalTemplateSection
} from '../../src/services/technicalTemplateService.mjs';

function user(role, id = 7) {
  return { id, roles: [role] };
}

test('technical template role matrix separates viewing authoring and variable administration', () => {
  const administrator = user(ROLES.ADMINISTRATOR);
  const technicalManager = user(ROLES.TECHNICAL_MANAGER);
  const quotationEngineer = user(ROLES.QUOTATION_ENGINEER);
  const salesperson = user(ROLES.SALESPERSON);

  assert.equal(canViewTechnicalTemplateLibrary(administrator), true);
  assert.equal(canViewTechnicalTemplateLibrary(technicalManager), true);
  assert.equal(canViewTechnicalTemplateLibrary(quotationEngineer), true);
  assert.equal(canViewTechnicalTemplateLibrary(salesperson), false);
  assert.equal(canAuthorTechnicalTemplates(technicalManager), true);
  assert.equal(canAuthorTechnicalTemplates(administrator), false);
  assert.equal(canManageTechnicalVariableCatalog(administrator), true);
  assert.equal(canManageTechnicalVariableCatalog(technicalManager), false);
});

test('quotation engineers can only view active templates with a published revision', () => {
  const quotationEngineer = user(ROLES.QUOTATION_ENGINEER);
  assert.equal(canViewTechnicalTemplate(quotationEngineer, {
    isActive: true,
    currentPublishedRevisionId: 11
  }), true);
  assert.equal(canViewTechnicalTemplate(quotationEngineer, {
    isActive: false,
    currentPublishedRevisionId: 11
  }), false);
  assert.equal(canViewTechnicalTemplate(quotationEngineer, {
    isActive: true,
    currentPublishedRevisionId: null
  }), false);
});

test('template input creates a safe structured standard-section schema', () => {
  const normalized = normalizeTechnicalTemplateInput({
    templateCode: 'mx-100',
    name: 'Mixer Technical Agreement',
    productFamily: 'Mixing',
    productModel: 'MX-100',
    application: 'Polymerization',
    language: 'bilingual',
    changeSummary: 'Initial controlled version'
  });

  assert.equal(normalized.templateCode, 'MX-100');
  assert.equal(normalized.language, 'bilingual');
  assert.equal(normalized.contentSchema.schemaVersion, 1);
  assert.equal(normalized.contentSchema.sections.length, 18);
  assert.equal(normalized.contentSchema.sections[0].key, 'cover_and_parties');
  assert.equal(normalized.contentSchema.sections.at(-1).key, 'technical_warranty');
});

test('variable definitions reject unapproved data sources and executable syntax', () => {
  assert.throws(() => normalizeVariableDefinitionInput({
    variableKey: 'capacity',
    labelEn: 'Capacity',
    labelZh: '处理能力',
    dataType: 'number',
    sourceField: 'eval_expression'
  }), /source field is not allowed/);

  assert.throws(() => normalizeRevisionVariableInput({
    variableDefinitionId: 1,
    defaultValue: '{{process.env.SECRET}}',
    minValue: '',
    maxValue: '',
    sortOrder: 1
  }), /unsupported template or script syntax/);

  assert.throws(() => normalizeRevisionVariableInput({
    variableDefinitionId: 1,
    minValue: 20,
    maxValue: 10,
    sortOrder: 1
  }), /Minimum value cannot exceed maximum value/);
});

test('template listing scopes quotation engineers to published records', async () => {
  const calls = [];
  const repository = {
    async listTemplates(filter) {
      calls.push(filter);
      return [];
    }
  };

  await listTechnicalTemplates(repository, user(ROLES.QUOTATION_ENGINEER));
  await listTechnicalTemplates(repository, user(ROLES.TECHNICAL_MANAGER));

  assert.deepEqual(calls, [{ publishedOnly: true }, { publishedOnly: false }]);
  await assert.rejects(
    listTechnicalTemplates(repository, user(ROLES.SALESPERSON)),
    (error) => error.message === 'Forbidden' && error.statusCode === 403
  );
});

test('technical manager creates templates and publishes only pending revisions', async () => {
  const calls = [];
  const repository = {
    async createTemplate(input, actorUserId) {
      calls.push({ method: 'createTemplate', input, actorUserId });
      return { id: 4, revisionId: 8 };
    },
    async publishRevision(revisionId, actorUserId) {
      calls.push({ method: 'publishRevision', revisionId, actorUserId });
      return revisionId === 8 ? { id: 8, templateId: 4 } : null;
    }
  };
  const actor = user(ROLES.TECHNICAL_MANAGER, 9);

  const created = await createTechnicalTemplate(repository, actor, {
    templateCode: 'RX-1',
    name: 'Reactor Agreement',
    productFamily: 'Reactor',
    language: 'en',
    changeSummary: 'Initial revision'
  });
  const published = await publishTechnicalTemplateRevision(repository, actor, 8);

  assert.deepEqual(created, { id: 4, revisionId: 8 });
  assert.deepEqual(published, { id: 8, templateId: 4 });
  assert.equal(calls[0].input.contentSchema.sections.length, 18);
  assert.deepEqual(calls[1], { method: 'publishRevision', revisionId: 8, actorUserId: 9 });
  await assert.rejects(
    publishTechnicalTemplateRevision(repository, actor, 99),
    (error) => error.statusCode === 409
  );
  await assert.rejects(
    createTechnicalTemplate(repository, user(ROLES.ADMINISTRATOR), {
      templateCode: 'X', name: 'X', productFamily: 'X', language: 'en', changeSummary: 'X'
    }),
    (error) => error.message === 'Forbidden'
  );
});

test('quotation engineer direct detail access rejects draft templates', async () => {
  const repository = {
    async getTemplateDetail() {
      return { id: 1, isActive: true, currentPublishedRevisionId: null };
    }
  };

  await assert.rejects(
    getTechnicalTemplateDetail(repository, user(ROLES.QUOTATION_ENGINEER), 1),
    (error) => error.message === 'Forbidden' && error.statusCode === 403
  );
});

test('only administrators create safe variable catalogue entries', async () => {
  const calls = [];
  const repository = {
    async createVariableDefinition(input, actorUserId) {
      calls.push({ input, actorUserId });
      return { id: 2, ...input };
    }
  };
  const created = await createTechnicalVariableDefinition(repository, user(ROLES.ADMINISTRATOR, 3), {
    variableKey: 'design_pressure',
    labelEn: 'Design Pressure',
    labelZh: '设计压力',
    dataType: 'number',
    sourceField: 'pressure',
    isActive: 'on'
  });

  assert.equal(created.variableKey, 'design_pressure');
  assert.equal(calls[0].actorUserId, 3);
  await assert.rejects(
    createTechnicalVariableDefinition(repository, user(ROLES.TECHNICAL_MANAGER), {}),
    (error) => error.message === 'Forbidden'
  );
});

test('revision variable input is normalized into non-executable structured rules', async () => {
  const calls = [];
  const repository = {
    async upsertRevisionVariable(revisionId, input, actorUserId) {
      calls.push({ revisionId, input, actorUserId });
      return { id: 5, templateRevisionId: revisionId, ...input };
    }
  };
  await addTechnicalTemplateRevisionVariable(repository, user(ROLES.TECHNICAL_MANAGER, 8), 12, {
    variableDefinitionId: 4,
    isRequired: 'on',
    defaultValue: '10 bar',
    minValue: '1',
    maxValue: '20',
    allowedValues: '10 bar, 16 bar',
    sortOrder: '2'
  });

  assert.deepEqual(calls[0], {
    revisionId: 12,
    actorUserId: 8,
    input: {
      variableDefinitionId: 4,
      sectionKey: 'design_parameters',
      isRequired: true,
      defaultValue: '10 bar',
      validationRules: { min: 1, max: 20, allowedValues: ['10 bar', '16 bar'] },
      sortOrder: 2
    }
  });
});

test('only technical managers author standard clauses', async () => {
  const repository = {
    async createClause(input, actorUserId) {
      return { id: 7, actorUserId, ...input };
    }
  };
  const created = await createTechnicalClause(repository, user(ROLES.TECHNICAL_MANAGER, 12), {
    clauseCode: 'FAT-01',
    title: 'Factory acceptance test',
    language: 'en',
    productFamily: 'Mixer',
    content: 'The equipment shall undergo a documented FAT.',
    changeSummary: 'Initial clause'
  });
  assert.equal(created.clauseCode, 'FAT-01');
  assert.deepEqual(created.conditionSchema, { all: [] });
  await assert.rejects(
    createTechnicalClause(repository, user(ROLES.ADMINISTRATOR), {}),
    (error) => error.message === 'Forbidden'
  );
});

test('structured template sections normalize order tables conditions and published clause references', async () => {
  const calls = [];
  const repository = {
    async getTemplateDetail() {
      return {
        id: 4,
        revisions: [{
          id: 9,
          status: 'draft',
          contentSchema: {
            schemaVersion: 1,
            sections: [
              { key: 'project_basis', labelEn: 'Project Basis', labelZh: '项目依据', sortOrder: 1 },
              { key: 'design_parameters', labelEn: 'Design Parameters', labelZh: '设计参数', sortOrder: 2 }
            ]
          },
          variables: [{ variableKey: 'capacity' }]
        }]
      };
    },
    async listClauses() { return [{ id: 30, status: 'published' }]; },
    async updateRevisionContent(revisionId, contentSchema, actorUserId) {
      calls.push({ revisionId, contentSchema, actorUserId });
      return { id: revisionId, templateId: 4 };
    }
  };
  await updateTechnicalTemplateSection(repository, user(ROLES.TECHNICAL_MANAGER, 8), 4, 9, 'design_parameters', {
    labelEn: 'Design Parameters',
    labelZh: '设计参数',
    enabled: 'on',
    sortOrder: 1,
    sectionType: 'parameter_table',
    bodyEn: 'Design basis',
    bodyZh: '设计依据',
    tableRows: 'Capacity | 10 t/h\nPressure | 6 bar',
    conditionOperator: 'equals',
    conditionVariableKey: 'capacity',
    conditionValue: '10',
    defaultClauseIds: 30
  });

  assert.equal(calls[0].revisionId, 9);
  assert.equal(calls[0].actorUserId, 8);
  assert.equal(calls[0].contentSchema.sections[0].key, 'design_parameters');
  assert.deepEqual(calls[0].contentSchema.sections[0].tableRows[0], ['Capacity', '10 t/h']);
  assert.deepEqual(calls[0].contentSchema.sections[0].defaultClauseIds, [30]);
});

test('structured section editor rejects executable text and unknown condition variables', async () => {
  assert.throws(() => normalizeTechnicalSectionInput('project_basis', {
    labelEn: 'Project Basis',
    labelZh: '项目依据',
    enabled: 'on',
    sortOrder: 1,
    sectionType: 'narrative',
    bodyEn: '<script>alert(1)</script>',
    conditionOperator: 'always'
  }), /unsupported template or script syntax/);

  const repository = {
    async getTemplateDetail() {
      return {
        id: 4,
        revisions: [{
          id: 9,
          status: 'draft',
          contentSchema: { schemaVersion: 1, sections: [{ key: 'project_basis', sortOrder: 1 }] },
          variables: []
        }]
      };
    },
    async listClauses() { return []; }
  };
  await assert.rejects(
    updateTechnicalTemplateSection(repository, user(ROLES.TECHNICAL_MANAGER), 4, 9, 'project_basis', {
      labelEn: 'Project Basis', labelZh: '项目依据', enabled: 'on', sortOrder: 1,
      sectionType: 'narrative', conditionOperator: 'truthy', conditionVariableKey: 'capacity'
    }),
    (error) => error.statusCode === 400 && /not assigned/.test(error.message)
  );
});
