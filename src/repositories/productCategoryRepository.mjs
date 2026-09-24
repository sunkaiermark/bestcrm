const recordTables = Object.freeze({
  inquiry: 'inquiries',
  opportunity: 'opportunities',
  email_thread: 'email_threads'
});

const evidenceSql = `
  SELECT category.code, 'opportunity'::text AS record_type, opportunity.id AS record_id,
    opportunity.customer_id, opportunity.created_at AS occurred_at
  FROM opportunities opportunity
  CROSS JOIN LATERAL unnest(opportunity.confirmed_product_category_codes) AS category(code)
  WHERE opportunity.deleted_at IS NULL
  UNION ALL
  SELECT category.code, 'inquiry', inquiry.id,
    coalesce(inquiry.matched_customer_id, converted_opportunity.customer_id), inquiry.created_at
  FROM inquiries inquiry
  CROSS JOIN LATERAL unnest(inquiry.confirmed_product_category_codes) AS category(code)
  LEFT JOIN opportunities converted_opportunity
    ON converted_opportunity.id = inquiry.converted_opportunity_id
      AND converted_opportunity.deleted_at IS NULL
  WHERE inquiry.status NOT IN ('spam', 'duplicate', 'rejected')
  UNION ALL
  SELECT category.code, 'email_thread', thread.id,
    coalesce(thread.customer_id, thread_opportunity.customer_id, thread_inquiry.matched_customer_id),
    thread.last_message_at
  FROM email_threads thread
  CROSS JOIN LATERAL unnest(thread.confirmed_product_category_codes) AS category(code)
  LEFT JOIN opportunities thread_opportunity
    ON thread_opportunity.id = thread.opportunity_id
      AND thread_opportunity.deleted_at IS NULL
  LEFT JOIN inquiries thread_inquiry ON thread_inquiry.id = thread.inquiry_id
  WHERE thread.archive_disposition <> 'spam'
    AND thread.triage_status NOT IN ('spam', 'archived')
`;

const pendingBusinessSql = `
  SELECT 'inquiry'::text AS record_type, inquiry.id,
    inquiry.subject, inquiry.product_interest,
    left(inquiry.requirement_text, 2000) AS requirement_text,
    inquiry.created_at AS occurred_at, inquiry.submission_type
  FROM inquiries inquiry
  WHERE inquiry.product_category_reviewed_at IS NULL
    AND inquiry.status NOT IN ('spam', 'duplicate', 'rejected')
  UNION ALL
  SELECT 'opportunity', opportunity.id,
    opportunity.title, opportunity.product_interest,
    left(opportunity.requirement, 2000), opportunity.created_at, NULL::text
  FROM opportunities opportunity
  WHERE opportunity.product_category_reviewed_at IS NULL
    AND opportunity.deleted_at IS NULL
`;

