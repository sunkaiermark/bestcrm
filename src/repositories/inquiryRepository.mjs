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
    sourceReference: textOrEmpty(row.source_reference),
    sourceReceivedAt: row.source_received_at,
    subject: textOrEmpty(row.subject),
    companyName: textOrEmpty(row.company_name),
    contactName: textOrEmpty(row.contact_name),
    contactEmail: textOrEmpty(row.contact_email),
    contactPhone: textOrEmpty(row.contact_phone),
    country: textOrEmpty(row.country),
    productInterest: textOrEmpty(row.product_interest),
    requirementText: row.requirement_text,
    rawPayload: row.raw_payload || {},
    priority: row.priority,
    status: row.status,
    assignedUserId: numberOrNull(row.assigned_user_id),
    assignedDisplayName: textOrEmpty(row.assigned_display_name),
    matchedCustomerId: numberOrNull(row.matched_customer_id),
    matchedCustomerName: textOrEmpty(row.matched_customer_name),
    matchedContactId: numberOrNull(row.matched_contact_id),
    matchedContactName: textOrEmpty(row.matched_contact_name),
    convertedOpportunityId: numberOrNull(row.converted_opportunity_id),
    convertedOpportunityNo: textOrEmpty(row.converted_opportunity_no),
    convertedOpportunityTitle: textOrEmpty(row.converted_opportunity_title),
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
    i.source_reference,
    i.source_received_at,
    i.subject,
    i.company_name,
    i.contact_name,
    i.contact_email,
    i.contact_phone,
    i.country,
    i.product_interest,
    i.requirement_text,
    i.raw_payload,
    i.priority,
    i.status,
    i.assigned_user_id,
    assigned.display_name AS assigned_display_name,
    i.matched_customer_id,
    matched_customer.name AS matched_customer_name,
    i.matched_contact_id,
    matched_contact.name AS matched_contact_name,
    i.converted_opportunity_id,
    converted.opportunity_no AS converted_opportunity_no,
    converted.title AS converted_opportunity_title,
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

export function createInquiryRepository(queryTarget) {
  return {
    async listInquiries(filter = {}) {
      const where = [];
      const params = [];
      addFilter(where, params, 'i.status = ?', filter.status);
      addFilter(where, params, 'i.source = ?', filter.source);
      addFilter(where, params, 'i.assigned_user_id = ?', filter.assignedUserId);
      if (filter.visibleToUserId) {
        params.push(filter.visibleToUserId);
        where.push(`(i.assigned_user_id = $${params.length} OR i.created_by = $${params.length})`);
      }
      const result = await queryTarget.query(`
        ${inquirySelect}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY
          CASE i.status
            WHEN 'new' THEN 1
            WHEN 'reviewing' THEN 2
            WHEN 'converted' THEN 3
            ELSE 4
          END,
          COALESCE(i.source_received_at, i.created_at) DESC,
          i.id DESC
      `, params);
      return result.rows.map(mapInquiryRow);
    },

    async findById(id) {
      const result = await queryTarget.query(`
        ${inquirySelect}
        WHERE i.id = $1
        LIMIT 1
      `, [id]);
      return mapInquiryRow(result.rows[0]);
    },

    async createInquiry(input) {
      const result = await queryTarget.query(`
        INSERT INTO inquiries (
          source,
          source_reference,
          source_received_at,
          subject,
          company_name,
          contact_name,
          contact_email,
          contact_phone,
          country,
          product_interest,
          requirement_text,
          raw_payload,
          priority,
          status,
          assigned_user_id,
          matched_customer_id,
          matched_contact_id,
          created_by,
          review_note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `, [
        input.source,
        input.sourceReference,
        input.sourceReceivedAt,
        input.subject,
        input.companyName,
        input.contactName,
        input.contactEmail,
        input.contactPhone,
        input.country,
        input.productInterest,
        input.requirementText,
        JSON.stringify(input.rawPayload || {}),
        input.priority,
        input.status,
        input.assignedUserId,
        input.matchedCustomerId,
        input.matchedContactId,
        input.createdBy,
        input.reviewNote
      ]);
      return mapInquiryRow(result.rows[0]);
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
          review_note = $6,
          reviewed_by = $7,
          reviewed_at = now(),
          updated_at = now()
        WHERE id = $8
        RETURNING *
      `, [
        input.status,
        input.priority,
        input.assignedUserId,
        input.matchedCustomerId,
        input.matchedContactId,
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
        RETURNING *
      `, [
        input.matchedCustomerId,
        input.matchedContactId,
        input.convertedOpportunityId,
        input.reviewedBy,
        id
      ]);
      return mapInquiryRow(result.rows[0]);
    }
  };
}
