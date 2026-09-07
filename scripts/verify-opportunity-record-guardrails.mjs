import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/db/migrate.mjs';
import { createCustomerRepository } from '../src/repositories/customerRepository.mjs';
import { createContactRepository } from '../src/repositories/contactRepository.mjs';
import { createOpportunityRepository } from '../src/repositories/opportunityRepository.mjs';
import { inspectCoreRecordForeignKeys } from '../src/domain/opportunityRecordGuardrails.mjs';

const databaseUrl = process.env.OPPORTUNITY_RECORD_GUARDRAILS_DB_TEST_URL;
if (!databaseUrl) {
  throw new Error('OPPORTUNITY_RECORD_GUARDRAILS_DB_TEST_URL is required');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_guardrail_test')) {
  throw new Error('Refusing to use a database whose name does not start with bestcrm_guardrail_test');
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function expectBlocked(client, savepoint, operation, expectedMessage) {
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    assert.fail(`Expected ${savepoint} to be blocked`);
  } catch (error) {
    assert.match(String(error.message), expectedMessage);
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
}

async function linkedRecordCounts(client, ids) {
  const checks = {
    customers: ['customers', 'id', ids.customerId],
    contacts: ['contacts', 'id', ids.contactId],
    opportunities: ['opportunities', 'id', ids.opportunityId],
    workflowEvents: ['workflow_events', 'opportunity_id', ids.opportunityId],
    emailThreads: ['email_threads', 'opportunity_id', ids.opportunityId],
    emailMessages: ['email_messages', 'thread_id', ids.emailThreadId],
    attachments: ['attachments', 'opportunity_id', ids.opportunityId],
    requirementUpdates: ['requirement_updates', 'opportunity_id', ids.opportunityId],
    technicalSolutions: ['technical_solutions', 'opportunity_id', ids.opportunityId],
    commercialQuotes: ['commercial_quotes', 'opportunity_id', ids.opportunityId],
    salesWorkLogs: ['sales_work_logs', 'opportunity_id', ids.opportunityId],
    salesWorkPlans: ['sales_work_plans', 'opportunity_id', ids.opportunityId]
  };
  const counts = {};
  for (const [key, [table, column, id]] of Object.entries(checks)) {
    const result = await client.query(`SELECT count(*)::integer AS count FROM ${table} WHERE ${column} = $1`, [id]);
    counts[key] = result.rows[0].count;
  }
  return counts;
}

async function verify() {
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uniqueSuffix = `${Date.now()}-${process.pid}`;
    const user = await client.query(`
      INSERT INTO users (username, password_hash, display_name, email)
      VALUES ($1, 'not-a-real-password-hash', 'Guardrail verifier', $2)
      RETURNING id
    `, [`guardrail-${uniqueSuffix}`, `guardrail-${uniqueSuffix}@example.invalid`]);
    const actorUserId = Number(user.rows[0].id);

    const customer = await client.query(`
      INSERT INTO customers (name, industry, country, owner_user_id, notes)
      VALUES ($1, 'Chemical', 'Singapore', $2, 'Durability verification fixture')
      RETURNING id, record_uid
    `, [`Guardrail Customer ${uniqueSuffix}`, actorUserId]);
    const customerId = Number(customer.rows[0].id);

    const contact = await client.query(`
      INSERT INTO contacts (customer_id, name, title, email, notes)
      VALUES ($1, 'Guardrail Contact', 'Project Manager', $2, 'Durability verification fixture')
      RETURNING id, record_uid
    `, [customerId, `contact-${uniqueSuffix}@example.invalid`]);
    const contactId = Number(contact.rows[0].id);

    const opportunity = await client.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, primary_contact_id, requirement,
        product_interest, project_type, status, salesperson_id
      ) VALUES ($1, 'Guardrail Opportunity', $2, $3, 'Preserve the complete business thread',
        'Industrial mixer', 'new_build', 'draft', $4)
      RETURNING id, record_uid
    `, [`GR-${uniqueSuffix}`, customerId, contactId, actorUserId]);
    const opportunityId = Number(opportunity.rows[0].id);

    await client.query(`
      INSERT INTO workflow_events (opportunity_id, event_type, from_status, to_status, actor_user_id, comment)
      VALUES ($1, 'guardrail_fixture', NULL, 'draft', $2, 'Architecture verification')
    `, [opportunityId, actorUserId]);

    const emailThread = await client.query(`
      INSERT INTO email_threads (
        mailbox_key, subject, normalized_subject, opportunity_id, customer_id, contact_id, last_message_at
      ) VALUES ('sales@example.invalid', 'Guardrail discussion', 'guardrail discussion', $1, $2, $3, now())
      RETURNING id
    `, [opportunityId, customerId, contactId]);
    const emailThreadId = Number(emailThread.rows[0].id);
    const emailMessage = await client.query(`
      INSERT INTO email_messages (
        thread_id, direction, message_id, from_address, to_recipients, subject,
        text_body, delivery_status, received_at
      ) VALUES ($1, 'inbound', $2, 'customer@example.invalid', '["sales@example.invalid"]'::jsonb,
        'Guardrail discussion', 'Original immutable message', 'received', now())
      RETURNING id
    `, [emailThreadId, `<guardrail-${uniqueSuffix}@example.invalid>`]);
    const emailMessageId = Number(emailMessage.rows[0].id);

    await client.query(`
      INSERT INTO attachments (
        opportunity_id, category, original_name, stored_path, mime_type, file_size, uploaded_by
      ) VALUES ($1, 'requirement', 'guardrail.txt', $2, 'text/plain', 16, $3)
    `, [opportunityId, `guardrail/${uniqueSuffix}/guardrail.txt`, actorUserId]);
    await client.query(`
      INSERT INTO requirement_updates (opportunity_id, requirement_text, reason, created_by)
      VALUES ($1, 'Revised durable requirement', 'Customer clarification', $2)
    `, [opportunityId, actorUserId]);
    await client.query(`
      INSERT INTO technical_solutions (opportunity_id, summary, parameters, implementation_plan, submitted_by)
      VALUES ($1, 'Guardrail technical solution', 'Verified parameters', 'Verified plan', $2)
    `, [opportunityId, actorUserId]);
    await client.query(`
      INSERT INTO commercial_quotes (opportunity_id, total_price, payment_terms, remarks, submitted_by)
      VALUES ($1, 125000, '30 percent deposit', 'Guardrail quote', $2)
    `, [opportunityId, actorUserId]);
    await client.query(`
      INSERT INTO sales_work_logs (
        salesperson_user_id, log_date, customer_id, contact_id, opportunity_id,
        activity_type, subject, content
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, 'meeting', 'Guardrail meeting', 'Meeting record preserved')
    `, [actorUserId, customerId, contactId, opportunityId]);
    await client.query(`
      INSERT INTO sales_work_plans (
        salesperson_user_id, plan_date, customer_id, contact_id, opportunity_id,
        activity_type, subject, objective
      ) VALUES ($1, CURRENT_DATE, $2, $3, $4, 'email', 'Guardrail follow-up', 'Confirm next step')
    `, [actorUserId, customerId, contactId, opportunityId]);

    const ids = { customerId, contactId, opportunityId, emailThreadId };
    const beforeCounts = await linkedRecordCounts(client, ids);
    assert.deepEqual(beforeCounts, {
      customers: 1,
      contacts: 1,
      opportunities: 1,
      workflowEvents: 1,
      emailThreads: 1,
      emailMessages: 1,
      attachments: 1,
      requirementUpdates: 1,
      technicalSolutions: 1,
      commercialQuotes: 1,
      salesWorkLogs: 1,
      salesWorkPlans: 1
    });

    const customerRepository = createCustomerRepository(client);
    const contactRepository = createContactRepository(client);
    const opportunityRepository = createOpportunityRepository(client);
    assert.ok(await customerRepository.archiveById(customerId, { actorUserId, reason: 'Guardrail archive test' }));
    assert.ok(await contactRepository.archiveById(contactId, { actorUserId, reason: 'Guardrail archive test' }));
    assert.ok(await opportunityRepository.archiveById(opportunityId, { actorUserId, reason: 'Guardrail archive test' }));

    const archivedRows = await client.query(`
      SELECT
        (SELECT archived_at IS NOT NULL FROM customers WHERE id = $1) AS customer_archived,
        (SELECT archived_at IS NOT NULL FROM contacts WHERE id = $2) AS contact_archived,
        (SELECT archived_at IS NOT NULL FROM opportunities WHERE id = $3) AS opportunity_archived
    `, [customerId, contactId, opportunityId]);
    assert.deepEqual(archivedRows.rows[0], {
      customer_archived: true,
      contact_archived: true,
      opportunity_archived: true
    });

    assert.ok(await customerRepository.reopenById(customerId, { actorUserId, reason: 'Guardrail reopen test' }));
    assert.ok(await contactRepository.reopenById(contactId, { actorUserId, reason: 'Guardrail reopen test' }));
    assert.ok(await opportunityRepository.reopenById(opportunityId, { actorUserId, reason: 'Guardrail reopen test' }));

    const uidRows = await client.query(`
      SELECT
        (SELECT record_uid FROM customers WHERE id = $1) AS customer_uid,
        (SELECT record_uid FROM contacts WHERE id = $2) AS contact_uid,
        (SELECT record_uid FROM opportunities WHERE id = $3) AS opportunity_uid
    `, [customerId, contactId, opportunityId]);
    assert.equal(uidRows.rows[0].customer_uid, customer.rows[0].record_uid);
    assert.equal(uidRows.rows[0].contact_uid, contact.rows[0].record_uid);
    assert.equal(uidRows.rows[0].opportunity_uid, opportunity.rows[0].record_uid);

    const afterCounts = await linkedRecordCounts(client, ids);
    assert.deepEqual(afterCounts, beforeCounts);

    await expectBlocked(client, 'delete_customer_blocked', () => client.query('DELETE FROM customers WHERE id = $1', [customerId]), /cannot be deleted/i);
    await expectBlocked(client, 'delete_contact_blocked', () => client.query('DELETE FROM contacts WHERE id = $1', [contactId]), /cannot be deleted/i);
    await expectBlocked(client, 'delete_opportunity_blocked', () => client.query('DELETE FROM opportunities WHERE id = $1', [opportunityId]), /cannot be deleted/i);
    await expectBlocked(client, 'customer_uid_blocked', () => client.query('UPDATE customers SET record_uid = gen_random_uuid() WHERE id = $1', [customerId]), /UID cannot be changed/i);
    await expectBlocked(client, 'contact_uid_blocked', () => client.query('UPDATE contacts SET record_uid = gen_random_uuid() WHERE id = $1', [contactId]), /UID cannot be changed/i);
    await expectBlocked(client, 'opportunity_uid_blocked', () => client.query('UPDATE opportunities SET record_uid = gen_random_uuid() WHERE id = $1', [opportunityId]), /UID cannot be changed/i);
    await expectBlocked(client, 'email_update_blocked', () => client.query("UPDATE email_messages SET subject = 'Changed' WHERE id = $1", [emailMessageId]), /immutable/i);
    await expectBlocked(client, 'email_delete_blocked', () => client.query('DELETE FROM email_messages WHERE id = $1', [emailMessageId]), /cannot be deleted/i);

    const lifecycleEvents = await client.query(`
      SELECT record_type, event_type, count(*)::integer AS count
      FROM record_lifecycle_events
      WHERE record_id IN ($1, $2, $3)
      GROUP BY record_type, event_type
      ORDER BY record_type, event_type
    `, [customerId, contactId, opportunityId]);
    assert.equal(lifecycleEvents.rowCount, 6);
    assert.ok(lifecycleEvents.rows.every((row) => row.count === 1));
    await expectBlocked(client, 'lifecycle_update_blocked', () => client.query(`
      UPDATE record_lifecycle_events SET reason = 'Changed' WHERE record_type = 'opportunity' AND record_id = $1
    `, [opportunityId]), /append-only/i);

    const foreignKeys = await client.query(`
      SELECT con.conname, con.confdeltype
      FROM pg_constraint con
      JOIN pg_class parent_table ON parent_table.oid = con.confrelid
      JOIN pg_namespace child_namespace ON child_namespace.oid = con.connamespace
      WHERE con.contype = 'f'
        AND child_namespace.nspname = 'public'
        AND parent_table.relname IN ('customers', 'contacts', 'opportunities')
      ORDER BY con.conname
    `);
    const foreignKeyInspection = inspectCoreRecordForeignKeys(foreignKeys.rows);
    assert.deepEqual(foreignKeyInspection.missingRequired, []);
    assert.deepEqual(foreignKeyInspection.unsafeDeleteActions, []);

    console.log(JSON.stringify({
      database: databaseName,
      coreRecords: 3,
      stableRecordUids: 3,
      lifecycleEvents: 6,
      protectedCoreForeignKeys: foreignKeyInspection.total,
      preservedLinkedRecords: Object.values(afterCounts).reduce((total, count) => total + count, 0),
      directDeletesBlocked: 3,
      uidChangesBlocked: 3,
      emailArchiveMutationsBlocked: 2,
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
