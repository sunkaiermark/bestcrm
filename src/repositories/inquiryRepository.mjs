function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function textOrEmpty(value) {
  return value || '';
}

function mapInquiryRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    source: row.source,
    submissionType: textOrEmpty(row.submission_type) || 'standard',
    sourceChannel: textOrEmpty(row.source_channel) || 'other',
    sourceReference: textOrEmpty(row.source_reference),
    sourceReceivedAt: row.source_received_at,
    subject: textOrEmpty(row.subject),
    companyName: textOrEmpty(row.company_name),
    contactName: textOrEmpty(row.contact_name),
    contactEmail: textOrEmpty(row.contact_email),
    contactPhone: textOrEmpty(row.contact_phone),
    country: textOrEmpty(row.country),
    productInterest: textOrEmpty(row.product_interest),
    opportunityType: textOrEmpty(row.opportunity_type),
    requirementText: row.requirement_text,
    rawPayload: row.raw_payload || {},
    priority: row.priority,
    status: row.status,
    assignedUserId: numberOrNull(row.assigned_user_id),
    assignedDisplayName: textOrEmpty(row.assigned_display_name),
    recommendedSalespersonId: numberOrNull(row.recommended_salesperson_id),
    recommendedSalespersonDisplayName: textOrEmpty(row.recommended_salesperson_display_name),
    matchedCustomerId: numberOrNull(row.matched_customer_id),
    matchedCustomerName: textOrEmpty(row.matched_customer_name),
    matchedContactId: numberOrNull(row.matched_contact_id),
    matchedContactCode: textOrEmpty(row.matched_contact_code),
    matchedContactName: textOrEmpty(row.matched_contact_name),
    convertedOpportunityId: numberOrNull(row.converted_opportunity_id),
    convertedOpportunityNo: textOrEmpty(row.converted_opportunity_no),
    convertedOpportunityTitle: textOrEmpty(row.converted_opportunity_title),
    convertedSalespersonId: numberOrNull(row.converted_salesperson_id),
    createdBy: numberOrNull(row.created_by),
    createdByDisplayName: textOrEmpty(row.created_by_display_name),
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewedByDisplayName: textOrEmpty(row.reviewed_by_display_name),
    reviewedAt: row.reviewed_at,
    reviewNote: textOrEmpty(row.review_note),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const inquirySelect = `
  SELECT
    i.id,
    i.source,
    i.submission_type,
    i.source_channel,
    i.source_reference,
    i.source_received_at,
    i.subject,
    i.company_name,
    i.contact_name,
    i.contact_email,
    i.contact_phone,
    i.country,
    i.product_interest,
    i.opportunity_type,
    i.requirement_text,
    i.raw_payload,
    i.priority,
    i.status,
    i.assigned_user_id,
    assigned.display_name AS assigned_display_name,
    i.recommended_salesperson_id,
    recommended_salesperson.display_name AS recommended_salesperson_display_name,
    i.matched_customer_id,
    matched_customer.name AS matched_customer_name,
    i.matched_contact_id,
    matched_contact.contact_code AS matched_contact_code,
    matched_contact.name AS matched_contact_name,
    i.converted_opportunity_id,
    converted.opportunity_no AS converted_opportunity_no,
    converted.title AS converted_opportunity_title,
    converted.salesperson_id AS converted_salesperson_id,
    i.created_by,
    creator.display_name AS created_by_display_name,
    i.reviewed_by,
    reviewer.display_name AS reviewed_by_display_name,
    i.reviewed_at,
    i.review_note,
    i.created_at,
    i.updated_at
  FROM inquiries i
  LEFT JOIN users assigned ON assigned.id = i.assigned_user_id
  LEFT JOIN users recommended_salesperson ON recommended_salesperson.id = i.recommended_salesperson_id
  LEFT JOIN customers matched_customer ON matched_customer.id = i.matched_customer_id
  LEFT JOIN contacts matched_contact ON matched_contact.id = i.matched_contact_id
  LEFT JOIN opportunities converted ON converted.id = i.converted_opportunity_id
  LEFT JOIN users creator ON creator.id = i.created_by
  LEFT JOIN users reviewer ON reviewer.id = i.reviewed_by
`;

