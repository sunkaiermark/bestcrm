import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/db/migrate.mjs';
import { OPPORTUNITY_ACTIVITY_SOURCES } from '../src/domain/opportunityActivitySources.mjs';
import { runOpportunityActivityBackfillBatch } from '../src/services/opportunityActivityBackfill.mjs';

const databaseUrl = process.env.OPPORTUNITY_ACTIVITY_DB_TEST_URL;
if (!databaseUrl) throw new Error('OPPORTUNITY_ACTIVITY_DB_TEST_URL is required');

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_activity_test')) {
  throw new Error('Refusing to use a database whose name does not start with bestcrm_activity_test');
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function expectBlocked(client, savepoint, operation, message) {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    assert.fail(`Expected ${savepoint} to be blocked`);
  } catch (error) {
    assert.match(String(error.message), message);
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
}

function savepointAdapter(client, name) {
  return {
    async query(sql, params) {
      if (sql === 'BEGIN') return client.query(`SAVEPOINT ${name}`);
      if (sql === 'COMMIT') return client.query(`RELEASE SAVEPOINT ${name}`);
      if (sql === 'ROLLBACK') return client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      return client.query(sql, params);
    }
  };
}

async function sourceIntegrity(client, opportunityId) {
  const results = [];
  for (const source of OPPORTUNITY_ACTIVITY_SOURCES) {
    const result = await client.query(`
      WITH eligible AS (
        SELECT source.id, ${source.opportunitySql} AS opportunity_id
        FROM ${source.table} source
        WHERE ${source.eligibleSql}
          AND ${source.opportunitySql} = $1
      )
      SELECT
        count(*)::integer AS source_count,
        count(link.id)::integer AS linked_count,
        count(DISTINCT link.id)::integer AS distinct_link_count,
        count(*) FILTER (WHERE activity.opportunity_id IS DISTINCT FROM eligible.opportunity_id)::integer AS mismatch_count
      FROM eligible
      LEFT JOIN opportunity_activity_links link
        ON link.${source.linkColumn} = eligible.id AND link.link_role = 'primary'
      LEFT JOIN opportunity_activities activity ON activity.id = link.activity_id
    `, [opportunityId]);
    results.push({ sourceCode: source.code, ...result.rows[0] });
  }
  return results;
}