export function createProductCategoryRepository(queryTarget) {
  return {
    async setConfirmed(recordType, recordId, codes, actorUserId) {
      const table = recordTables[recordType];
      if (!table) throw new Error('Invalid product category record type');
      const result = await queryTarget.query(`
        UPDATE ${table}
        SET confirmed_product_category_codes = $2::text[],
            product_category_reviewed_by = $3,
            product_category_reviewed_at = now(),
            updated_at = now()
        WHERE id = $1
        ${recordType === 'opportunity' ? 'AND deleted_at IS NULL' : ''}
        RETURNING id, confirmed_product_category_codes, product_category_reviewed_at
      `, [recordId, codes, actorUserId]);
      return result.rows[0] || null;
    },

    async listReviewEvents(recordType, recordId) {
      const result = await queryTarget.query(`
        SELECT event.id, event.previous_codes, event.confirmed_codes,
          event.created_at, actor.display_name AS actor_name
        FROM product_category_review_events event
        LEFT JOIN users actor ON actor.id = event.actor_user_id
        WHERE event.record_type = $1 AND event.record_id = $2
        ORDER BY event.id DESC
      `, [recordType, recordId]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        previousCodes: row.previous_codes || [],
        confirmedCodes: row.confirmed_codes || [],
        createdAt: row.created_at,
        actorName: row.actor_name || ''
      }));
    },

    async categorySummary({ year = null } = {}) {
      const result = await queryTarget.query(`
        WITH evidence AS (${evidenceSql})
        SELECT code,
          count(DISTINCT customer_id)::int AS customer_count,
          count(DISTINCT record_id) FILTER (WHERE record_type = 'opportunity')::int AS opportunity_count,
          count(DISTINCT record_id) FILTER (WHERE record_type = 'inquiry')::int AS inquiry_count,
          count(DISTINCT record_id) FILTER (WHERE record_type = 'email_thread')::int AS email_thread_count,
          count(*) FILTER (WHERE customer_id IS NULL)::int AS unlinked_count
        FROM evidence
        WHERE ($1::int IS NULL OR EXTRACT(YEAR FROM occurred_at AT TIME ZONE 'Asia/Singapore') = $1)
        GROUP BY code
        ORDER BY code
      `, [year]);
      return result.rows.map((row) => ({
        code: row.code,
        customerCount: Number(row.customer_count),
        opportunityCount: Number(row.opportunity_count),
        inquiryCount: Number(row.inquiry_count),
        emailThreadCount: Number(row.email_thread_count),
        unlinkedCount: Number(row.unlinked_count)
      }));
    },

    async customersForCategory(code, { year = null } = {}) {
      const result = await queryTarget.query(`
        WITH evidence AS (${evidenceSql})
        SELECT customer.id, customer.customer_code, customer.name,
          count(DISTINCT evidence.record_id) FILTER (WHERE evidence.record_type = 'opportunity')::int AS opportunity_count,
          count(DISTINCT evidence.record_id) FILTER (WHERE evidence.record_type = 'inquiry')::int AS inquiry_count,
          count(DISTINCT evidence.record_id) FILTER (WHERE evidence.record_type = 'email_thread')::int AS email_thread_count,
          max(evidence.occurred_at) AS last_activity_at
        FROM evidence
        JOIN customers customer ON customer.id = evidence.customer_id
        WHERE evidence.code = $1
          AND ($2::int IS NULL OR EXTRACT(YEAR FROM evidence.occurred_at AT TIME ZONE 'Asia/Singapore') = $2)
        GROUP BY customer.id, customer.customer_code, customer.name
        ORDER BY last_activity_at DESC, customer.id DESC
      `, [code, year]);
      return result.rows.map((row) => ({
        customerId: Number(row.id),
        customerCode: row.customer_code || '',
        customerName: row.name,
        opportunityCount: Number(row.opportunity_count),
        inquiryCount: Number(row.inquiry_count),
        emailThreadCount: Number(row.email_thread_count),
        lastActivityAt: row.last_activity_at
      }));
    },

    async pendingBusinessReview({ limit = 30, offset = 0 } = {}) {
      const [countResult, listResult] = await Promise.all([
        queryTarget.query(`SELECT count(*)::int AS total FROM (${pendingBusinessSql}) pending`),
        queryTarget.query(`
          SELECT * FROM (${pendingBusinessSql}) pending
          ORDER BY occurred_at DESC, record_type, id DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset])
      ]);
      return {
        total: Number(countResult.rows[0]?.total || 0),
        rows: listResult.rows.map((row) => ({
          recordType: row.record_type,
          id: Number(row.id),
          subject: row.subject || '',
          productInterest: row.product_interest || '',
          requirementText: row.requirement_text || '',
          occurredAt: row.occurred_at,
          submissionType: row.submission_type || ''
        }))
      };
    },

    async pendingEmailReview({ limit = 30, offset = 0 } = {}) {
      const [countResult, listResult] = await Promise.all([
        queryTarget.query(`
          SELECT count(*)::int AS total
          FROM email_threads thread
          WHERE thread.product_category_reviewed_at IS NULL
            AND thread.archive_disposition = 'active'
            AND thread.triage_status NOT IN ('spam', 'archived')
        `),
        queryTarget.query(`
          SELECT thread.id, thread.subject, thread.last_message_at,
            sample.body_text
          FROM email_threads thread
          LEFT JOIN LATERAL (
            SELECT string_agg(recent.text_body, E'\\n') AS body_text
            FROM (
              SELECT left(coalesce(message.text_body, ''), 2000) AS text_body
              FROM email_messages message
              WHERE message.thread_id = thread.id
                AND message.direction = 'inbound'
                AND message.canonical_message_id IS NULL
              ORDER BY message.received_at DESC, message.id DESC
              LIMIT 4
            ) recent
          ) sample ON true
          WHERE thread.product_category_reviewed_at IS NULL
            AND thread.archive_disposition = 'active'
            AND thread.triage_status NOT IN ('spam', 'archived')
          ORDER BY thread.last_message_at DESC, thread.id DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset])
      ]);
      return {
        total: Number(countResult.rows[0]?.total || 0),
        rows: listResult.rows.map((row) => ({
          id: Number(row.id),
          subject: row.subject || '',
          lastMessageAt: row.last_message_at,
          bodyText: row.body_text || ''
        }))
      };
    }
  };
}
