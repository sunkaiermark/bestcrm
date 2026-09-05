function mapSettingRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    method: row.method,
    status: row.status,
    isRequired: row.is_required,
    enrollmentStartedAt: row.enrollment_started_at,
    enrolledAt: row.enrolled_at,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVerificationMaterialRow(row) {
  const setting = mapSettingRow(row);
  if (!setting) {
    return null;
  }
  return {
    ...setting,
    secretCiphertext: row.secret_ciphertext,
    secretNonce: row.secret_nonce,
    secretAuthTag: row.secret_auth_tag,
    secretKeyVersion: Number(row.secret_key_version)
  };
}

function mapTrustedDeviceRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    deviceLabel: row.device_label,
    userAgentHash: row.user_agent_hash,
    lastIp: row.last_ip,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

const safeSettingColumns = `
  id,
  user_id,
  method,
  status,
  is_required,
  enrollment_started_at,
  enrolled_at,
  last_verified_at,
  created_at,
  updated_at
`;

const safeTrustedDeviceColumns = `
  id,
  user_id,
  device_label,
  user_agent_hash,
  last_ip,
  created_at,
  last_used_at,
  expires_at,
  revoked_at
`;

async function withTransaction(pool, callback) {
  const queryTarget = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await queryTarget.query('BEGIN');
    const result = await callback(queryTarget);
    await queryTarget.query('COMMIT');
    return result;
  } catch (error) {
    await queryTarget.query('ROLLBACK');
    throw error;
  } finally {
    if (queryTarget !== pool && typeof queryTarget.release === 'function') {
      queryTarget.release();
    }
  }
}

