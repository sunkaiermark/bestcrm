import { approvalStageLabel } from '../domain/systemCatalog.mjs';

function mapApprovalSettingRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    settingKey: row.setting_key,
    stage: approvalStageLabel(row.setting_key),
    userId: Number(row.user_id),
    userDisplayName: row.user_display_name,
    username: row.username,
    roleCode: row.role_code,
    roleName: row.role_name || row.role_code,
    sortOrder: Number(row.sort_order),
    isActive: row.is_active
  };
}

const approvalSettingSelect = `
  SELECT
    aps.id,
    aps.setting_key,
    aps.user_id,
    u.display_name AS user_display_name,
    u.username,
    aps.role_code,
    r.name AS role_name,
    aps.sort_order,
    aps.is_active
  FROM approval_settings aps
  JOIN users u ON u.id = aps.user_id
  LEFT JOIN roles r ON r.code = aps.role_code
`;

export function createApprovalSettingRepository(pool) {
  return {
    async listApprovalSettings() {
      const result = await pool.query(`
        ${approvalSettingSelect}
        ORDER BY aps.is_active DESC, aps.setting_key ASC, aps.sort_order ASC, u.display_name ASC
      `);
      return result.rows.map(mapApprovalSettingRow);
    },

    async findById(id) {
      const result = await pool.query(`
        ${approvalSettingSelect}
        WHERE aps.id = $1
        LIMIT 1
      `, [id]);
      return mapApprovalSettingRow(result.rows[0]);
    },

    async findActiveByKey(settingKey) {
      const result = await pool.query(`
        ${approvalSettingSelect}
        WHERE aps.setting_key = $1
          AND aps.is_active = true
          AND u.is_active = true
        ORDER BY aps.sort_order ASC, aps.id ASC
        LIMIT 1
      `, [settingKey]);
      return mapApprovalSettingRow(result.rows[0]);
    },

    async createApprovalSetting(setting) {
      const result = await pool.query(`
        INSERT INTO approval_settings (setting_key, user_id, role_code, sort_order, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [
        setting.settingKey,
        setting.userId,
        setting.roleCode,
        setting.sortOrder,
        setting.isActive
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async updateApprovalSetting(id, setting) {
      const result = await pool.query(`
        UPDATE approval_settings
        SET setting_key = $2,
            user_id = $3,
            role_code = $4,
            sort_order = $5,
            is_active = $6
        WHERE id = $1
        RETURNING id
      `, [
        id,
        setting.settingKey,
        setting.userId,
        setting.roleCode,
        setting.sortOrder,
        setting.isActive
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async deactivateApprovalSetting(id) {
      const result = await pool.query(`
        UPDATE approval_settings
        SET is_active = false
        WHERE id = $1
        RETURNING id
      `, [id]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    }
  };
}
