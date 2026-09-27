import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentOutcomeRepository } from '../../src/repositories/developmentOutcomeRepository.mjs';
import { createDevelopmentBusinessRepository } from '../../src/repositories/developmentBusinessRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';
import {
  createDevelopmentOutcomeRevision, proposeDevelopmentAssetCandidate,
  publishDevelopmentAsset, reviewDevelopmentAssetCandidate, withdrawDevelopmentAsset
} from '../../src/services/developmentOutcomeService.mjs';
import {
  decideDevelopmentCustomerUse, getDevelopmentBusiness, linkDevelopmentOpportunity,
  listOpportunityDevelopmentLinks, recordDevelopmentCustomerFileUse,
  requestDevelopmentCustomerUse,
  revokeDevelopmentCustomerUse, unlinkDevelopmentOpportunity
} from '../../src/services/developmentBusinessService.mjs';

const databaseUrl = process.env.DEVELOPMENT_BUSINESS_TEST_DATABASE_URL;

test('opportunity links and exact customer-use approval preserve both access boundaries', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_BUSINESS_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_business_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  try {
    await migrate(pool);
    await migrate(pool);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const role = await pool.query(`
      INSERT INTO roles (code, name) VALUES ('technical_manager', 'Technical Manager')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    async function user(label, manager = false) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_business_${label}_${suffix}`, label]);
      const id = Number(result.rows[0].id);
      if (manager) await pool.query(`
        INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
      `, [id, role.rows[0].id]);
      return { id, isActive: true, roles: manager ? ['technical_manager'] : ['salesperson'] };
    }
    const owner = await user('owner');
    const manager = await user('manager', true);
    const outsider = await user('outsider');
    const topics = createDevelopmentRepository(pool);
    const outcomes = createDevelopmentOutcomeRepository(pool);
    const business = createDevelopmentBusinessRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, owner, {
      title: `Business boundary ${suffix}`, sourceType: 'opportunity_requirement',
      directions: ['key_equipment']
    });
    await topics.addMember({ topicId: topic.id, userId: manager.id,
      responsibilityCode: 'member', actorUserId: owner.id });
    const customer = await pool.query(`
      INSERT INTO customers (name, owner_user_id) VALUES ($1, $2) RETURNING id
    `, [`Business test customer ${suffix}`, owner.id]);
    const opportunity = await pool.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, requirement, status,
        salesperson_id, technical_manager_id
      ) VALUES ($1, $2, $3, 'Test only', 'draft', $4, $5) RETURNING id
    `, [`NPD-BUSINESS-${suffix}`, 'Customer concept', customer.rows[0].id,
      owner.id, manager.id]);
    const opportunityId = Number(opportunity.rows[0].id);
    const privateOpportunity = await pool.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, requirement, status, salesperson_id
      ) VALUES ($1, $2, $3, 'Test only', 'draft', $4) RETURNING id
    `, [`NPD-PRIVATE-${suffix}`, 'Private opportunity', customer.rows[0].id,
      outsider.id]);
    assert.deepEqual((await business.searchVisibleOpportunities({
      topicId: topic.id, actorUserId: owner.id, search: 'Customer concept'
    })).map((row) => row.id), [opportunityId]);
    assert.deepEqual(await business.searchVisibleOpportunities({
      topicId: topic.id, actorUserId: owner.id, search: '%'
    }), []);
    await assert.rejects(linkDevelopmentOpportunity(business, outsider, topic.id, {
      opportunityId, reason: 'Not a member'
    }), (error) => error.statusCode === 404);
    await assert.rejects(linkDevelopmentOpportunity(business, owner, topic.id, {
      opportunityId: Number(privateOpportunity.rows[0].id), reason: 'Not visible'
    }), (error) => error.statusCode === 404);
    const link = await linkDevelopmentOpportunity(business, owner, topic.id, {
      opportunityId, reason: 'Idea originated in this customer request'
    });
    assert.equal(link.opportunityId, opportunityId);
    assert.equal((await getDevelopmentBusiness(business, owner, topic.id)).links.length, 1);
    assert.deepEqual(await listOpportunityDevelopmentLinks(business, outsider, opportunityId), []);

    const revision = await createDevelopmentOutcomeRevision(outcomes, owner, topic.id, {
      outcomeKind: 'technical_result', title: 'Pilot result', finding: 'Tested result',
      applicability: 'Pilot condition', limitations: 'Not production validated',
      evidenceReferences: ['Trial log 1']
    });
    const candidate = await proposeDevelopmentAssetCandidate(outcomes, owner,
      topic.id, revision.id, { rationale: 'Potential technical reuse' });
    await reviewDevelopmentAssetCandidate(outcomes, manager, topic.id, candidate.id, {
      decisionCode: 'endorsed', reason: 'Trial evidence checked'
    });
    const asset = await publishDevelopmentAsset(outcomes, manager, topic.id,
      candidate.id, { reason: 'Internal technical result only' });
    const requested = await requestDevelopmentCustomerUse(business, owner,
      topic.id, link.id, { assetId: asset.id,
        purpose: 'Technical paragraph in proposal 8001' });
    assert.equal(requested.assetId, asset.id);
    await assert.rejects(requestDevelopmentCustomerUse(business, owner,
      topic.id, link.id, { assetId: asset.id,
        purpose: 'Technical paragraph in proposal 8001' }),
    (error) => error.statusCode === 409);
    await assert.rejects(decideDevelopmentCustomerUse(business, owner,
      topic.id, requested.id, { decisionCode: 'approved', reason: 'Self approval' }),
    (error) => error.statusCode === 403);
    const decided = await decideDevelopmentCustomerUse(business, manager,
      topic.id, requested.id, { decisionCode: 'approved',
        reason: 'Permitted for stated proposal, not raw research' });
    assert.equal(decided.decisionCode, 'approved');
    const approvedLinks = await listOpportunityDevelopmentLinks(business, owner,
      opportunityId);
    assert.equal(approvedLinks[0].approvedUses, 1);
    assert.equal(approvedLinks[0].citations[0].outcomeRevisionId, revision.id);
    assert.equal(approvedLinks[0].citations[0].purpose,
      'Technical paragraph in proposal 8001');
    const content = Buffer.from(`Approved technical file ${suffix}`);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const originalName = `customer-technical-${suffix}.pdf`;
    const uploaded = await pool.query(`
      INSERT INTO attachments (opportunity_id, category, original_name, stored_path,
        mime_type, file_size, sha256, uploaded_by)
      VALUES ($1, 'technical_solution', $2, $3, 'application/pdf', $4, $5, $6)
      RETURNING id
    `, [opportunityId, originalName, `test/${originalName}`,
      content.length, sha256, owner.id]);
    const draft = await pool.query(`
      INSERT INTO opportunity_technical_drafts (
        opportunity_id, template_revision_id, draft_revision_no, status, language,
        template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
        content_schema_snapshot, variable_schema_snapshot, rendered_content,
        source_kind, deliverable_type, uploaded_attachment_id, formal_version_no,
        submitted_by, submitted_at, reviewed_by, reviewed_at, review_comment,
        created_by, updated_by
      ) VALUES ($1, NULL, 1, 'approved', 'en', 'UPLOADED', 'Customer file', 1,
        '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, 'uploaded_file',
        'technical_agreement', $2, 1, $3, now(), $4, now(), 'Approved file', $3, $3)
      RETURNING id
    `, [opportunityId, uploaded.rows[0].id, owner.id, manager.id]);
    const file = await pool.query(`
      INSERT INTO technical_solution_documents (
        technical_draft_id, document_no, format, original_name, mime_type,
        content, byte_size, sha256, generated_by
      ) VALUES ($1, 'TS-V1', 'pdf', $2, 'application/pdf', $3, $4, $5, $6)
      RETURNING id
    `, [draft.rows[0].id, originalName, content, content.length, sha256, owner.id]);
    const thread = await pool.query(`
      INSERT INTO email_threads (mailbox_key, subject, opportunity_id, last_message_at)
      VALUES ('sales@sunkaier.com', 'Customer proposal', $1, now()) RETURNING id
    `, [opportunityId]);
    async function outbound(status, hash = sha256,
      targetThreadId = thread.rows[0].id, withMime = true) {
      const message = await pool.query(`
        INSERT INTO email_messages (
          thread_id, direction, message_id, from_address, subject,
          delivery_status, sent_at, authored_by
        ) VALUES ($1, 'outbound', $2, 'sales@sunkaier.com', 'Customer proposal',
          $3, CASE WHEN $3 = 'sent' THEN now() ELSE NULL END, $4) RETURNING id
      `, [targetThreadId, `<npd-${randomUUID()}@sunkaier.com>`, status, owner.id]);
      const attachment = await pool.query(`
        INSERT INTO email_attachments (
          message_id, source_index, original_name, stored_path, mime_type,
          file_size, sha256, source_technical_document_id
        ) VALUES ($1, 0, $2, $3, 'application/pdf', $4, $5, $6) RETURNING id
      `, [message.rows[0].id, originalName, `email-outbound/${randomUUID()}.pdf`,
        content.length, hash, file.rows[0].id]);
      if (withMime) await pool.query(`
        INSERT INTO email_outbound_mime_artifacts (
          message_id, stored_path, file_size, sha256, rfc_message_id
        ) SELECT id, $2, 10, $3, message_id FROM email_messages WHERE id = $1
      `, [message.rows[0].id, `email-outbound/${randomUUID()}.eml`, 'b'.repeat(64)]);
      return { messageId: Number(message.rows[0].id),
        attachmentId: Number(attachment.rows[0].id) };
    }
    const draftEvidence = await outbound('draft');
    const missingArchiveEvidence = await outbound('sent', sha256, thread.rows[0].id, false);
    const wrongHashEvidence = await outbound('sent', 'c'.repeat(64));
    const otherThread = await pool.query(`
      INSERT INTO email_threads (mailbox_key, subject, opportunity_id, last_message_at)
      VALUES ('sales@sunkaier.com', 'Wrong opportunity', $1, now()) RETURNING id
    `, [Number(privateOpportunity.rows[0].id)]);
    const wrongOpportunityEvidence = await outbound('sent', sha256, otherThread.rows[0].id);
    const bindingInput = (item) => ({
      evidenceKey: `technical_solution:${file.rows[0].id}:${item.attachmentId}`,
      usageLocation: 'Page 2, equipment selection paragraph', contentConfirmed: true
    });
    for (const evidence of [draftEvidence, missingArchiveEvidence,
      wrongHashEvidence, wrongOpportunityEvidence]) {
      await assert.rejects(recordDevelopmentCustomerFileUse(business, owner,
        topic.id, requested.id, bindingInput(evidence)),
      (error) => error.statusCode === 409);
    }
    const sentEvidence = await outbound('sent');
    await assert.rejects(recordDevelopmentCustomerFileUse(business, outsider,
      topic.id, requested.id, bindingInput(sentEvidence)),
    (error) => error.statusCode === 404);
    const available = await business.listSentCustomerFiles({
      topicId: topic.id, actorUserId: owner.id
    });
    assert.ok(available.some((item) => item.emailAttachmentId === sentEvidence.attachmentId));
    assert.ok(!available.some((item) => item.emailAttachmentId === draftEvidence.attachmentId));
    assert.ok(!available.some((item) => item.emailAttachmentId === missingArchiveEvidence.attachmentId));
    assert.ok(!available.some((item) => item.emailAttachmentId === wrongHashEvidence.attachmentId));
    assert.ok(!available.some((item) => item.emailAttachmentId === wrongOpportunityEvidence.attachmentId));
    const use = await recordDevelopmentCustomerFileUse(business, owner,
      topic.id, requested.id, bindingInput(sentEvidence));
    assert.equal(use.sha256, sha256);
    assert.equal((await getDevelopmentBusiness(business, owner, topic.id))
      .requests.find((item) => item.id === requested.id).fileUses[0].emailAttachmentId,
    sentEvidence.attachmentId);
    await assert.rejects(recordDevelopmentCustomerFileUse(business, owner,
      topic.id, requested.id, bindingInput(sentEvidence)),
    (error) => error.statusCode === 409);
    await assert.rejects(pool.query(`
      UPDATE development_customer_file_uses SET usage_location = 'changed' WHERE id = $1
    `, [use.id]), /immutable|change/i);
    await assert.rejects(pool.query(`
      DELETE FROM email_attachments WHERE id = $1
    `, [sentEvidence.attachmentId]), /immutable|change|delete/i);
    await assert.rejects(pool.query(`
      UPDATE email_threads SET opportunity_id = $2 WHERE id = $1
    `, [thread.rows[0].id, privateOpportunity.rows[0].id]),
    /Bound customer email opportunity cannot be reassigned/);
    const commercial = await pool.query(`
      INSERT INTO commercial_quotes (opportunity_id, total_price, payment_terms,
        validity_date, submitted_by, version_no, status, reviewed_by, reviewed_at)
      VALUES ($1, 100, 'Advance', CURRENT_DATE + 30, $2, 1, 'approved', $3, now())
      RETURNING id
    `, [opportunityId, owner.id, manager.id]);
    const quotation = await pool.query(`
      INSERT INTO quotation_package_versions (
        opportunity_id, draft_revision_no, technical_solution_version_id,
        commercial_quote_id, currency, total_price, delivery_period,
        payment_terms, valid_until, created_by, updated_by
      ) VALUES ($1, 1, $2, $3, 'USD', 100, '30 days', 'Advance',
        CURRENT_DATE + 30, $4, $4) RETURNING id
    `, [opportunityId, draft.rows[0].id, commercial.rows[0].id, owner.id]);
    await pool.query(`
      INSERT INTO quotation_package_attachments (
        quotation_package_id, source_type, technical_solution_document_id,
        original_name, mime_type, byte_size, sha256
      ) VALUES ($1, 'technical_solution_document', $2, $3,
        'application/pdf', $4, $5)
    `, [quotation.rows[0].id, file.rows[0].id, originalName, content.length, sha256]);
    await pool.query(`
      UPDATE quotation_package_versions SET status = 'pending',
        submitted_by = $2, submitted_at = now(), updated_by = $2, updated_at = now()
      WHERE id = $1
    `, [quotation.rows[0].id, owner.id]);
    await pool.query(`
      UPDATE quotation_package_versions SET status = 'approved', version_no = 1,
        reviewed_by = $2, reviewed_at = now(), updated_by = $2, updated_at = now()
      WHERE id = $1
    `, [quotation.rows[0].id, manager.id]);
    const quoteMessage = await pool.query(`
      INSERT INTO email_messages (
        thread_id, direction, message_id, from_address, subject, delivery_status,
        sent_at, authored_by, quotation_package_version_id
      ) VALUES ($1, 'outbound', $2, 'sales@sunkaier.com', 'Formal quotation',
        'sent', now(), $3, $4) RETURNING id
    `, [thread.rows[0].id, `<npd-quote-${randomUUID()}@sunkaier.com>`,
      owner.id, quotation.rows[0].id]);
    const quoteAttachment = await pool.query(`
      INSERT INTO email_attachments (
        message_id, source_index, original_name, stored_path, mime_type,
        file_size, sha256
      ) VALUES ($1, 0, $2, $3, 'application/pdf', $4, $5) RETURNING id
    `, [quoteMessage.rows[0].id, originalName,
      `email-outbound/${randomUUID()}.pdf`, content.length, sha256]);
    await pool.query(`
      INSERT INTO email_outbound_mime_artifacts (
        message_id, stored_path, file_size, sha256, rfc_message_id
      ) SELECT id, $2, 10, $3, message_id FROM email_messages WHERE id = $1
    `, [quoteMessage.rows[0].id, `email-outbound/${randomUUID()}.eml`, 'b'.repeat(64)]);
    await pool.query(`
      UPDATE quotation_package_versions SET status = 'sent', sent_by = $2,
        sent_at = now(), sent_email_message_id = $3, updated_by = $2,
        updated_at = now() WHERE id = $1
    `, [quotation.rows[0].id, owner.id, quoteMessage.rows[0].id]);
    const quotedUse = await recordDevelopmentCustomerFileUse(business, owner,
      topic.id, requested.id, bindingInput({
        attachmentId: Number(quoteAttachment.rows[0].id)
      }));
    const formalUse = (await getDevelopmentBusiness(business, owner, topic.id))
      .requests.find((item) => item.id === requested.id)
      .fileUses.find((item) => item.id === quotedUse.id);
    assert.equal(formalUse.quotationPackageVersionId, Number(quotation.rows[0].id));
    await assert.rejects(pool.query(`
      UPDATE development_customer_use_decisions SET reason = 'rewritten' WHERE id = $1
    `, [decided.id]), /immutable|change/i);
    await assert.rejects(revokeDevelopmentCustomerUse(business, owner,
      topic.id, requested.id, { reason: 'Not a manager' }),
    (error) => error.statusCode === 403);
    await revokeDevelopmentCustomerUse(business, manager, topic.id,
      requested.id, { reason: 'Customer context changed' });
    assert.equal((await listOpportunityDevelopmentLinks(business, owner,
      opportunityId))[0].approvedUses, 0);
    assert.equal((await listOpportunityDevelopmentLinks(business, owner,
      opportunityId))[0].fileUses.length, 2);
    await assert.rejects(recordDevelopmentCustomerFileUse(business, owner,
      topic.id, requested.id, bindingInput(wrongHashEvidence)),
    (error) => error.statusCode === 409);
    const renewed = await requestDevelopmentCustomerUse(business, owner,
      topic.id, link.id, { assetId: asset.id,
        purpose: 'Technical paragraph in proposal 8001' });
    assert.notEqual(renewed.id, requested.id);
    await decideDevelopmentCustomerUse(business, manager,
      topic.id, renewed.id, { decisionCode: 'approved',
        reason: 'Same exact scope reconfirmed' });
    assert.equal((await listOpportunityDevelopmentLinks(business, owner,
      opportunityId))[0].approvedUses, 1);
    await assert.rejects(recordDevelopmentCustomerFileUse(business, owner,
      topic.id, renewed.id, bindingInput(sentEvidence)),
    (error) => error.statusCode === 409);
    const pending = await requestDevelopmentCustomerUse(business, owner,
      topic.id, link.id, { assetId: asset.id,
        purpose: 'A separate product presentation' });
    await withdrawDevelopmentAsset(outcomes, manager, topic.id, asset.id,
      { reason: 'New trial invalidated the result' });
    assert.equal((await listOpportunityDevelopmentLinks(business, owner,
      opportunityId))[0].approvedUses, 0);
    await assert.rejects(decideDevelopmentCustomerUse(business, manager,
      topic.id, pending.id, { decisionCode: 'approved', reason: 'Too late' }),
    (error) => error.statusCode === 409);
    await assert.rejects(requestDevelopmentCustomerUse(business, owner,
      topic.id, link.id, { assetId: asset.id,
        purpose: 'Another separate presentation' }),
    (error) => error.statusCode === 404);
    await assert.rejects(unlinkDevelopmentOpportunity(business, manager,
      topic.id, link.id), (error) => error.statusCode === 403);
    await unlinkDevelopmentOpportunity(business, owner, topic.id, link.id);
    assert.deepEqual(await listOpportunityDevelopmentLinks(business, owner, opportunityId), []);
  } finally {
    await pool.end();
  }
});
