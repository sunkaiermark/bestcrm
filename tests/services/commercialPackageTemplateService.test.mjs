import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canAuthorCommercialTemplates,
  canViewCommercialTemplateLibrary,
  createCommercialPackageTemplateService,
  normalizeCommercialTemplateInput
} from '../../src/services/commercialPackageTemplateService.mjs';

const actor = (role, id = 7) => ({ id, roles: [role] });

function template(status = 'draft') {
  return {
    id: 4,
    templateCode: 'COMM-BASE',
    isActive: status === 'published',
    currentPublishedRevisionId: status === 'published' ? 9 : null,
    revisions: [{
      id: 9,
      status,
      contentSchema: normalizeCommercialTemplateInput({
        templateCode: 'COMM-BASE', nameEn: 'Commercial', nameZh: '商务', language: 'bilingual', changeSummary: 'Initial'
      }).contentSchema
    }]
  };
}

test('commercial library separates viewing, authoring, and administration', () => {
  assert.equal(canViewCommercialTemplateLibrary(actor(ROLES.SALESPERSON)), true);
  assert.equal(canViewCommercialTemplateLibrary(actor(ROLES.COMMERCIAL_MANAGER)), true);
  assert.equal(canViewCommercialTemplateLibrary(actor(ROLES.TECHNICAL_MANAGER)), false);
  assert.equal(canAuthorCommercialTemplates(actor(ROLES.COMMERCIAL_MANAGER)), true);
  assert.equal(canAuthorCommercialTemplates(actor(ROLES.ADMINISTRATOR)), false);
});

test('new commercial templates use CTPL-ready frozen commercial sections', async () => {
  const calls = [];
  const service = createCommercialPackageTemplateService({
    enabled: true,
    repository: { async createTemplate(input, actorUserId) { calls.push({ input, actorUserId }); return { id: 4, revisionId: 9 }; } }
  });
  const created = await service.create(actor(ROLES.COMMERCIAL_MANAGER), {
    templateCode: 'comm-global', nameEn: 'Global Commercial Package', nameZh: '全球商务包', language: 'bilingual',
    applicableCountries: 'CN, SG', changeSummary: 'Initial controlled revision'
  });
  assert.deepEqual(created, { id: 4, revisionId: 9 });
  assert.equal(calls[0].input.templateCode, 'COMM-GLOBAL');
  assert.equal(calls[0].input.contentSchema.sections.length, 20);
  assert.deepEqual(calls[0].input.applicableCountries, ['CN', 'SG']);
});

test('non-manager viewers receive only the current published revision', async () => {
  const record = template('published');
  record.revisions.unshift({ id: 10, status: 'draft', contentSchema: { sections: [] } });
  const calls = [];
  const service = createCommercialPackageTemplateService({
    enabled: true,
    repository: {
      async listTemplates(filter) { calls.push(filter); return [record]; },
      async getTemplateDetail() { return structuredClone(record); }
    }
  });
  await service.list(actor(ROLES.SALESPERSON));
  const detail = await service.get(actor(ROLES.SALESPERSON), 4);
  assert.deepEqual(calls, [{ publishedOnly: true }]);
  assert.deepEqual(detail.revisions.map((revision) => revision.id), [9]);
});

test('only Commercial Manager can advance commercial template lifecycle', async () => {
  const calls = [];
  const record = template('review_pending');
  const service = createCommercialPackageTemplateService({
    enabled: true,
    repository: {
      async getTemplateDetail() { return structuredClone(record); },
      async publishRevision(revisionId, actorUserId) { calls.push({ revisionId, actorUserId }); return { id: revisionId, templateId: 4 }; }
    }
  });
  await service.publish(actor(ROLES.COMMERCIAL_MANAGER, 5), 4, 9);
  assert.deepEqual(calls, [{ revisionId: 9, actorUserId: 5 }]);
  await assert.rejects(service.publish(actor(ROLES.ADMINISTRATOR), 4, 9), (error) => error.statusCode === 403);
  await assert.rejects(service.publish(actor(ROLES.TECHNICAL_MANAGER), 4, 9), (error) => error.statusCode === 403);
});

test('commercial lifecycle binds the revision to the template in the direct URL', async () => {
  let publishCalls = 0;
  const service = createCommercialPackageTemplateService({
    enabled: true,
    repository: {
      async getTemplateDetail() { return template('review_pending'); },
      async publishRevision() { publishCalls += 1; return { id: 99, templateId: 4 }; }
    }
  });
  await assert.rejects(
    service.publish(actor(ROLES.COMMERCIAL_MANAGER), 4, 99),
    (error) => error.statusCode === 404
  );
  assert.equal(publishCalls, 0);
});

test('commercial section editor rejects hidden content references and submitted revisions', async () => {
  const draft = template('draft');
  const calls = [];
  const service = createCommercialPackageTemplateService({
    enabled: true,
    repository: {
      async getTemplateDetail() { return structuredClone(draft); },
      async updateRevisionContent(revisionId, contentSchema) { calls.push({ revisionId, contentSchema }); return { id: revisionId, templateId: 4 }; }
    }
  });
  const input = {
    labelEn: 'Commercial Cover and Contents', labelZh: '商务封面和目录', sectionType: 'narrative',
    enabled: 'on', sortOrder: 1, bodyEn: 'Controlled cover', bodyZh: '受控封面', contentBlockIds: ['30']
  };
  await assert.rejects(
    service.updateSection(actor(ROLES.COMMERCIAL_MANAGER), 4, 9, 'commercial_cover', input, []),
    /visible published content/
  );
  await service.updateSection(actor(ROLES.COMMERCIAL_MANAGER), 4, 9, 'commercial_cover', input, [{ id: 30 }]);
  assert.deepEqual(calls[0].contentSchema.sections[0].contentBlockIds, [30]);
});

test('disabled commercial service returns a safe 404 before repository access', async () => {
  const service = createCommercialPackageTemplateService({ enabled: false, repository: {} });
  await assert.rejects(service.list(actor(ROLES.COMMERCIAL_MANAGER)), (error) => error.statusCode === 404);
});
