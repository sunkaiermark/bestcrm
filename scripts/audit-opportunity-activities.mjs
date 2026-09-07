import assert from 'node:assert/strict';
import pg from 'pg';
import { loadConfig } from '../src/config.mjs';
import { OPPORTUNITY_ACTIVITY_SOURCES } from '../src/domain/opportunityActivitySources.mjs';

const databaseUrl = process.env.OPPORTUNITY_ACTIVITY_AUDIT_URL || loadConfig().databaseUrl;
if (!databaseUrl) throw new Error('OPPORTUNITY_ACTIVITY_AUDIT_URL or DATABASE_URL is required');

const parsedUrl = new URL(databaseUrl);
const pool = new pg.Pool({ connectionString: databaseUrl });

async function auditSource(source) {
  const result = await pool.query(`
    WITH eligible AS (
      SELECT source.id, ${source.opportunitySql} AS opportunity_id
      FROM ${source.table} source
      WHERE ${source.eligibleSql}
    ), primary_links AS (
      SELECT link.${source.linkColumn} AS source_id,
             count(*)::integer AS link_count,
             min(activity.opportunity_id) AS activity_opportunity_id,
             count(DISTINCT activity.opportunity_id)::integer AS opportunity_count
      FROM opportunity_activity_links link
      JOIN opportunity_activities activity ON activity.id = link.activity_id
      WHERE link.link_role = 'primary' AND link.${source.linkColumn} IS NOT NULL
      GROUP BY link.${source.linkColumn}
    )
    SELECT
      count(*)::integer AS eligible_count,
      count(*) FILTER (WHERE primary_links.source_id IS NULL)::integer AS missing_count,
      count(*) FILTER (WHERE primary_links.link_count <> 1)::integer AS duplicate_count,
      count(*) FILTER (
        WHERE primary_links.source_id IS NOT NULL
          AND (primary_links.opportunity_count <> 1
            OR primary_links.activity_opportunity_id IS DISTINCT FROM eligible.opportunity_id)
      )::integer AS mismatched_count
    FROM eligible
    LEFT JOIN primary_links ON primary_links.source_id = eligible.id
  `);
  return {
    sourceCode: source.code,
    eligible: result.rows[0].eligible_count,
    missing: result.rows[0].missing_count,
    duplicate: result.rows[0].duplicate_count,
    mismatched: result.rows[0].mismatched_count
  };
}

async function main() {
  const migration = await pool.query(`
    SELECT 1 FROM schema_migrations WHERE name = '048_opportunity_activity_spine.sql'
  `);
  assert.equal(migration.rowCount, 1, 'Opportunity activity spine migration 048 is not applied');
  const sources = [];
  for (const source of OPPORTUNITY_ACTIVITY_SOURCES) sources.push(await auditSource(source));
  assert.ok(sources.every((source) => source.missing === 0));
  assert.ok(sources.every((source) => source.duplicate === 0));
  assert.ok(sources.every((source) => source.mismatched === 0));

  const contactHistory = await pool.query(`
    SELECT count(*)::integer AS mismatched_count
    FROM opportunities opportunity
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS current_count, min(relationship.contact_id) AS contact_id
      FROM opportunity_contacts relationship
      WHERE relationship.opportunity_id = opportunity.id
        AND relationship.is_primary
        AND relationship.valid_to IS NULL
    ) current_contact ON true
    WHERE (opportunity.primary_contact_id IS NULL AND current_contact.current_count <> 0)
       OR (opportunity.primary_contact_id IS NOT NULL AND (
         current_contact.current_count <> 1
         OR current_contact.contact_id IS DISTINCT FROM opportunity.primary_contact_id
       ))
  `);
  assert.equal(contactHistory.rows[0].mismatched_count, 0);

  console.log(JSON.stringify({
    database: decodeURIComponent(parsedUrl.pathname.slice(1)),
    host: parsedUrl.hostname,
    migrationApplied: true,
    opportunityContactHistoryMismatches: contactHistory.rows[0].mismatched_count,
    sources,
    result: 'passed'
  }, null, 2));
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
