function mapStateRow(row) {
  if (!row) {
    return null;
  }
  return {
    identityKey: row.identity_key,
    failedCount: Number(row.failed_count),
    lockedUntil: row.locked_until,
    lastFailedAt: row.last_failed_at,
    updatedAt: row.updated_at
  };
}

export function createLoginSecurityRepository(pool) {
  return {
    async findStates(keys) {
      if (!keys.length) {
        return [];
      }
      const result = await pool.query(`
        SELECT identity_key, failed_count, locked_until, last_failed_at, updated_at
        FROM login_attempt_states
        WHERE identity_key = ANY($1::text[])
      `, [keys]);
      return result.rows.map(mapStateRow);
    },

    async recordFailedAttempt({ keys, lockedUntil }) {
      if (!keys.length) {
        return;
      }
      await pool.query(`
        INSERT INTO login_attempt_states (identity_key, failed_count, locked_until, last_failed_at, updated_at)
        SELECT unnest($1::text[]), 1, $2, now(), now()
        ON CONFLICT (identity_key) DO UPDATE
        SET
          failed_count = login_attempt_states.failed_count + 1,
          locked_until = EXCLUDED.locked_until,
          last_failed_at = now(),
          updated_at = now()
      `, [keys, lockedUntil || null]);
    },

    async resetAttempts(keys) {
      if (!keys.length) {
        return;
      }
      await pool.query('DELETE FROM login_attempt_states WHERE identity_key = ANY($1::text[])', [keys]);
    },

    async recordAuditEvent(event) {
      await pool.query(`
        INSERT INTO login_audit_events (
          username,
          user_id,
          ip_address,
          user_agent,
          result,
          reason
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        event.username,
        event.userId || null,
        event.ipAddress || null,
        event.userAgent || null,
        event.result,
        event.reason || null
      ]);
    }
  };
}
