const ACTIVATION_MIGRATION = '105_email_reply_accountability.sql';

function mapState(row) {
  return {
    messageId: Number(row.message_id),
    receivedAt: row.sla_received_at,
    dueAt: row.due_at,
    confirmedBy: row.confirmed_by === null ? null : Number(row.confirmed_by),
    confirmedByName: row.confirmed_by_name || '',
    confirmedAt: row.confirmed_at || null,
    repliedAt: row.replied_at || null,
    tracked: row.tracked === true,
    overdue: row.overdue === true
  };
}

export function createEmailResponseRepository(queryTarget) {
  return {
    async listThreadStates(threadId, ownerUserId, at = new Date()) {
      const result = await queryTarget.query(`
        SELECT
          inbound.id AS message_id,
          COALESCE(inbound.mailbox_received_at, inbound.created_at) AS sla_received_at,
          COALESCE(inbound.mailbox_received_at, inbound.created_at) + interval '8 hours' AS due_at,
          receipt.user_id AS confirmed_by,
          owner.display_name AS confirmed_by_name,
          receipt.confirmed_at,
          bestcrm_email_customer_reply_at(inbound.id) AS replied_at,
          (inbound.created_at >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) >= activation.applied_at) AS tracked,
          (COALESCE(inbound.mailbox_received_at, inbound.created_at) + interval '8 hours' <= $3::timestamptz
            AND bestcrm_email_customer_reply_at(inbound.id) IS NULL
            AND inbound.created_at >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) >= activation.applied_at) AS overdue
        FROM email_messages inbound
        JOIN schema_migrations activation ON activation.name = $4
        LEFT JOIN email_message_owner_acknowledgments receipt
          ON receipt.message_id = inbound.id AND receipt.user_id = $2
        LEFT JOIN users owner ON owner.id = receipt.user_id
        WHERE inbound.thread_id = $1
          AND inbound.direction = 'inbound'
          AND inbound.canonical_message_id IS NULL
        ORDER BY COALESCE(inbound.mailbox_received_at, inbound.created_at), inbound.id
      `, [threadId, ownerUserId || null, at, ACTIVATION_MIGRATION]);
      return result.rows.map(mapState);
    },

    async acknowledge(messageId, ownerUserId, at = new Date()) {
      const result = await queryTarget.query(`
        WITH eligible AS (
          SELECT inbound.id
          FROM email_messages inbound
          JOIN email_threads thread ON thread.id = inbound.thread_id
          JOIN opportunities opportunity ON opportunity.id = thread.opportunity_id
          JOIN schema_migrations activation ON activation.name = $4
          WHERE inbound.id = $1
            AND inbound.direction = 'inbound'
            AND inbound.canonical_message_id IS NULL
            AND thread.archive_disposition = 'active'
            AND thread.triage_status = 'linked_opportunity'
            AND opportunity.salesperson_id = $2
            AND inbound.created_at >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) >= activation.applied_at
        )
        INSERT INTO email_message_owner_acknowledgments (message_id, user_id, confirmed_at)
        SELECT id, $2, $3::timestamptz FROM eligible
        ON CONFLICT (message_id, user_id) DO NOTHING
        RETURNING message_id, user_id, confirmed_at
      `, [messageId, ownerUserId, at, ACTIVATION_MIGRATION]);
      if (result.rows[0]) return mapState({
        message_id: result.rows[0].message_id,
        confirmed_by: result.rows[0].user_id,
        confirmed_at: result.rows[0].confirmed_at
      });
      const existing = await queryTarget.query(`
        SELECT message_id, user_id, confirmed_at
        FROM email_message_owner_acknowledgments
        WHERE message_id = $1 AND user_id = $2
      `, [messageId, ownerUserId]);
      return existing.rows[0] ? mapState({
        message_id: existing.rows[0].message_id,
        confirmed_by: existing.rows[0].user_id,
        confirmed_at: existing.rows[0].confirmed_at
      }) : null;
    },

    async notifyOpportunityAssignment({ threadId, opportunityId, actorUserId }) {
      const result = await queryTarget.query(`
        WITH inserted AS (
          INSERT INTO notifications (
            user_id, event_type, priority, title, body, action_url,
            source_type, source_id, actor_user_id
          )
          SELECT opportunity.salesperson_id, 'email_opportunity_assignment', 'normal',
            '客户邮件已分配',
            concat('商机 ', opportunity.opportunity_no, ' 有新分配的客户邮件，请确认收到并回复。'),
            concat('/email-center/threads/', $1::bigint, '?from=inbox'),
            'email_opportunity_assignment', $1::bigint, $3::bigint
          FROM opportunities opportunity
          WHERE opportunity.id = $2
          ON CONFLICT (user_id, source_type, source_id) DO NOTHING
          RETURNING id, user_id
        ), push AS (
          INSERT INTO notification_deliveries (notification_id, channel)
          SELECT inserted.id, 'web_push'
          FROM inserted
          LEFT JOIN notification_preferences preference ON preference.user_id = inserted.user_id
          WHERE COALESCE(preference.web_push_enabled, true)
          ON CONFLICT DO NOTHING
          RETURNING id
        ), announced AS (
          SELECT pg_notify('bestcrm_notifications', user_id::text) FROM inserted
        )
        SELECT (SELECT count(*) FROM inserted)::integer AS created,
          (SELECT count(*) FROM push)::integer AS queued_push,
          (SELECT count(*) FROM announced)::integer AS announced
      `, [threadId, opportunityId, actorUserId]);
      return result.rows[0] || { created: 0, queued_push: 0 };
    },

    async queueDueLinkedReminders(at = new Date()) {
      const result = await queryTarget.query(`
        WITH missing AS (
          SELECT DISTINCT inbound.id AS message_id,
            opportunity.opportunity_no, recipient.user_id
          FROM email_messages inbound
          JOIN email_threads thread ON thread.id = inbound.thread_id
          JOIN opportunities opportunity ON opportunity.id = thread.opportunity_id
          CROSS JOIN LATERAL (VALUES (opportunity.salesperson_id), (opportunity.sales_manager_id)) recipient(user_id)
          JOIN users recipient_user ON recipient_user.id = recipient.user_id AND recipient_user.is_active
          JOIN schema_migrations activation ON activation.name = $2
          WHERE inbound.direction = 'inbound'
            AND inbound.canonical_message_id IS NULL
            AND inbound.archive_disposition = 'active'
            AND thread.archive_disposition = 'active'
            AND thread.triage_status = 'linked_opportunity'
            AND inbound.created_at >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) <= $1::timestamptz - interval '8 hours'
            AND bestcrm_email_customer_reply_at(inbound.id) IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM notifications prior
              WHERE prior.user_id = recipient.user_id
                AND prior.source_type = 'email_reply_overdue'
                AND prior.source_id = inbound.id
            )
          LIMIT 100
        ), inserted AS (
          INSERT INTO notifications (
            user_id, event_type, priority, title, body, action_url, source_type, source_id
          )
          SELECT missing.user_id, 'email_reply_overdue', 'critical',
            '客户邮件 8 小时未回复',
            concat('商机 ', missing.opportunity_no, ' 的客户邮件已超过 8 个自然小时未回复。'),
            concat('/email-center/messages/', missing.message_id, '/response'),
            'email_reply_overdue', missing.message_id
          FROM missing
          WHERE true
          ON CONFLICT (user_id, source_type, source_id) DO NOTHING
          RETURNING id, user_id
        ), sms AS (
          INSERT INTO notification_deliveries (notification_id, channel)
          SELECT inserted.id, 'sms'
          FROM inserted
          LEFT JOIN notification_preferences preference ON preference.user_id = inserted.user_id
          WHERE COALESCE(preference.sms_enabled, true)
          ON CONFLICT DO NOTHING
          RETURNING id
        ), announced AS (
          SELECT pg_notify('bestcrm_notifications', user_id::text) FROM inserted
        )
        SELECT (SELECT count(*) FROM inserted)::integer AS created,
          (SELECT count(*) FROM sms)::integer AS queued_sms,
          (SELECT count(*) FROM announced)::integer AS announced
      `, [at, ACTIVATION_MIGRATION]);
      return result.rows[0] || { created: 0, queued_sms: 0 };
    },

    async queueDueUnassignedReminders(at = new Date()) {
      const result = await queryTarget.query(`
        WITH missing AS (
          SELECT DISTINCT inbound.id AS message_id, recipient_user.id AS user_id
          FROM email_messages inbound
          JOIN email_threads thread ON thread.id = inbound.thread_id
          JOIN schema_migrations activation ON activation.name = $2
          JOIN users recipient_user ON recipient_user.is_active
          JOIN user_roles user_role ON user_role.user_id = recipient_user.id
          JOIN roles role ON role.id = user_role.role_id
            AND role.code IN ('administrator', 'sales_manager')
          WHERE inbound.direction = 'inbound'
            AND inbound.canonical_message_id IS NULL
            AND inbound.archive_disposition = 'active'
            AND thread.archive_disposition = 'active'
            AND thread.triage_status = 'pending'
            AND thread.opportunity_id IS NULL
            AND (
              lower(btrim(thread.mailbox_key)) = 'sales@sunkaier.com'
              OR EXISTS (
                SELECT 1
                FROM email_messages thread_message
                JOIN email_message_mailbox_deliveries delivery
                  ON delivery.message_id = thread_message.id
                WHERE thread_message.thread_id = thread.id
                  AND lower(btrim(delivery.mailbox_key)) = 'sales@sunkaier.com'
              )
            )
            AND inbound.classification_category IN ('inquiry', 'known_contact', 'conversation')
            AND inbound.created_at >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) >= activation.applied_at
            AND COALESCE(inbound.mailbox_received_at, inbound.created_at) <= $1::timestamptz - interval '8 hours'
            AND NOT EXISTS (
              SELECT 1 FROM notifications prior
              WHERE prior.user_id = recipient_user.id
                AND prior.source_type = 'email_unassigned_overdue'
                AND prior.source_id = inbound.id
            )
          LIMIT 100
        ), inserted AS (
          INSERT INTO notifications (
            user_id, event_type, priority, title, body, action_url, source_type, source_id
          )
          SELECT user_id, 'email_unassigned_overdue', 'high',
            '客户邮件尚未分配商机',
            '客户邮件已到达 8 个自然小时，尚未分配商机，请及时处理。',
            concat('/email-center/messages/', message_id, '/response'),
            'email_unassigned_overdue', message_id
          FROM missing
          WHERE true
          ON CONFLICT (user_id, source_type, source_id) DO NOTHING
          RETURNING id, user_id
        ), announced AS (
          SELECT pg_notify('bestcrm_notifications', user_id::text) FROM inserted
        )
        SELECT (SELECT count(*) FROM inserted)::integer AS created,
          (SELECT count(*) FROM announced)::integer AS announced
      `, [at, ACTIVATION_MIGRATION]);
      return result.rows[0] || { created: 0 };
    }
  };
}
