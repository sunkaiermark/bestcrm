import assert from 'node:assert/strict';
import pg from 'pg';
import { loadConfig } from '../src/config.mjs';
import { inspectCoreRecordForeignKeys } from '../src/domain/opportunityRecordGuardrails.mjs';

const databaseUrl = process.env.OPPORTUNITY_RECORD_GUARDRAILS_AUDIT_URL || loadConfig().databaseUrl;
if (!databaseUrl) {
  throw new Error('DATABASE_URL or OPPORTUNITY_RECORD_GUARDRAILS_AUDIT_URL is required');
}

const parsedUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
const pool = new pg.Pool({ connectionString: databaseUrl });

async function audit() {
  const migration = await pool.query(`
    SELECT 1
    FROM schema_migrations
    WHERE name = '047_opportunity_record_guardrails.sql'
  `);
  assert.equal(migration.rowCount, 1, 'Opportunity record guardrails migration is not applied');

  const integrity = await pool.query(`
    SELECT 'customers' AS table_name,
      count(*)::integer AS row_count,
      count(*) FILTER (WHERE record_uid IS NULL)::integer AS null_uid_count,
      (count(record_uid) - count(DISTINCT record_uid))::integer AS duplicate_uid_count
    FROM customers
    UNION ALL
    SELECT 'contacts', count(*)::integer,
      count(*) FILTER (WHERE record_uid IS NULL)::integer,
      (count(record_uid) - count(DISTINCT record_uid))::integer
    FROM contacts
    UNION ALL
    SELECT 'opportunities', count(*)::integer,
      count(*) FILTER (WHERE record_uid IS NULL)::integer,
      (count(record_uid) - count(DISTINCT record_uid))::integer
    FROM opportunities
    ORDER BY table_name
  `);
  assert.ok(integrity.rows.every((row) => row.null_uid_count === 0));
  assert.ok(integrity.rows.every((row) => row.duplicate_uid_count === 0));

  const foreignKeys = await pool.query(`
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
  assert.deepEqual(foreignKeyInspection.missingRequired, [], 'Required core-record foreign keys are missing');
  assert.deepEqual(foreignKeyInspection.unsafeDeleteActions, [], 'Core-record foreign keys must use ON DELETE RESTRICT');

  const requiredTriggers = [
    'contacts_prevent_delete',
    'contacts_prevent_merge_cycle',
    'contacts_protect_record_uid',
    'customers_prevent_delete',
    'customers_prevent_merge_cycle',
    'customers_protect_record_uid',
    'opportunities_prevent_delete',
    'opportunities_protect_record_uid',
    'record_lifecycle_events_immutable'
  ];
  const triggers = await pool.query(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND trigger_name = ANY($1::text[])
    GROUP BY trigger_name
    ORDER BY trigger_name
  `, [requiredTriggers]);
  assert.deepEqual(triggers.rows.map((row) => row.trigger_name), requiredTriggers);

  console.log(JSON.stringify({
    database: databaseName,
    host: parsedUrl.hostname,
    migrationApplied: true,
    coreTables: integrity.rows,
    protectedCoreForeignKeys: foreignKeyInspection.total,
    requiredTriggers: triggers.rowCount,
    result: 'passed'
  }, null, 2));
}

audit()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
