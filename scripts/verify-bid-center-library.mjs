import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/db/migrate.mjs';
import { seedInternalAccounts } from '../src/db/seed.mjs';
import { createCommercialPackageTemplateRepository } from '../src/repositories/commercialPackageTemplateRepository.mjs';
import { createBidContentBlockRepository } from '../src/repositories/bidContentBlockRepository.mjs';
import { createCommercialPackageTemplateService } from '../src/services/commercialPackageTemplateService.mjs';
import { createBidContentBlockService } from '../src/services/bidContentBlockService.mjs';
import { ROLES } from '../src/domain/roles.mjs';
import { BID_LIBRARY_TYPES } from '../src/domain/bidCenterLibrary.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Refusing to use a database whose name does not start with bestcrm_bid_center_test');
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function verify() {
  await migrate(pool);
  await seedInternalAccounts(pool, { nodeEnv: 'test' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(`
      INSERT INTO users (username, password_hash, display_name, email)
      VALUES ('bid-center-step3', 'not-a-real-password-hash', 'Bid Center Step 3', 'step3@example.invalid')
      RETURNING id
    `);
    const actorId = Number(userResult.rows[0].id);
    const commercialActor = { id: actorId, roles: [ROLES.COMMERCIAL_MANAGER] };
    const technicalActor = { id: actorId, roles: [ROLES.TECHNICAL_MANAGER] };
    const administrator = { id: actorId, roles: [ROLES.ADMINISTRATOR] };
    const commercialRepository = createCommercialPackageTemplateRepository(client);
    const contentRepository = createBidContentBlockRepository(client);
    const commercialService = createCommercialPackageTemplateService({ enabled: true, repository: commercialRepository });
    const contentService = createBidContentBlockService({ enabled: true, repository: contentRepository });

    const commercial = await commercialService.create(commercialActor, {
      templateCode: 'COMM-STEP3',
      nameEn: 'Step 3 Commercial Package',
      nameZh: '第3步商务包',
      language: 'bilingual',
      applicableCountries: 'CN, SG',
      applicableIndustries: 'Chemical',
      applicableCustomerTypes: 'Industrial',
      changeSummary: 'Initial controlled revision'
    });
    let commercialDetail = await commercialService.get(commercialActor, commercial.id);
    assert.equal(commercialDetail.revisions[0].revisionLabel, 'CTPL-R1');
    assert.equal(commercialDetail.revisions[0].contentSchema.sections.length, 20);
    await commercialService.updateSection(
      commercialActor,
      commercial.id,
      commercial.revisionId,
      'commercial_cover',
      {
        labelEn: 'Commercial Cover and Contents',
        labelZh: '商务封面和目录',
        sectionType: 'narrative',
        enabled: 'on',
        sortOrder: 1,
        bodyEn: 'Controlled cover',
        bodyZh: '受控封面'
      },
      []
    );
    await commercialService.submit(commercialActor, commercial.id, commercial.revisionId);
    await assert.rejects(commercialService.publish(administrator, commercial.id, commercial.revisionId), (error) => error.statusCode === 403);
    await commercialService.publish(commercialActor, commercial.id, commercial.revisionId);
    await assert.rejects(commercialService.get(technicalActor, commercial.id), (error) => error.statusCode === 403);
    const commercialR2 = await commercialService.createRevision(commercialActor, commercial.id, { changeSummary: 'Second revision' });
    assert.equal(commercialR2.revisionNo, 2);
    await commercialService.submit(commercialActor, commercial.id, commercialR2.id);
    await commercialService.publish(commercialActor, commercial.id, commercialR2.id);
    commercialDetail = await commercialService.get(commercialActor, commercial.id);
    assert.equal(commercialDetail.currentPublishedRevisionId, commercialR2.id);
    assert.equal(commercialDetail.revisions.find((revision) => revision.id === commercial.revisionId)?.status, 'retired');

    const content = await contentService.create(commercialActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, {
      blockCode: 'QUAL-STEP3',
      category: 'common',
      ownerRoleCode: ROLES.COMMERCIAL_MANAGER,
      nameEn: 'Controlled Qualification',
      nameZh: '受控资质',
      language: 'bilingual',
      componentType: 'controlled_attachment',
      titleEn: 'Qualification',
      titleZh: '资质',
      effectiveDate: '2026-09-04',
      expiresAt: '2027-09-04',
      sensitivity: 'internal',
      changeSummary: 'Initial controlled material'
    }, {
      storedPath: 'bid-content/test/qualification.pdf',
      originalName: 'qualification.pdf',
      mimeType: 'application/pdf',
      byteSize: 16,
      sha256: 'a'.repeat(64)
    });
    await contentService.submit(commercialActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, content.id, content.revisionId);
    await contentService.publish(commercialActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, content.id, content.revisionId);
    const published = await contentService.list(commercialActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, { category: 'common' });
    assert.equal(published[0].latestRevisionLabel, 'QUAL-STEP3-R1');
    assert.equal(published[0].hasAttachment, true);
    const contentR2 = await contentService.createRevision(
      commercialActor,
      BID_LIBRARY_TYPES.PUBLIC_MATERIAL,
      content.id,
      { changeSummary: 'Annual review' }
    );
    assert.equal(contentR2.revisionNo, 2);
    await assert.rejects(
      contentService.publish(technicalActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, content.id, contentR2.id),
      (error) => error.statusCode === 403
    );
    await contentService.submit(commercialActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, content.id, contentR2.id);
    await contentService.publish(commercialActor, BID_LIBRARY_TYPES.PUBLIC_MATERIAL, content.id, contentR2.id);
    const contentDetail = await contentService.get(commercialActor, content.id, BID_LIBRARY_TYPES.PUBLIC_MATERIAL);
    assert.equal(contentDetail.currentPublishedRevisionId, contentR2.id);
    assert.equal(contentDetail.revisions.find((revision) => revision.id === content.revisionId)?.status, 'retired');

    commercialDetail = await commercialService.get(commercialActor, commercial.id);
    assert.deepEqual(commercialDetail.revisions.map((revision) => revision.revisionLabel), ['CTPL-R2', 'CTPL-R1']);
    await client.query('ROLLBACK');
    console.log('Bid Center Step 3 repository integration checks passed.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

verify()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
