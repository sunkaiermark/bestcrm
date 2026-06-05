import { createPool } from './pool.mjs';
import { ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { ROLES } from '../domain/roles.mjs';
import { hashPassword } from '../services/authService.mjs';
import { isMainModule } from '../utils/moduleEntry.mjs';

export const ROLE_SEEDS = Object.freeze(ROLE_DETAILS.map(({ code, name, description }) => ({ code, name, description })));

export const INTERNAL_TEST_ACCOUNTS = Object.freeze([
  {
    username: 'sales01',
    displayName: 'Sales User',
    email: 'sales01@bestcrm.local',
    role: ROLES.SALESPERSON
  },
  {
    username: 'sales_manager01',
    displayName: 'Sales Manager',
    email: 'sales.manager01@bestcrm.local',
    role: ROLES.SALES_MANAGER
  },
  {
    username: 'quotation_engineer01',
    displayName: 'Quotation Engineer',
    email: 'quotation.engineer01@bestcrm.local',
    role: ROLES.QUOTATION_ENGINEER
  },
  {
    username: 'technical_manager01',
    displayName: 'Technical Manager',
    email: 'technical.manager01@bestcrm.local',
    role: ROLES.TECHNICAL_MANAGER
  },
  {
    username: 'commercial_manager01',
    displayName: 'Commercial Manager',
    email: 'commercial.manager01@bestcrm.local',
    role: ROLES.COMMERCIAL_MANAGER
  },
  {
    username: 'legal_reviewer01',
    displayName: 'Legal Reviewer',
    email: 'legal.reviewer01@bestcrm.local',
    role: ROLES.LEGAL_REVIEWER
  },
  {
    username: 'admin01',
    displayName: 'System Administrator',
    email: 'admin01@bestcrm.local',
    role: ROLES.ADMINISTRATOR
  }
]);

export const APPROVAL_SETTING_SEEDS = Object.freeze([
  {
    settingKey: 'opportunity_initiation',
    username: 'sales_manager01',
    roleCode: ROLES.SALES_MANAGER,
    sortOrder: 1
  },
  {
    settingKey: 'technical_solution',
    username: 'technical_manager01',
    roleCode: ROLES.TECHNICAL_MANAGER,
    sortOrder: 1
  },
  {
    settingKey: 'commercial_quote',
    username: 'commercial_manager01',
    roleCode: ROLES.COMMERCIAL_MANAGER,
    sortOrder: 1
  },
  {
    settingKey: 'contract_approval',
    username: 'legal_reviewer01',
    roleCode: ROLES.LEGAL_REVIEWER,
    sortOrder: 1
  }
]);

const defaultPassword = 'ChangeMe123!';

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

async function upsertAccount(pool, account, passwordHash) {
  const result = await pool.query(`
    INSERT INTO users (username, password_hash, display_name, email, is_active)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (username) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      email = EXCLUDED.email,
      is_active = true,
      updated_at = now()
    RETURNING id
  `, [account.username, passwordHash, account.displayName, account.email]);
  return Number(result.rows[0].id);
}

async function assignRole(pool, userId, roleId) {
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, role_id) DO NOTHING
  `, [userId, roleId]);
}

async function upsertApprovalSetting(pool, setting, userIdsByUsername) {
  const userId = userIdsByUsername.get(setting.username);
  if (!userId) {
    throw new Error(`Missing approval user ${setting.username}`);
  }
  await pool.query(`
    INSERT INTO approval_settings (setting_key, user_id, role_code, sort_order, is_active)
    SELECT $1, $2, $3, $4, true
    WHERE NOT EXISTS (
      SELECT 1
      FROM approval_settings
      WHERE setting_key = $1
        AND user_id = $2
        AND role_code = $3
    )
  `, [setting.settingKey, userId, setting.roleCode, setting.sortOrder]);
}

export async function seedInternalAccounts(pool, options = {}) {
  const password = options.password || process.env.SEED_DEFAULT_PASSWORD || defaultPassword;
  const passwordHash = await hashPassword(password);
  const roleIdsByCode = new Map();
  const userIdsByUsername = new Map();
  await pool.query('BEGIN');
  try {
    for (const role of ROLE_SEEDS) {
      roleIdsByCode.set(role.code, await upsertRole(pool, role));
    }
    for (const account of INTERNAL_TEST_ACCOUNTS) {
      const userId = await upsertAccount(pool, account, passwordHash);
      userIdsByUsername.set(account.username, userId);
      await assignRole(pool, userId, roleIdsByCode.get(account.role));
    }
    for (const setting of APPROVAL_SETTING_SEEDS) {
      await upsertApprovalSetting(pool, setting, userIdsByUsername);
    }
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  return {
    password,
    accounts: INTERNAL_TEST_ACCOUNTS.map((account) => ({
      username: account.username,
      displayName: account.displayName,
      role: account.role
    }))
  };
}

if (isMainModule(import.meta.url)) {
  const pool = createPool();
  seedInternalAccounts(pool)
    .then(async (result) => {
      console.log(`Seeded ${result.accounts.length} internal workflow accounts.`);
      console.log(`Default password: ${result.password}`);
      for (const account of result.accounts) {
        console.log(`${account.username} (${account.role})`);
      }
      await pool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