async function verify() {
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const suffix = `${Date.now()}-${process.pid}`;
    const users = await client.query(`
      INSERT INTO users (username, password_hash, display_name, email)
      VALUES
        ($1, 'not-a-password', 'Activity verifier', $2),
        ($3, 'not-a-password', 'Activity owner', $4)
      RETURNING id
    `, [
      `activity-${suffix}`, `activity-${suffix}@example.invalid`,
      `activity-owner-${suffix}`, `activity-owner-${suffix}@example.invalid`
    ]);
    const actorId = Number(users.rows[0].id);
    const ownerId = Number(users.rows[1].id);

    const customer = await client.query(`
      INSERT INTO customers (name, industry, country, owner_user_id)
      VALUES ($1, 'Chemical', 'Singapore', $2) RETURNING id
    `, [`Activity Customer ${suffix}`, actorId]);
    const customerId = Number(customer.rows[0].id);
    const contact = await client.query(`
      INSERT INTO contacts (customer_id, name, title, phone, email)
      VALUES ($1, 'Activity Contact', 'Project Manager', '+65 6000 0000', $2)
      RETURNING id
    `, [customerId, `contact-${suffix}@example.invalid`]);
    const contactId = Number(contact.rows[0].id);
    const opportunity = await client.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, primary_contact_id, requirement,
        product_interest, project_type, status, salesperson_id
      ) VALUES ($1, 'Activity spine verification', $2, $3, 'Durable opportunity history',
        'Industrial mixer', 'new_build', 'draft', $4)
      RETURNING id
    `, [`AS-${suffix}`, customerId, contactId, actorId]);
    const opportunityId = Number(opportunity.rows[0].id);

    const contactHistory = await client.query(`
      SELECT * FROM opportunity_contacts
      WHERE opportunity_id = $1 AND contact_id = $2 AND is_primary AND valid_to IS NULL
    `, [opportunityId, contactId]);
    assert.equal(contactHistory.rowCount, 1);
    assert.equal(contactHistory.rows[0].contact_email_snapshot, `contact-${suffix}@example.invalid`);

    await client.query(`
      INSERT INTO workflow_events (opportunity_id, event_type, from_status, to_status, actor_user_id, target_user_id, comment)
      VALUES ($1, 'technical_review', 'draft', 'technical_review', $2, $3, 'Review requested')
    `, [opportunityId, actorId, ownerId]);

    const delayedThread = await client.query(`
      INSERT INTO email_threads (
        mailbox_key, subject, normalized_subject, customer_id, contact_id, last_message_at
      ) VALUES ('sales@example.invalid', 'Delayed opportunity link', 'delayed opportunity link', $1, $2, now())
      RETURNING id
    `, [customerId, contactId]);
    const delayedMessage = await client.query(`
      INSERT INTO email_messages (
        thread_id, direction, message_id, from_address, to_recipients, subject,
        text_body, delivery_status, received_at, raw_eml_stored_path,
        raw_eml_file_size, raw_eml_sha256, imported_at
      ) VALUES ($1, 'inbound', $2, $3, '["sales@example.invalid"]'::jsonb,
        'Delayed opportunity link', 'Body stays in the email archive only', 'received', now(),
        $4, 128, repeat('a', 64), now())
      RETURNING id
    `, [
      delayedThread.rows[0].id,
      `<activity-${suffix}@example.invalid>`,
      `contact-${suffix}@example.invalid`,
      `email-archive/${suffix}.eml`
    ]);
    const emailMessageId = Number(delayedMessage.rows[0].id);
    const beforeEmailLink = await client.query('SELECT 1 FROM opportunity_activity_links WHERE email_message_id = $1', [emailMessageId]);
    assert.equal(beforeEmailLink.rowCount, 0);
    await client.query('UPDATE email_threads SET opportunity_id = $1 WHERE id = $2', [opportunityId, delayedThread.rows[0].id]);

    await client.query(`
      INSERT INTO sales_work_plans (
        salesperson_user_id, plan_date, customer_id, contact_id, opportunity_id,
        activity_type, subject, objective
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, 'call', 'Confirm process data', 'Schedule review')
    `, [actorId, customerId, contactId, opportunityId]);
    await client.query(`
      INSERT INTO sales_work_logs (
        salesperson_user_id, log_date, customer_id, contact_id, opportunity_id,
        activity_type, subject, content, result
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, 'meeting', 'Process review',
        'Detailed meeting record stays in the source table', 'Technical action agreed')
    `, [actorId, customerId, contactId, opportunityId]);
    const unlinkedPlan = await client.query(`
      INSERT INTO sales_work_plans (
        salesperson_user_id, plan_date, customer_id, contact_id, activity_type, subject, objective
      ) VALUES ($1, CURRENT_DATE, $2, $3, 'other', 'Unlinked plan', 'Must not enter opportunity timeline')
      RETURNING id
    `, [actorId, customerId, contactId]);

    const attachment = await client.query(`
      INSERT INTO attachments (
        opportunity_id, category, original_name, stored_path, mime_type, file_size, uploaded_by
      ) VALUES ($1, 'requirement', 'process-data.pdf', $2, 'application/pdf', 2048, $3)
      RETURNING id
    `, [opportunityId, `opportunity/${suffix}/process-data.pdf`, actorId]);

    await client.query(`
      INSERT INTO technical_solutions (
        opportunity_id, summary, parameters, implementation_plan, submitted_by, status, reviewed_by, reviewed_at
      ) VALUES ($1, 'Verified technical solution', 'Capacity 10 m3', 'Manufacture and test', $2, 'approved', $2, now())
    `, [opportunityId, actorId]);
    const quote = await client.query(`
      INSERT INTO commercial_quotes (
        opportunity_id, total_price, payment_terms, validity_date, remarks,
        submitted_by, status, reviewed_by, reviewed_at
      ) VALUES ($1, 125000, '30 percent deposit', CURRENT_DATE + 30, 'Verified quote',
        $2, 'approved', $2, now())
      RETURNING id
    `, [opportunityId, actorId]);

    const template = await client.query(`
      INSERT INTO technical_agreement_templates (
        template_code, name, product_family, language, created_by, updated_by
      ) VALUES ($1, 'Activity template', 'Mixer', 'en', $2, $2)
      RETURNING id
    `, [`ACT-${Date.now()}`, actorId]);
    const revision = await client.query(`
      INSERT INTO technical_agreement_template_revisions (
        template_id, revision_no, status, change_summary, created_by,
        submitted_by, submitted_at, published_by, published_at
      ) VALUES ($1, 1, 'published', 'Verification revision', $2, $2, now(), $2, now())
      RETURNING id
    `, [template.rows[0].id, actorId]);
    await client.query(`
      UPDATE technical_agreement_templates
      SET current_published_revision_id = $1, updated_by = $2
      WHERE id = $3
    `, [revision.rows[0].id, actorId, template.rows[0].id]);
    const technicalDraft = await client.query(`
      INSERT INTO opportunity_technical_drafts (
        opportunity_id, template_revision_id, draft_revision_no, status, language,
        template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
        content_schema_snapshot, variable_schema_snapshot, rendered_content,
        created_by, updated_by, formal_version_no, reviewed_by, reviewed_at
      ) VALUES ($1, $2, 1, 'approved', 'en', $3, 'Activity template', 1,
        '{"schemaVersion":1,"sections":[]}'::jsonb, '[]'::jsonb,
        '{"sections":[]}'::jsonb, $4, $4, 1, $4, now())
      RETURNING id
    `, [opportunityId, revision.rows[0].id, `ACT-${Date.now()}`, actorId]);
    const packageVersion = await client.query(`
      INSERT INTO quotation_package_versions (
        opportunity_id, draft_revision_no, version_no, status, technical_solution_version_id,
        commercial_quote_id, currency, total_price, delivery_period, payment_terms,
        valid_until, created_by, updated_by, submitted_by, submitted_at,
        reviewed_by, reviewed_at, sent_by, sent_at, accepted_by, accepted_at
      ) VALUES ($1, 1, 1, 'accepted', $2, $3, 'USD', 125000,
        '16 weeks', '30 percent deposit', CURRENT_DATE + 30, $4, $4,
        $4, now(), $5, now(), $4, now(), $4, now())
      RETURNING id
    `, [opportunityId, technicalDraft.rows[0].id, quote.rows[0].id, actorId, ownerId]);
    await client.query(`
      INSERT INTO contract_approvals (
        opportunity_id, status, submitted_by, version_no, quotation_package_version_id
      ) VALUES ($1, 'pending', $2, 1, $3)
    `, [opportunityId, actorId, packageVersion.rows[0].id]);

    await client.query(`
      INSERT INTO opportunity_owner_transfers (
        opportunity_id, from_owner_user_id, to_owner_user_id, changed_by, reason
      ) VALUES ($1, $2, $3, $2, 'Verification transfer')
    `, [opportunityId, actorId, ownerId]);
    await client.query(`
      INSERT INTO opportunity_member_events (
        opportunity_id, user_id, event_type, role_code, permission_level,
        task_description, actor_user_id
      ) VALUES ($1, $2, 'assigned', 'project_engineer', 'edit', 'Prepare technical response', $3)
    `, [opportunityId, ownerId, actorId]);
    await client.query(`
      INSERT INTO opportunity_engineering_contributions (
        opportunity_id, contributor_user_id, contribution_summary, created_by
      ) VALUES ($1, $2, 'Checked process parameters', $3)
    `, [opportunityId, ownerId, actorId]);

    const unlinkedActivity = await client.query(`
      SELECT 1 FROM opportunity_activity_links WHERE sales_work_plan_id = $1
    `, [unlinkedPlan.rows[0].id]);
    assert.equal(unlinkedActivity.rowCount, 0);

    const integrity = await sourceIntegrity(client, opportunityId);
    assert.equal(integrity.length, OPPORTUNITY_ACTIVITY_SOURCES.length);
    assert.ok(integrity.every((row) => row.source_count === 1), JSON.stringify(integrity));
    assert.ok(integrity.every((row) => row.linked_count === 1 && row.distinct_link_count === 1));
    assert.ok(integrity.every((row) => row.mismatch_count === 0));

    await client.query(`
      UPDATE sales_work_plans SET opportunity_id = $1 WHERE id = $2
    `, [opportunityId, unlinkedPlan.rows[0].id]);
    const linkedLaterActivity = await client.query(`
      SELECT activity.id
      FROM opportunity_activity_links link
      JOIN opportunity_activities activity ON activity.id = link.activity_id
      WHERE link.sales_work_plan_id = $1 AND activity.opportunity_id = $2
    `, [unlinkedPlan.rows[0].id, opportunityId]);
    assert.equal(linkedLaterActivity.rowCount, 1);
    await expectBlocked(client, 'indexed_source_unlink_blocked', () => client.query(`
      UPDATE sales_work_plans SET opportunity_id = NULL WHERE id = $1
    `, [unlinkedPlan.rows[0].id]), /cannot be moved to or unlinked/i);

    const beforeRepeat = await client.query('SELECT count(*)::integer AS count FROM opportunity_activities WHERE opportunity_id = $1', [opportunityId]);
    for (const source of OPPORTUNITY_ACTIVITY_SOURCES) {
      const sourceId = await client.query(`
        SELECT source.id FROM ${source.table} source
        WHERE ${source.eligibleSql} AND ${source.opportunitySql} = $1
        ORDER BY source.id DESC LIMIT 1
      `, [opportunityId]);
      await client.query('SELECT bestcrm_index_activity_source($1, $2)', [source.code, sourceId.rows[0].id]);
    }
    const afterRepeat = await client.query('SELECT count(*)::integer AS count FROM opportunity_activities WHERE opportunity_id = $1', [opportunityId]);
    assert.equal(afterRepeat.rows[0].count, beforeRepeat.rows[0].count);

    const backfill = await runOpportunityActivityBackfillBatch(
      savepointAdapter(client, 'backfill_workflow'),
      { sourceCode: 'workflow_events', batchSize: 1000 }
    );
    assert.ok(backfill.scanned >= 1);
    const afterBackfill = await client.query('SELECT count(*)::integer AS count FROM opportunity_activities WHERE opportunity_id = $1', [opportunityId]);
    assert.equal(afterBackfill.rows[0].count, beforeRepeat.rows[0].count);

    const emailSnapshot = await client.query(`
      SELECT activity.snapshot, message.raw_eml_sha256
      FROM opportunity_activity_links link
      JOIN opportunity_activities activity ON activity.id = link.activity_id
      JOIN email_messages message ON message.id = link.email_message_id
      WHERE link.email_message_id = $1
    `, [emailMessageId]);
    assert.equal(emailSnapshot.rows[0].snapshot.rawEmlSha256, emailSnapshot.rows[0].raw_eml_sha256);
    assert.equal(Object.hasOwn(emailSnapshot.rows[0].snapshot, 'textBody'), false);
    assert.equal(Object.hasOwn(emailSnapshot.rows[0].snapshot, 'htmlBody'), false);

    const fileSnapshot = await client.query(`
      SELECT activity.snapshot, source.stored_path, source.file_size
      FROM opportunity_activity_links link
      JOIN opportunity_activities activity ON activity.id = link.activity_id
      JOIN attachments source ON source.id = link.attachment_id
      WHERE source.id = $1
    `, [attachment.rows[0].id]);
    assert.equal(fileSnapshot.rows[0].snapshot.storedPath, fileSnapshot.rows[0].stored_path);
    assert.equal(Number(fileSnapshot.rows[0].snapshot.fileSize), Number(fileSnapshot.rows[0].file_size));

    const activityId = (await client.query(`
      SELECT id FROM opportunity_activities WHERE opportunity_id = $1 ORDER BY recorded_at LIMIT 1
    `, [opportunityId])).rows[0].id;
    await expectBlocked(client, 'activity_update_blocked', () => client.query(
      "UPDATE opportunity_activities SET subject = 'Changed' WHERE id = $1", [activityId]
    ), /append-only/i);
    await expectBlocked(client, 'activity_delete_blocked', () => client.query(
      'DELETE FROM opportunity_activities WHERE id = $1', [activityId]
    ), /append-only/i);
    await expectBlocked(client, 'link_update_blocked', () => client.query(
      "UPDATE opportunity_activity_links SET link_role = 'related' WHERE activity_id = $1", [activityId]
    ), /append-only/i);
    await expectBlocked(client, 'participant_delete_blocked', () => client.query(`
      DELETE FROM opportunity_activity_participants
      WHERE activity_id = $1 AND id = (
        SELECT min(id) FROM opportunity_activity_participants WHERE activity_id = $1
      )
    `, [activityId]), /append-only/i);
    await expectBlocked(client, 'contact_history_delete_blocked', () => client.query(
      'DELETE FROM opportunity_contacts WHERE opportunity_id = $1', [opportunityId]
    ), /cannot be deleted/i);
    await expectBlocked(client, 'empty_link_blocked', () => client.query(
      'INSERT INTO opportunity_activity_links (activity_id, link_role) VALUES ($1, \'related\')', [activityId]
    ), /one_source_check/i);
    await expectBlocked(client, 'multiple_link_blocked', () => client.query(`
      INSERT INTO opportunity_activity_links (
        activity_id, link_role, email_message_id, attachment_id
      ) VALUES ($1, 'related', $2, $3)
    `, [activityId, emailMessageId, attachment.rows[0].id]), /one_source_check/i);

    console.log(JSON.stringify({
      database: databaseName,
      coveredSources: integrity.length,
      sourceRows: integrity.reduce((sum, row) => sum + row.source_count, 0),
      activityRows: beforeRepeat.rows[0].count,
      delayedEmailIndexed: true,
      laterOpportunityLinkIndexed: true,
      idempotentReindex: true,
      resumableBackfill: true,
      appendOnlyMutationsBlocked: 6,
      invalidTypedLinksBlocked: 2,
      result: 'passed'
    }, null, 2));

    await client.query('ROLLBACK');
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
