function mapRow(row) {
  if (!row) return null;
  return {
    token: String(row.token || ''),
    actorUserId: Number(row.actor_user_id),
    requestMethod: String(row.request_method || ''),
    requestPath: String(row.request_path || ''),
    state: String(row.state || ''),
    responseStatus: row.response_status === null || row.response_status === undefined
      ? null
      : Number(row.response_status),
    responseLocation: String(row.response_location || ''),
    createdAt: row.created_at || null,
    completedAt: row.completed_at || null,
    newlyClaimed: row.newly_claimed === true
  };
}

export function createFormSubmissionRepository(queryTarget) {
  return {
    async claim({ token, actorUserId, requestMethod, requestPath }) {
      const result = await queryTarget.query(`
        WITH inserted AS (
          INSERT INTO form_submission_idempotency (
            token,
            actor_user_id,
            request_method,
            request_path
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (token) DO NOTHING
          RETURNING *, true AS newly_claimed
        )
        SELECT * FROM inserted
        UNION ALL
        SELECT existing.*, false AS newly_claimed
        FROM form_submission_idempotency existing
        WHERE existing.token = $1
          AND NOT EXISTS (SELECT 1 FROM inserted)
        LIMIT 1
      `, [token, actorUserId, requestMethod, requestPath]);
      return mapRow(result.rows[0]);
    },

    async complete({ token, actorUserId, requestMethod, requestPath, state, responseStatus, responseLocation }) {
      const result = await queryTarget.query(`
        UPDATE form_submission_idempotency
        SET
          state = $5,
          response_status = $6,
          response_location = $7,
          completed_at = now()
        WHERE token = $1
          AND actor_user_id = $2
          AND request_method = $3
          AND request_path = $4
          AND state = 'processing'
        RETURNING *
      `, [
        token,
        actorUserId,
        requestMethod,
        requestPath,
        state,
        responseStatus,
        responseLocation || ''
      ]);
      return mapRow(result.rows[0]);
    },

    async release({ token, actorUserId, requestMethod, requestPath }) {
      const result = await queryTarget.query(`
        DELETE FROM form_submission_idempotency
        WHERE token = $1
          AND actor_user_id = $2
          AND request_method = $3
          AND request_path = $4
          AND state = 'processing'
      `, [token, actorUserId, requestMethod, requestPath]);
      return result.rowCount > 0;
    }
  };
}
