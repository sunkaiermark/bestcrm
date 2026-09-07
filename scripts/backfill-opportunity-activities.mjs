import pg from 'pg';
import { assertOpportunityActivityMigration, runOpportunityActivityBackfillBatch } from '../src/services/opportunityActivityBackfill.mjs';

const databaseUrl = process.env.OPPORTUNITY_ACTIVITY_BACKFILL_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('OPPORTUNITY_ACTIVITY_BACKFILL_DATABASE_URL is required; DATABASE_URL is intentionally not used');
}

const sourceCode = process.argv.find((argument) => argument.startsWith('--source='))?.slice('--source='.length);
const batchSize = process.argv.find((argument) => argument.startsWith('--batch-size='))?.slice('--batch-size='.length) || '250';
if (!sourceCode) {
  throw new Error('Pass exactly one source with --source=<source_code>');
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function main() {
  await assertOpportunityActivityMigration(pool);
  const result = await runOpportunityActivityBackfillBatch(pool, { sourceCode, batchSize });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