function addFilter(where, params, clause, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  params.push(value);
  where.push(clause.replace('?', `$${params.length}`));
}

function addNotInFilter(where, params, column, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }
  const placeholders = values.map((value) => {
    params.push(value);
    return `$${params.length}`;
  });
  where.push(`${column} NOT IN (${placeholders.join(', ')})`);
}

function addInFilter(where, params, column, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }
  const placeholders = values.map((value) => {
    params.push(value);
    return `$${params.length}`;
  });
  where.push(`${column} IN (${placeholders.join(', ')})`);
}

const listReceivedAtSql = `CASE
  WHEN i.source_received_at > now() + interval '1 day' THEN i.created_at
  ELSE COALESCE(i.source_received_at, i.created_at)
END`;

function buildInquiryListFilter(filter = {}) {
  const where = [];
  const params = [];
  addFilter(where, params, 'i.status = ?', filter.status);
  addFilter(where, params, 'i.source = ?', filter.source);
  addFilter(where, params, 'i.assigned_user_id = ?', filter.assignedUserId);
  addFilter(where, params, 'i.created_by = ?', filter.createdBy);
  addFilter(where, params, 'i.submission_type = ?', filter.submissionType);
  addInFilter(where, params, 'i.status', filter.statuses);
  addNotInFilter(where, params, 'i.status', filter.excludeStatuses);
  if (filter.visibleToUserId) {
    params.push(filter.visibleToUserId);
    where.push(`(i.assigned_user_id = $${params.length} OR i.created_by = $${params.length})`);
  }
  if (filter.searchTerm) {
    params.push(`%${String(filter.searchTerm).replace(/[\\%_]/g, '\\$&')}%`);
    const searchParam = `$${params.length}`;
    where.push(`(
      i.subject ILIKE ${searchParam} ESCAPE '\\'
      OR i.company_name ILIKE ${searchParam} ESCAPE '\\'
      OR i.contact_name ILIKE ${searchParam} ESCAPE '\\'
      OR i.contact_email ILIKE ${searchParam} ESCAPE '\\'
    )`);
  }
  if (filter.dateFrom) {
    params.push(filter.dateFrom);
    where.push(`(${listReceivedAtSql} AT TIME ZONE 'Asia/Singapore')::date >= $${params.length}::date`);
  }
  if (filter.dateTo) {
    params.push(filter.dateTo);
    where.push(`(${listReceivedAtSql} AT TIME ZONE 'Asia/Singapore')::date <= $${params.length}::date`);
  }
  return { where, params };
}

