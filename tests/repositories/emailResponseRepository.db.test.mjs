import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createEmailResponseRepository } from '../../src/repositories/emailResponseRepository.mjs';
import { createNotificationRepository } from '../../src/repositories/notificationRepository.mjs';

const connectionString = process.env.EMAIL_RESPONSE_TEST_DATABASE_URL;

test('email receipt, exact-recipient reply clock, assignment push, and eight-hour deduplicated alerts', {
  skip: !connectionString && 'Set EMAIL_RESPONSE_TEST_DATABASE_URL to an isolated migrated test database'
}, async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('BEGIN');
  try {
    const suffix = randomUUID().slice(0, 8);
    const addUser = async (name) => {
      const result = await client.query(`
        INSERT INTO users (username, password_hash, display_name, email)
        VALUES ($1, 'test-only', $1, $2) RETURNING id
      `, [`email_response_${name}_${suffix}`, `${name}_${suffix}@example.com`]);
      return Number(result.rows[0].id);
    };
    const ownerId = await addUser('owner');
    const managerId = await addUser('manager');
    const adminId = await addUser('admin');
    for (const [code, userId] of [['sales_manager', managerId], ['administrator', adminId]]) {
      const role = await client.query('INSERT INTO roles (code, name) VALUES ($1, $1) RETURNING id', [code]);
      await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [userId, role.rows[0].id]);
    }
    const customer = await client.query(
      `INSERT INTO customers (name, owner_user_id) VALUES ($1, $2) RETURNING id`,
      [`Customer ${suffix}`, ownerId]
    );
    const opportunity = await client.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, requirement, status, salesperson_id, sales_manager_id
      ) VALUES ($1, 'Test opportunity', $2, 'Test requirement', 'active', $3, $4) RETURNING id
    `, [`TEST-${suffix}`, customer.rows[0].id, ownerId, managerId]);
    const opportunityId = Number(opportunity.rows[0].id);
    const activation = await client.query(
      "SELECT applied_at FROM schema_migrations WHERE name = '105_email_reply_accountability.sql'"
    );
    assert.equal(activation.rowCount, 1);
    const receivedAt = new Date(new Date(activation.rows[0].applied_at).getTime() + 60_000);
    const beforeDueAt = new Date(receivedAt.getTime() + 7 * 3_600_000);
    const at = new Date(receivedAt.getTime() + 9 * 3_600_000);
    const dueAt = new Date(receivedAt.getTime() + 8 * 3_600_000);
    const linked = await client.query(`
      INSERT INTO email_threads (
        mailbox_key, subject, last_message_at, opportunity_id, triage_status
      ) VALUES ('sales@sunkaier.com', 'RFQ', $1, $2, 'linked_opportunity') RETURNING id
    `, [receivedAt, opportunityId]);
    const threadId = Number(linked.rows[0].id);
    const addInbound = async (targetThreadId, sender, timestamp = receivedAt) => {
      const row = await client.query(`
        INSERT INTO email_messages (
          thread_id, direction, from_address, delivery_status, received_at,
          mailbox_received_at, created_at, classification_category
        ) VALUES ($1, 'inbound', $2, 'received', $3, $3, $3, 'inquiry') RETURNING id
      `, [targetThreadId, sender, timestamp]);
      return Number(row.rows[0].id);
    };
    const firstId = await addInbound(threadId, 'buyer@example.com');
    const secondId = await addInbound(threadId, 'other@example.com');
    const legacyId = await addInbound(
      threadId, 'legacy@example.com', new Date(new Date(activation.rows[0].applied_at).getTime() - 3_600_000)
    );
    const response = createEmailResponseRepository(client);
    const notifications = createNotificationRepository(client);

    const confirmation = await response.acknowledge(firstId, ownerId, at);
    assert.equal(confirmation.confirmedBy, ownerId);
    assert.equal((await response.acknowledge(firstId, ownerId, at)).confirmedBy, ownerId);
    assert.equal(await response.acknowledge(secondId, managerId, at), null);

    const assignment = await response.notifyOpportunityAssignment({ threadId, opportunityId, actorUserId: adminId });
    assert.equal(assignment.created, 1);
    assert.equal(assignment.queued_push, 1);
    assert.equal((await response.notifyOpportunityAssignment({ threadId, opportunityId, actorUserId: adminId })).created, 0);

    await client.query(`
      INSERT INTO email_messages (
        thread_id, direction, from_address, to_recipients, delivery_status, sent_at, created_at
      ) VALUES ($1, 'outbound', 'sales@sunkaier.com', $2::jsonb, 'sent', $3, $3)
    `, [threadId, JSON.stringify([{ address: 'other@example.com' }]), new Date(receivedAt.getTime() + 2 * 3_600_000)]);
    const beforeDueStates = await response.listThreadStates(threadId, ownerId, beforeDueAt);
    assert.equal(beforeDueStates.find((state) => state.messageId === firstId).overdue, false);
    assert.equal((await response.queueDueLinkedReminders(beforeDueAt)).created, 0);
    const states = await response.listThreadStates(threadId, ownerId, at);
    assert.equal(states.length, 3);
    const firstState = states.find((state) => state.messageId === firstId);
    const secondState = states.find((state) => state.messageId === secondId);
    const legacyState = states.find((state) => state.messageId === legacyId);
    assert.equal(firstState.tracked, true);
    assert.equal(firstState.overdue, true);
    assert.equal(firstState.confirmedBy, ownerId);
    assert.equal(new Date(firstState.dueAt).getTime(), dueAt.getTime());
    assert.equal(secondState.overdue, false);
    assert.ok(secondState.repliedAt);
    assert.equal(legacyState.tracked, false);

    const overdue = await response.queueDueLinkedReminders(at);
    assert.equal(overdue.created, 2);
    assert.equal(overdue.queued_sms, 2);
    assert.equal((await response.queueDueLinkedReminders(at)).created, 0);
    const recipients = await client.query(`
      SELECT user_id FROM notifications
      WHERE source_type = 'email_reply_overdue' AND source_id = $1 ORDER BY user_id
    `, [firstId]);
    assert.deepEqual(recipients.rows.map((row) => Number(row.user_id)), [ownerId, managerId].sort((a, b) => a - b));
    const legacyNotifications = await client.query(`
      SELECT count(*)::integer AS count FROM notifications
      WHERE source_type = 'email_reply_overdue' AND source_id = $1
    `, [legacyId]);
    assert.equal(legacyNotifications.rows[0].count, 0);

    await client.query(`
      INSERT INTO email_messages (
        thread_id, direction, from_address, to_recipients, delivery_status, sent_at, created_at
      ) VALUES ($1, 'outbound', 'sales@sunkaier.com', $2::jsonb, 'sent', $3, $3)
    `, [threadId, JSON.stringify([{ address: 'buyer@example.com' }]), new Date(receivedAt.getTime() + 3 * 3_600_000)]);
    assert.equal(await notifications.isEmailReplyStillDue(firstId), false);

    const pending = await client.query(`
      INSERT INTO email_threads (mailbox_key, subject, last_message_at, triage_status)
      VALUES ('sales@sunkaier.com', 'New RFQ', $1, 'pending') RETURNING id
    `, [receivedAt]);
    const pendingId = await addInbound(Number(pending.rows[0].id), 'pending@example.com');
    const personal = await client.query(`
      INSERT INTO email_threads (mailbox_key, subject, last_message_at, triage_status)
      VALUES ('private@example.com', 'Private mail', $1, 'pending') RETURNING id
    `, [receivedAt]);
    const personalId = await addInbound(Number(personal.rows[0].id), 'private-sender@example.com');
    assert.equal((await response.queueDueUnassignedReminders(beforeDueAt)).created, 0);
    const unassigned = await response.queueDueUnassignedReminders(at);
    assert.equal(unassigned.created, 2);
    assert.equal((await response.queueDueUnassignedReminders(at)).created, 0);
    const pendingRecipients = await client.query(`
      SELECT user_id FROM notifications
      WHERE source_type = 'email_unassigned_overdue' AND source_id = $1 ORDER BY user_id
    `, [pendingId]);
    assert.deepEqual(pendingRecipients.rows.map((row) => Number(row.user_id)), [managerId, adminId].sort((a, b) => a - b));
    const privateNotifications = await client.query(`
      SELECT count(*)::integer AS count FROM notifications
      WHERE source_type = 'email_unassigned_overdue' AND source_id = $1
    `, [personalId]);
    assert.equal(privateNotifications.rows[0].count, 0);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
