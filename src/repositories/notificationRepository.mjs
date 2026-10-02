function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function safeActionUrl(value) {
  const actionUrl = String(value || '');
  return actionUrl.startsWith('/') && !actionUrl.startsWith('//') ? actionUrl : '/notifications';
}

function mapNotification(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    eventType: row.event_type,
    priority: row.priority,
    title: row.title,
    body: row.body,
    actionUrl: safeActionUrl(row.action_url),
    sourceType: row.source_type,
    sourceId: Number(row.source_id),
    actorUserId: numberOrNull(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    readAt: row.read_at || null,
    createdAt: row.created_at
  };
}

function mapPreference(row, userId) {
  return {
    userId: Number(row?.user_id ?? userId),
    realtimeEnabled: row?.realtime_enabled ?? true,
    webPushEnabled: row?.web_push_enabled ?? true,
    emailEnabled: row?.email_enabled ?? true,
    smsEnabled: row?.sms_enabled ?? true,
    emailDelayMinutes: Number(row?.email_delay_minutes ?? 15)
  };
}

export function createNotificationRepository(queryTarget) {
  return {
    async listForUser(userId, { limit = 50, unreadOnly = false } = {}) {
      const result = await queryTarget.query(`
        SELECT n.*, actor.display_name AS actor_display_name
        FROM notifications n
        LEFT JOIN users actor ON actor.id = n.actor_user_id
        WHERE n.user_id = $1
          AND ($2::boolean = false OR n.read_at IS NULL)
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $3
      `, [userId, unreadOnly, Math.min(Math.max(Number(limit) || 50, 1), 100)]);
      return result.rows.map(mapNotification);
    },

    async listAfterId(userId, afterId, limit = 20) {
      const result = await queryTarget.query(`
        SELECT n.*, actor.display_name AS actor_display_name
        FROM notifications n
        LEFT JOIN users actor ON actor.id = n.actor_user_id
        WHERE n.user_id = $1
          AND n.id > $2
        ORDER BY n.id ASC
        LIMIT $3
      `, [userId, Number(afterId) || 0, Math.min(Math.max(Number(limit) || 20, 1), 100)]);
      return result.rows.map(mapNotification);
    },

    async countUnread(userId) {
      const result = await queryTarget.query(`
        SELECT count(*)::integer AS count
        FROM notifications
        WHERE user_id = $1 AND read_at IS NULL
      `, [userId]);
      return Number(result.rows[0]?.count || 0);
    },

    async markRead(userId, notificationId) {
      const result = await queryTarget.query(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2
        RETURNING *
      `, [notificationId, userId]);
      return mapNotification(result.rows[0]);
    },

    async markAllRead(userId) {
      const result = await queryTarget.query(`
        UPDATE notifications
        SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL
      `, [userId]);
      return result.rowCount;
    },

    async getPreference(userId) {
      const result = await queryTarget.query(`
        SELECT * FROM notification_preferences WHERE user_id = $1
      `, [userId]);
      return mapPreference(result.rows[0], userId);
    },

    async savePreference(userId, preference) {
      const result = await queryTarget.query(`
        INSERT INTO notification_preferences (
          user_id, realtime_enabled, web_push_enabled, email_enabled,
          sms_enabled, email_delay_minutes, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (user_id) DO UPDATE SET
          realtime_enabled = EXCLUDED.realtime_enabled,
          web_push_enabled = EXCLUDED.web_push_enabled,
          email_enabled = EXCLUDED.email_enabled,
          sms_enabled = EXCLUDED.sms_enabled,
          email_delay_minutes = EXCLUDED.email_delay_minutes,
          updated_at = now()
        RETURNING *
      `, [
        userId,
        preference.realtimeEnabled,
        preference.webPushEnabled,
        preference.emailEnabled,
        preference.smsEnabled,
        preference.emailDelayMinutes
      ]);
      return mapPreference(result.rows[0], userId);
    },

    async upsertPushSubscription(userId, subscription, userAgent = '') {
      const result = await queryTarget.query(`
        INSERT INTO web_push_subscriptions (
          user_id, endpoint, p256dh, auth, user_agent, updated_at, revoked_at
        )
        VALUES ($1, $2, $3, $4, $5, now(), NULL)
        ON CONFLICT (endpoint) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent,
          updated_at = now(),
          revoked_at = NULL
        RETURNING id
      `, [
        userId,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        String(userAgent || '').slice(0, 1000)
      ]);
      return { id: Number(result.rows[0].id) };
    },

    async revokePushSubscription(userId, endpoint) {
      const result = await queryTarget.query(`
        UPDATE web_push_subscriptions
        SET revoked_at = now(), updated_at = now()
        WHERE user_id = $1 AND endpoint = $2 AND revoked_at IS NULL
      `, [userId, endpoint]);
      return result.rowCount;
    },

    async listActivePushSubscriptions(userId) {
      const result = await queryTarget.query(`
        SELECT id, endpoint, p256dh, auth
        FROM web_push_subscriptions
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY updated_at DESC
      `, [userId]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      }));
    },

    async revokePushEndpoint(endpoint) {
      await queryTarget.query(`
        UPDATE web_push_subscriptions
        SET revoked_at = now(), updated_at = now()
        WHERE endpoint = $1
      `, [endpoint]);
    },

    async claimDueDeliveries(limit = 20) {
      const result = await queryTarget.query(`
        WITH due AS (
          SELECT id
          FROM notification_deliveries
          WHERE attempts < 5
            AND available_after <= now()
            AND (
              status IN ('pending', 'failed')
              OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
            )
          ORDER BY available_after ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        ), claimed AS (
          UPDATE notification_deliveries d
          SET status = 'processing', attempts = attempts + 1, updated_at = now()
          FROM due
          WHERE d.id = due.id
          RETURNING d.*
        )
        SELECT
          claimed.*,
          n.user_id,
          n.event_type,
          n.priority,
          n.title,
          n.body,
          n.action_url,
          n.read_at,
          u.display_name,
          u.email,
          u.phone,
          COALESCE(p.web_push_enabled, true) AS web_push_enabled,
          COALESCE(p.email_enabled, true) AS email_enabled,
          COALESCE(p.sms_enabled, true) AS sms_enabled
        FROM claimed
        JOIN notifications n ON n.id = claimed.notification_id
        JOIN users u ON u.id = n.user_id
        LEFT JOIN notification_preferences p ON p.user_id = n.user_id
        ORDER BY claimed.id ASC
      `, [Math.min(Math.max(Number(limit) || 20, 1), 100)]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        notificationId: Number(row.notification_id),
        channel: row.channel,
        attempts: Number(row.attempts),
        userId: Number(row.user_id),
        eventType: row.event_type,
        priority: row.priority,
        title: row.title,
        body: row.body,
        actionUrl: row.action_url,
        readAt: row.read_at || null,
        displayName: row.display_name,
        email: row.email || '',
        phone: row.phone || '',
        channelEnabled: row.channel === 'web_push'
          ? row.web_push_enabled
          : row.channel === 'email'
            ? row.email_enabled
            : row.sms_enabled
      }));
    },

    async completeDelivery(deliveryId, { status, providerMessageId = null, error = null }) {
      await queryTarget.query(`
        UPDATE notification_deliveries
        SET
          status = $2,
          provider_message_id = $3,
          last_error = $4,
          sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
          available_after = CASE WHEN $2 = 'failed' THEN now() + interval '5 minutes' ELSE available_after END,
          updated_at = now()
        WHERE id = $1
      `, [deliveryId, status, providerMessageId, error ? String(error).slice(0, 2000) : null]);
    }
  };
}