export function createInquiryRepository(queryTarget) {
  return {
    async listInquiries(filter = {}) {
      const { where, params } = buildInquiryListFilter(filter);
      const limit = Number.isSafeInteger(Number(filter.limit)) && Number(filter.limit) > 0
        ? Math.min(Number(filter.limit), 500)
        : null;
      const offset = Number.isSafeInteger(Number(filter.offset)) && Number(filter.offset) >= 0
        ? Number(filter.offset)
        : 0;
      let paginationSql = '';
      if (limit) {
        params.push(limit);
        paginationSql += `LIMIT $${params.length}`;
        params.push(offset);
        paginationSql += ` OFFSET $${params.length}`;
      }
      const result = await queryTarget.query(`
        ${inquirySelect}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY
          CASE i.status
            WHEN 'new' THEN 1
            WHEN 'returned' THEN 2
            WHEN 'reviewing' THEN 3
            WHEN 'customer_approval_pending' THEN 4
            WHEN 'converted' THEN 5
            WHEN 'rejected' THEN 6
            ELSE 7
          END,
          ${listReceivedAtSql} DESC,
          i.id DESC
        ${paginationSql}
      `, params);
      return result.rows.map(mapInquiryRow);
    },

    async countInquiries(filter = {}) {
      const { where, params } = buildInquiryListFilter(filter);
      const result = await queryTarget.query(`
        SELECT count(*)::int AS count
        FROM inquiries i
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      `, params);
      return Number(result.rows[0]?.count || 0);
    },

    async findById(id) {
      const result = await queryTarget.query(`
        ${inquirySelect}
        WHERE i.id = $1
        LIMIT 1
      `, [id]);
      return mapInquiryRow(result.rows[0]);
    },

    async findLeadByIdForUpdate(id) {
      const result = await queryTarget.query(`
        ${inquirySelect}
        WHERE i.id = $1
          AND i.submission_type = 'sales_lead'
        LIMIT 1
        FOR UPDATE OF i
      `, [id]);
      return mapInquiryRow(result.rows[0]);
    },

    async createInquiry(input) {
      const result = await queryTarget.query(`
        INSERT INTO inquiries (
          source,
          submission_type,
          source_channel,
          source_reference,
          source_received_at,
          subject,
          company_name,
          contact_name,
          contact_email,
          contact_phone,
          country,
          product_interest,
          opportunity_type,
          requirement_text,
          raw_payload,
          priority,
          status,
          assigned_user_id,
          recommended_salesperson_id,
          matched_customer_id,
          matched_contact_id,
          created_by,
          review_note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20, $21, $22, $23)
        ON CONFLICT (source, source_reference) WHERE source_reference <> ''
        DO NOTHING
        RETURNING *
      `, [
        input.source,
        input.submissionType || 'standard',
        input.sourceChannel || input.source || 'other',
        input.sourceReference,
        input.sourceReceivedAt,
        input.subject,
        input.companyName,
        input.contactName,
        input.contactEmail,
        input.contactPhone,
        input.country,
        input.productInterest,
        input.opportunityType,
        input.requirementText,
        JSON.stringify(input.rawPayload || {}),
        input.priority,
        input.status,
        input.assignedUserId,
        input.recommendedSalespersonId || null,
        input.matchedCustomerId,
        input.matchedContactId,
        input.createdBy,
        input.reviewNote
      ]);
      const created = mapInquiryRow(result.rows[0]);
      if (created) {
        created.wasDuplicate = false;
        return created;
      }
      if (!input.sourceReference) {
        throw new Error('Inquiry was not created');
      }
      const existing = await queryTarget.query(`
        ${inquirySelect}
        WHERE i.source = $1 AND i.source_reference = $2
        LIMIT 1
      `, [input.source, input.sourceReference]);
      const duplicate = mapInquiryRow(existing.rows[0]);
      if (!duplicate) {
        throw new Error('Duplicate inquiry could not be loaded');
      }
      duplicate.wasDuplicate = true;
      return duplicate;
    },

    async updateReview(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET
          status = $1,
          priority = $2,
          assigned_user_id = $3,
          matched_customer_id = $4,
          matched_contact_id = $5,
          subject = $6,
          company_name = $7,
          contact_name = $8,
          contact_email = $9,
          contact_phone = $10,
          country = $11,
          product_interest = $12,
          opportunity_type = $13,
          requirement_text = $14,
          review_note = $15,
          reviewed_by = $16,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = $17
          AND status IN ('new', 'reviewing')
        RETURNING *
      `, [
        input.status,
        input.priority,
        input.assignedUserId,
        input.matchedCustomerId,
        input.matchedContactId,
        input.subject,
        input.companyName,
        input.contactName,
        input.contactEmail,
        input.contactPhone,
        input.country,
        input.productInterest,
        input.opportunityType,
        input.requirementText,
        input.reviewNote,
        input.reviewedBy,
        id
      ]);
      return mapInquiryRow(result.rows[0]);
    },

    async markConverted(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET
          status = 'converted',
          matched_customer_id = $1,
          matched_contact_id = $2,
          converted_opportunity_id = $3,
          reviewed_by = $4,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = $5
          AND status IN ('new', 'reviewing')
        RETURNING *
      `, [
        input.matchedCustomerId,
        input.matchedContactId,
        input.convertedOpportunityId,
        input.reviewedBy,
        id
      ]);
      return mapInquiryRow(result.rows[0]);
    },

    async returnLead(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET
          status = 'returned',
          review_note = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = $1
          AND submission_type = 'sales_lead'
          AND status = 'new'
          AND assigned_user_id = $3
        RETURNING *
      `, [id, input.reason, input.actorUserId]);
      return mapInquiryRow(result.rows[0]);
    },

    async rejectLead(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET
          status = 'rejected',
          review_note = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = $1
          AND submission_type = 'sales_lead'
          AND status = 'new'
          AND assigned_user_id = $3
        RETURNING *
      `, [id, input.reason, input.actorUserId]);
      return mapInquiryRow(result.rows[0]);
    },

    async resubmitLead(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET
          status = 'new',
          source_channel = $2,
          subject = $3,
          company_name = $4,
          contact_name = $5,
          contact_email = $6,
          contact_phone = $7,
          country = $8,
          product_interest = $9,
          opportunity_type = $10,
          requirement_text = $11,
          priority = $12,
          assigned_user_id = $13,
          recommended_salesperson_id = $14,
          review_note = '',
          reviewed_by = NULL,
          reviewed_at = NULL,
          updated_at = now()
        WHERE id = $1
          AND submission_type = 'sales_lead'
          AND status = 'returned'
          AND created_by = $15
        RETURNING *
      `, [
        id,
        input.sourceChannel,
        input.subject,
        input.companyName,
        input.contactName,
        input.contactEmail,
        input.contactPhone,
        input.country,
        input.productInterest,
        input.opportunityType,
        input.requirementText,
        input.priority,
        input.assignedUserId,
        input.recommendedSalespersonId,
        input.actorUserId
      ]);
      return mapInquiryRow(result.rows[0]);
    },

    async reassignLeadReviewer(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET assigned_user_id = $2, updated_at = now()
        WHERE id = $1
          AND submission_type = 'sales_lead'
          AND status IN ('new', 'returned')
        RETURNING *
      `, [id, input.assignedUserId]);
      return mapInquiryRow(result.rows[0]);
    },

    async createLeadReviewEvent(input) {
      const result = await queryTarget.query(`
        INSERT INTO lead_review_events (
          inquiry_id,
          event_type,
          from_status,
          to_status,
          actor_user_id,
          assigned_user_id,
          opportunity_id,
          reason,
          details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
      `, [
        input.inquiryId,
        input.eventType,
        input.fromStatus,
        input.toStatus,
        input.actorUserId,
        input.assignedUserId || null,
        input.opportunityId || null,
        input.reason || '',
        JSON.stringify(input.details || {})
      ]);
      return result.rows[0] || null;
    },

    async listLeadReviewEvents(inquiryId) {
      const result = await queryTarget.query(`
        SELECT
          event.id,
          event.inquiry_id,
          event.event_type,
          event.from_status,
          event.to_status,
          event.actor_user_id,
          actor.display_name AS actor_display_name,
          event.assigned_user_id,
          assigned.display_name AS assigned_display_name,
          event.opportunity_id,
          opportunity.opportunity_no,
          event.reason,
          event.details,
          event.created_at
        FROM lead_review_events event
        JOIN users actor ON actor.id = event.actor_user_id
        LEFT JOIN users assigned ON assigned.id = event.assigned_user_id
        LEFT JOIN opportunities opportunity ON opportunity.id = event.opportunity_id
        WHERE event.inquiry_id = $1
        ORDER BY event.id
      `, [inquiryId]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        inquiryId: Number(row.inquiry_id),
        eventType: row.event_type,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        actorUserId: Number(row.actor_user_id),
        actorDisplayName: row.actor_display_name || '',
        assignedUserId: numberOrNull(row.assigned_user_id),
        assignedDisplayName: row.assigned_display_name || '',
        opportunityId: numberOrNull(row.opportunity_id),
        opportunityNo: row.opportunity_no || '',
        reason: row.reason || '',
        details: row.details || {},
        createdAt: row.created_at
      }));
    },

    async markDisposition(id, input) {
      const result = await queryTarget.query(`
        UPDATE inquiries
        SET
          status = $1,
          matched_customer_id = $2,
          matched_contact_id = $3,
          review_note = $4,
          reviewed_by = $5,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = $6
          AND status IN ('new', 'reviewing')
        RETURNING *
      `, [
        input.status,
        input.matchedCustomerId,
        input.matchedContactId,
        input.reviewNote,
        input.reviewedBy,
        id
      ]);
      return mapInquiryRow(result.rows[0]);
    },

    async deleteById(id) {
      const result = await queryTarget.query(`
        DELETE FROM inquiries
        WHERE id = $1
      `, [id]);
      return result.rowCount > 0;
    }
  };
}
