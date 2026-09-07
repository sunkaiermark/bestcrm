import { opportunityActivitySource } from '../domain/opportunityActivitySources.mjs';

function positiveBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error('Batch size must be an integer between 1 and 1000');
  }
  return parsed;
}

export async function assertOpportunityActivityMigration(queryTarget) {
  const result = await queryTarget.query(`
    SELECT 1
    FROM schema_migrations
    WHERE name = '048_opportunity_activity_spine.sql'
  `);
  if (result.rowCount !== 1) {
    throw new Error('Opportunity activity spine migration 048 is not applied');
  }
}

export async function runOpportunityActivityBackfillBatch(queryTarget, {
  sourceCode,
  batchSize = 250
}) {
  const source = opportunityActivitySource(sourceCode);
  if (!source) {
    throw new Error(`Unsupported opportunity activity source: ${sourceCode}`);
  }
  const limit = positiveBatchSize(batchSize);
  await queryTarget.query('BEGIN');
  try {
    let stateResult = await queryTarget.query(`
      SELECT source_code, high_water_id, last_source_id,
             scanned_count, indexed_count, skipped_count, completed_at
      FROM opportunity_activity_backfill_state
      WHERE source_code = $1
      FOR UPDATE
    `, [source.code]);

    if (stateResult.rowCount === 0) {
      const highWater = await queryTarget.query(`
        SELECT COALESCE(max(source.id), 0)::bigint AS high_water_id
        FROM ${source.table} source
        WHERE ${source.eligibleSql}
      `);
      stateResult = await queryTarget.query(`
        INSERT INTO opportunity_activity_backfill_state (source_code, high_water_id)
        VALUES ($1, $2)
        RETURNING source_code, high_water_id, last_source_id,
                  scanned_count, indexed_count, skipped_count, completed_at
      `, [source.code, highWater.rows[0].high_water_id]);
    }

    const state = stateResult.rows[0];
    const rows = await queryTarget.query(`
      SELECT source.id
      FROM ${source.table} source
      WHERE source.id > $1
        AND source.id <= $2
        AND ${source.eligibleSql}
      ORDER BY source.id
      LIMIT $3
    `, [state.last_source_id, state.high_water_id, limit]);

    let indexed = 0;
    let skipped = 0;
    for (const row of rows.rows) {
      const result = await queryTarget.query(
        'SELECT bestcrm_index_activity_source($1, $2) AS activity_id',
        [source.code, row.id]
      );
      if (result.rows[0]?.activity_id) indexed += 1;
      else skipped += 1;
    }

    const lastSourceId = rows.rowCount > 0
      ? rows.rows.at(-1).id
      : state.high_water_id;
    const complete = Number(lastSourceId) >= Number(state.high_water_id);
    const updated = await queryTarget.query(`
      UPDATE opportunity_activity_backfill_state
      SET last_source_id = $2,
          scanned_count = scanned_count + $3,
          indexed_count = indexed_count + $4,
          skipped_count = skipped_count + $5,
          completed_at = CASE WHEN $6 THEN COALESCE(completed_at, now()) ELSE NULL END,
          updated_at = now()
      WHERE source_code = $1
      RETURNING source_code, high_water_id, last_source_id,
                scanned_count, indexed_count, skipped_count, completed_at
    `, [source.code, lastSourceId, rows.rowCount, indexed, skipped, complete]);
    const remainingResult = await queryTarget.query(`
      SELECT count(*)::integer AS remaining_count
      FROM ${source.table} source
      WHERE source.id > $1
        AND source.id <= $2
        AND ${source.eligibleSql}
    `, [lastSourceId, state.high_water_id]);
    await queryTarget.query('COMMIT');

    const finalState = updated.rows[0];
    return {
      sourceCode: source.code,
      scanned: rows.rowCount,
      indexed,
      skipped,
      highWaterId: Number(finalState.high_water_id),
      lastSourceId: Number(finalState.last_source_id),
      remaining: Number(remainingResult.rows[0].remaining_count),
      complete: Boolean(finalState.completed_at),
      totals: {
        scanned: Number(finalState.scanned_count),
        indexed: Number(finalState.indexed_count),
        skipped: Number(finalState.skipped_count)
      }
    };
  } catch (error) {
    await queryTarget.query('ROLLBACK');
    throw error;
  }
}
