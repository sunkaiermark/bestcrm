import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/db/migrate.mjs';

const databaseUrl = process.env.EMAIL_RAW_ARCHIVE_DB_TEST_URL;
if (!databaseUrl) throw new Error('EMAIL_RAW_ARCHIVE_DB_TEST_URL is required');

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_email_raw_test')) {
  throw new Error('Refusing to use a database whose name does not start with bestcrm_email_raw_test');
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

async function insertRaw(client, suffix, uid) {
  const sha = String(uid).padStart(64, 'a').slice(-64);
  const result = await client.query(`
    INSERT INTO email_raw_messages (
      mailbox_key, provider_mailbox, provider_uid_validity, provider_uid,
      rfc_message_id_hint, stored_path, file_size, sha256
    ) VALUES ('sales@sunkaier.com', 'INBOX', '44', $1, $2, $3, 128, $4)
    RETURNING *
  `, [uid, `<raw-${suffix}-${uid}@example.invalid>`, `email-raw/test/44/${uid}-${suffix}.eml`, sha]);
  return result.rows[0];
}

async function verify() {
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const suffix = `${Date.now()}-${process.pid}`;
    const migrations = await client.query(`
      SELECT name FROM schema_migrations
      WHERE name IN ('049_email_raw_archive_foundation.sql', '050_email_raw_backfill_checkpoint.sql')
      ORDER BY name
    `);
    assert.deepEqual(migrations.rows.map((row) => row.name), [
      '049_email_raw_archive_foundation.sql',
      '050_email_raw_backfill_checkpoint.sql'
    ]);

    const thread = await client.query(`
      INSERT INTO email_threads (mailbox_key, subject, normalized_subject, last_message_at)
      VALUES ('sales@sunkaier.com', 'Raw evidence verification', 'raw evidence verification', now())
      RETURNING id
    `);
    const threadId = Number(thread.rows[0].id);
    const raw = await insertRaw(client, suffix, 7001);
    await client.query(`
      INSERT INTO email_raw_scan_attempts (
        raw_message_id, attempt_no, engine, engine_version, signature_version,
        verdict, started_at, completed_at
      ) VALUES ($1, 1, 'clamav', '1.4', '20260908', 'clean', now(), now())
    `, [raw.id]);
    const message = await client.query(`
      INSERT INTO email_messages (
        thread_id, direction, message_id, provider_mailbox, provider_uid_validity,
        provider_uid, from_address, to_recipients, subject, text_body,
        delivery_status, received_at, raw_message_id, raw_eml_stored_path,
        raw_eml_file_size, raw_eml_sha256
      ) VALUES ($1, 'inbound', $2, 'INBOX', '44', 7001, 'buyer@example.invalid',
        '["sales@sunkaier.com"]'::jsonb, 'Raw evidence verification', 'Original body',
        'received', now(), $3, $4, $5, $6)
      RETURNING id
    `, [threadId, `<message-${suffix}@example.invalid>`, raw.id, raw.stored_path, raw.file_size, raw.sha256]);
    const messageId = Number(message.rows[0].id);
    const attachment = await client.query(`
      INSERT INTO email_attachments (
        message_id, source_index, original_name, stored_path, mime_type, file_size, sha256
      ) VALUES ($1, 0, 'spec.pdf', $2, 'application/pdf', 256, repeat('b', 64))
      RETURNING id
    `, [messageId, `email-archive/${suffix}/spec.pdf`]);
    await client.query(`
      INSERT INTO email_attachment_scan_attempts (
        attachment_id, attempt_no, engine, verdict, started_at, completed_at
      ) VALUES ($1, 1, 'clamav', 'clean', now(), now())
    `, [attachment.rows[0].id]);
    await client.query(`
      INSERT INTO email_classification_events (
        message_id, thread_id, actor_type, actor_version, category,
        confidence, reason_codes, is_final
      ) VALUES ($1, $2, 'rule', 'raw-migration-verifier', 'inquiry', 0.9900,
        '["explicit_rfq"]'::jsonb, false)
    `, [messageId, threadId]);

    await expectBlocked(client, 'raw_update_blocked', () => client.query(
      "UPDATE email_raw_messages SET rfc_message_id_hint = 'changed' WHERE id = $1", [raw.id]
    ), /immutable and append-only/i);
    await expectBlocked(client, 'scan_delete_blocked', () => client.query(
      'DELETE FROM email_raw_scan_attempts WHERE raw_message_id = $1', [raw.id]
    ), /immutable and append-only/i);
    await expectBlocked(client, 'message_update_blocked', () => client.query(
      "UPDATE email_messages SET subject = 'changed' WHERE id = $1", [messageId]
    ), /immutable/i);

    const legacyRaw = await insertRaw(client, suffix, 7002);
    await client.query(`
      INSERT INTO email_raw_scan_attempts (
        raw_message_id, attempt_no, engine, verdict, started_at, completed_at
      ) VALUES ($1, 1, 'clamav', 'clean', now(), now())
    `, [legacyRaw.id]);
    const legacyMessage = await client.query(`
      INSERT INTO email_messages (
        thread_id, direction, message_id, provider_mailbox, provider_uid_validity,
        provider_uid, from_address, to_recipients, subject, delivery_status, received_at
      ) VALUES ($1, 'inbound', $2, 'INBOX', '44', 7002, 'legacy@example.invalid',
        '["sales@sunkaier.com"]'::jsonb, 'Legacy binding', 'received', now())
      RETURNING id
    `, [threadId, `<legacy-${suffix}@example.invalid>`]);
    await client.query(`
      UPDATE email_messages
      SET raw_message_id = $2,
          raw_eml_stored_path = $3,
          raw_eml_file_size = $4,
          raw_eml_sha256 = $5
      WHERE id = $1
    `, [legacyMessage.rows[0].id, legacyRaw.id, legacyRaw.stored_path, legacyRaw.file_size, legacyRaw.sha256]);
    await expectBlocked(client, 'raw_rebind_blocked', () => client.query(
      'UPDATE email_messages SET raw_message_id = NULL, raw_eml_stored_path = NULL, raw_eml_file_size = NULL, raw_eml_sha256 = NULL WHERE id = $1',
      [legacyMessage.rows[0].id]
    ), /immutable/i);

    await client.query(`
      INSERT INTO email_imap_sync_states (
        mailbox_key, mailbox_name, uid_validity, incremental_last_uid,
        backfill_before_uid, backfill_complete, raw_backfill_before_uid, raw_backfill_complete
      ) VALUES ('sales@sunkaier.com', 'INBOX', '44', 8000, 1, true, 7001, false)
    `);
    await client.query(`
      UPDATE email_imap_sync_states
      SET raw_backfill_before_uid = 6999, raw_backfill_complete = false,
          last_raw_backfill_sync_at = now()
      WHERE mailbox_key = 'sales@sunkaier.com' AND mailbox_name = 'INBOX'
    `);
    const state = await client.query(`
      SELECT backfill_before_uid, backfill_complete, raw_backfill_before_uid, raw_backfill_complete
      FROM email_imap_sync_states
      WHERE mailbox_key = 'sales@sunkaier.com' AND mailbox_name = 'INBOX'
    `);
    assert.equal(Number(state.rows[0].backfill_before_uid), 1);
    assert.equal(state.rows[0].backfill_complete, true);
    assert.equal(Number(state.rows[0].raw_backfill_before_uid), 6999);
    assert.equal(state.rows[0].raw_backfill_complete, false);

    console.log(JSON.stringify({
      database: databaseName,
      migrations: migrations.rows.map((row) => row.name),
      immutableRawMessages: 2,
      cleanRawScans: 2,
      cleanAttachmentScans: 1,
      classificationEvents: 1,
      legacyBindingsVerified: 1,
      independentRawCursorVerified: true
    }, null, 2));
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
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