export function createMfaRepository(pool) {
  return {
    async findStatusByUserId(userId) {
      const result = await pool.query(`
        SELECT ${safeSettingColumns}
        FROM user_mfa_settings
        WHERE user_id = $1
        LIMIT 1
      `, [userId]);
      return mapSettingRow(result.rows[0]);
    },

    async listStatusForAdministration() {
      const result = await pool.query(`
        SELECT
          u.id AS user_id,
          u.username,
          u.display_name,
          u.is_active,
          COALESCE(m.method, 'totp') AS method,
          COALESCE(m.status, 'disabled') AS status,
          COALESCE(m.is_required, false) AS is_required,
          m.enrolled_at,
          m.last_verified_at,
          m.updated_at
        FROM users u
        LEFT JOIN user_mfa_settings m ON m.user_id = u.id
        ORDER BY u.is_active DESC, u.display_name ASC
      `);
      return result.rows.map((row) => ({
        userId: Number(row.user_id),
        username: row.username,
        displayName: row.display_name,
        isActive: row.is_active,
        method: row.method,
        status: row.status,
        isRequired: row.is_required,
        enrolledAt: row.enrolled_at,
        lastVerifiedAt: row.last_verified_at,
        updatedAt: row.updated_at
      }));
    },

    async findVerificationMaterialByUserId(userId) {
      const result = await pool.query(`
        SELECT
          ${safeSettingColumns},
          secret_ciphertext,
          secret_nonce,
          secret_auth_tag,
          secret_key_version
        FROM user_mfa_settings
        WHERE user_id = $1
          AND status IN ('pending', 'active')
        LIMIT 1
      `, [userId]);
      return mapVerificationMaterialRow(result.rows[0]);
    },

    async setRequired(userId, isRequired) {
      const result = await pool.query(`
        INSERT INTO user_mfa_settings (user_id, is_required)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
        SET is_required = EXCLUDED.is_required, updated_at = now()
        RETURNING ${safeSettingColumns}
      `, [userId, isRequired]);
      return mapSettingRow(result.rows[0]);
    },

    async savePendingEnrollment({
      userId,
      secretCiphertext,
      secretNonce,
      secretAuthTag,
      secretKeyVersion
    }) {
      const result = await pool.query(`
        INSERT INTO user_mfa_settings (
          user_id,
          status,
          secret_ciphertext,
          secret_nonce,
          secret_auth_tag,
          secret_key_version,
          enrollment_started_at
        )
        VALUES ($1, 'pending', $2, $3, $4, $5, now())
        ON CONFLICT (user_id) DO UPDATE
        SET
          status = 'pending',
          is_required = user_mfa_settings.is_required,
          secret_ciphertext = EXCLUDED.secret_ciphertext,
          secret_nonce = EXCLUDED.secret_nonce,
          secret_auth_tag = EXCLUDED.secret_auth_tag,
          secret_key_version = EXCLUDED.secret_key_version,
          enrollment_started_at = now(),
          enrolled_at = NULL,
          last_verified_at = NULL,
          updated_at = now()
        RETURNING ${safeSettingColumns}
      `, [userId, secretCiphertext, secretNonce, secretAuthTag, secretKeyVersion]);
      return mapSettingRow(result.rows[0]);
    },

    async activateEnrollment(userId, verifiedAt = new Date()) {
      const result = await pool.query(`
        UPDATE user_mfa_settings
        SET
          status = 'active',
          enrolled_at = $2,
          last_verified_at = $2,
          updated_at = now()
        WHERE user_id = $1
          AND status = 'pending'
        RETURNING ${safeSettingColumns}
      `, [userId, verifiedAt]);
      return mapSettingRow(result.rows[0]);
    },

    async activateEnrollmentWithRecoveryCodes({
      userId,
      verifiedAt = new Date(),
      generation,
      codeHashes
    }) {
      return withTransaction(pool, async (queryTarget) => {
        const activationResult = await queryTarget.query(`
          UPDATE user_mfa_settings
          SET
            status = 'active',
            enrolled_at = $2,
            last_verified_at = $2,
            updated_at = now()
          WHERE user_id = $1
            AND status = 'pending'
          RETURNING ${safeSettingColumns}
        `, [userId, verifiedAt]);
        const activated = mapSettingRow(activationResult.rows[0]);
        if (!activated) {
          throw new Error('Pending MFA enrollment not found');
        }
        await queryTarget.query(`
          UPDATE user_mfa_recovery_codes
          SET invalidated_at = now()
          WHERE user_id = $1
            AND used_at IS NULL
            AND invalidated_at IS NULL
        `, [userId]);
        await queryTarget.query(`
          INSERT INTO user_mfa_recovery_codes (
            user_id,
            mfa_setting_id,
            generation,
            code_hash
          )
          SELECT $1, $2, $3, unnest($4::text[])
        `, [userId, activated.id, generation, codeHashes]);
        return activated;
      });
    },

    async recordVerification(userId, verifiedAt = new Date()) {
      const result = await pool.query(`
        UPDATE user_mfa_settings
        SET last_verified_at = $2, updated_at = now()
        WHERE user_id = $1
          AND status = 'active'
          AND (last_verified_at IS NULL OR last_verified_at < $2)
        RETURNING ${safeSettingColumns}
      `, [userId, verifiedAt]);
      return mapSettingRow(result.rows[0]);
    },

    async replaceRecoveryCodeHashes({ userId, generation, codeHashes }) {
      return withTransaction(pool, async (queryTarget) => {
        const settingResult = await queryTarget.query(`
          SELECT id
          FROM user_mfa_settings
          WHERE user_id = $1
            AND status = 'active'
          FOR UPDATE
        `, [userId]);
        if (!settingResult.rows[0]) {
          throw new Error('Active MFA enrollment not found');
        }
        const settingId = Number(settingResult.rows[0].id);
        await queryTarget.query(`
          UPDATE user_mfa_recovery_codes
          SET invalidated_at = now()
          WHERE user_id = $1
            AND used_at IS NULL
            AND invalidated_at IS NULL
        `, [userId]);
        await queryTarget.query(`
          INSERT INTO user_mfa_recovery_codes (
            user_id,
            mfa_setting_id,
            generation,
            code_hash
          )
          SELECT $1, $2, $3, unnest($4::text[])
        `, [userId, settingId, generation, codeHashes]);
      });
    },

    async replaceRecoveryCodeHashesWithNextGeneration({ userId, codeHashes }) {
      return withTransaction(pool, async (queryTarget) => {
        const settingResult = await queryTarget.query(`
          SELECT id
          FROM user_mfa_settings
          WHERE user_id = $1
            AND status = 'active'
          FOR UPDATE
        `, [userId]);
        if (!settingResult.rows[0]) {
          throw new Error('Active MFA enrollment not found');
        }
        const settingId = Number(settingResult.rows[0].id);
        const generationResult = await queryTarget.query(`
          SELECT COALESCE(MAX(generation), 0) + 1 AS generation
          FROM user_mfa_recovery_codes
          WHERE mfa_setting_id = $1
        `, [settingId]);
        const generation = Number(generationResult.rows[0]?.generation);
        if (!Number.isInteger(generation) || generation <= 0) {
          throw new Error('Recovery-code generation could not be allocated');
        }
        await queryTarget.query(`
          UPDATE user_mfa_recovery_codes
          SET invalidated_at = now()
          WHERE user_id = $1
            AND used_at IS NULL
            AND invalidated_at IS NULL
        `, [userId]);
        await queryTarget.query(`
          INSERT INTO user_mfa_recovery_codes (
            user_id,
            mfa_setting_id,
            generation,
            code_hash
          )
          SELECT $1, $2, $3, unnest($4::text[])
        `, [userId, settingId, generation, codeHashes]);
        return generation;
      });
    },

    async prepareSelfServiceEnrollment(userId) {
      return withTransaction(pool, async (queryTarget) => {
        const settingResult = await queryTarget.query(`
          INSERT INTO user_mfa_settings (user_id, status, is_required)
          VALUES ($1, 'disabled', true)
          ON CONFLICT (user_id) DO UPDATE
          SET
            status = 'disabled',
            is_required = true,
            secret_ciphertext = NULL,
            secret_nonce = NULL,
            secret_auth_tag = NULL,
            secret_key_version = NULL,
            enrollment_started_at = NULL,
            enrolled_at = NULL,
            last_verified_at = NULL,
            updated_at = now()
          RETURNING ${safeSettingColumns}
        `, [userId]);
        const setting = mapSettingRow(settingResult.rows[0]);
        if (!setting) {
          throw new Error('MFA enrollment could not be prepared');
        }
        await queryTarget.query(`
          UPDATE user_mfa_recovery_codes
          SET invalidated_at = now()
          WHERE user_id = $1
            AND used_at IS NULL
            AND invalidated_at IS NULL
        `, [userId]);
        await queryTarget.query(`
          UPDATE user_trusted_devices
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            AND revoked_at IS NULL
        `, [userId]);
        await queryTarget.query(`
          DELETE FROM "session"
          WHERE sess ->> 'userId' = $1
        `, [String(userId)]);
        return setting;
      });
    },

    async consumeRecoveryCodeHash({ userId, codeHash }) {
      const result = await pool.query(`
        WITH candidate AS (
          SELECT id
          FROM user_mfa_recovery_codes
          WHERE user_id = $1
            AND code_hash = $2
            AND used_at IS NULL
            AND invalidated_at IS NULL
          ORDER BY generation DESC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE user_mfa_recovery_codes code
        SET used_at = now()
        FROM candidate
        WHERE code.id = candidate.id
        RETURNING code.id, code.generation, code.used_at
      `, [userId, codeHash]);
      const row = result.rows[0];
      return row ? {
        id: Number(row.id),
        generation: Number(row.generation),
        usedAt: row.used_at
      } : null;
    },

    async createTrustedDevice({
      userId,
      tokenHash,
      deviceLabel,
      userAgentHash,
      lastIp,
      expiresAt
    }) {
      const result = await pool.query(`
        INSERT INTO user_trusted_devices (
          user_id,
          token_hash,
          device_label,
          user_agent_hash,
          last_ip,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING ${safeTrustedDeviceColumns}
      `, [userId, tokenHash, deviceLabel, userAgentHash || null, lastIp || null, expiresAt]);
      return mapTrustedDeviceRow(result.rows[0]);
    },

    async findActiveTrustedDeviceByTokenHash(tokenHash) {
      const result = await pool.query(`
        SELECT ${safeTrustedDeviceColumns}
        FROM user_trusted_devices
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        LIMIT 1
      `, [tokenHash]);
      return mapTrustedDeviceRow(result.rows[0]);
    },

    async listTrustedDevicesByUserId(userId) {
      const result = await pool.query(`
        SELECT ${safeTrustedDeviceColumns}
        FROM user_trusted_devices
        WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);
      return result.rows.map(mapTrustedDeviceRow);
    },

    async touchTrustedDevice(id, lastIp, usedAt = new Date()) {
      const result = await pool.query(`
        UPDATE user_trusted_devices
        SET last_used_at = $3, last_ip = $2
        WHERE id = $1
          AND revoked_at IS NULL
          AND expires_at > $3
        RETURNING ${safeTrustedDeviceColumns}
      `, [id, lastIp || null, usedAt]);
      return mapTrustedDeviceRow(result.rows[0]);
    },

    async revokeTrustedDevice(userId, deviceId) {
      const result = await pool.query(`
        UPDATE user_trusted_devices
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1
          AND user_id = $2
        RETURNING ${safeTrustedDeviceColumns}
      `, [deviceId, userId]);
      return mapTrustedDeviceRow(result.rows[0]);
    },

    async revokeAllTrustedDevices(userId) {
      const result = await pool.query(`
        UPDATE user_trusted_devices
        SET revoked_at = now()
        WHERE user_id = $1
          AND revoked_at IS NULL
        RETURNING id
      `, [userId]);
      return result.rows.map((row) => Number(row.id));
    }
  };
}
