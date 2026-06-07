import { createPool } from './pool.mjs';
import { ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { isMainModule } from '../utils/moduleEntry.mjs';

export const ROLE_SEEDS = Object.freeze(ROLE_DETAILS.map(({ code, name, description }) => ({ code, name, description })));

function isTruthy(value) {
  return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function assertSeedAllowed(options = {}) {
  const nodeEnv = String(options.nodeEnv || process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv !== 'production') {
    return;
  }

  const allowProductionSeed = options.allowProductionSeed === true
    || isTruthy(process.env.BESTCRM_ALLOW_PRODUCTION_SEED);
  if (!allowProductionSeed) {
    throw new Error('Refusing to run db:seed in production. Set BESTCRM_ALLOW_PRODUCTION_SEED=true only for controlled setup.');
  }
}

async function upsertRole(pool, role) {
  const result = await pool.query(`
    INSERT INTO roles (code, name, description, is_active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = true
    RETURNING id
  `, [role.code, role.name, role.description]);
  return Number(result.rows[0].id);
}

export async function seedInternalAccounts(pool, options = {}) {
  assertSeedAllowed(options);
  const roles = [];
  await pool.query('BEGIN');
  try {
    for (const role of ROLE_SEEDS) {
      await upsertRole(pool, role);
      roles.push(role);
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  return {
    roles,
    accounts: []
  };
}

if (isMainModule(import.meta.url)) {
  const pool = createPool();
  seedInternalAccounts(pool)
    .then(async (result) => {
      console.log(`Seeded ${result.roles.length} system roles.`);
      console.log('Demo users are not created by db:seed.');
      await pool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
