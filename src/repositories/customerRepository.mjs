function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function mapCustomerRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    customerCode: row.customer_code || '',
    name: row.name,
    website: row.website || '',
    industry: row.industry || '',
    country: row.country || '',
    region: row.region || '',
    parentCompany: row.parent_company || '',
    enterpriseNature: row.enterprise_nature || '',
    companyHighlights: row.company_highlights || '',
    address: row.address || '',
    ownerUserId: Number(row.owner_user_id),
    notes: row.notes || '',
    contactCount: numberOrNull(row.contact_count) || 0,
    ...(Object.hasOwn(row, 'record_uid') ? { recordUid: row.record_uid } : {}),
    ...(Object.hasOwn(row, 'archived_at') ? { archivedAt: row.archived_at } : {}),
    ...(Object.hasOwn(row, 'archived_by') ? { archivedBy: numberOrNull(row.archived_by) } : {}),
    ...(Object.hasOwn(row, 'archive_reason') ? { archiveReason: row.archive_reason || '' } : {}),
    ...(Object.hasOwn(row, 'merged_into_id') ? { mergedIntoId: numberOrNull(row.merged_into_id) } : {})
  };
}

function mapDuplicateCustomerRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    customerCode: row.customer_code || '',
    name: row.name,
    ownerUserId: Number(row.owner_user_id),
    ownerDisplayName: row.owner_display_name || '',
    ownerUsername: row.owner_username || '',
    contactCount: numberOrNull(row.contact_count) || 0
  };
}

function mapContactRow(row) {
  return {
    id: Number(row.id),
    contactCode: row.contact_code || '',
    customerId: Number(row.customer_id),
    name: row.name,
    title: row.title || '',
    phone: row.phone || '',
    email: row.email || '',
    wechat: row.wechat || '',
    notes: row.notes || ''
  };
}

const customerSelect = `
  SELECT
    c.id,
    c.customer_code,
    c.name,
    c.website,
    c.industry,
    c.country,
    c.region,
    c.parent_company,
    c.enterprise_nature,
    c.company_highlights,
    c.address,
    c.owner_user_id,
    c.notes,
    c.record_uid,
    c.archived_at,
    c.archived_by,
    c.archive_reason,
    c.merged_into_id,
    COALESCE(count(ct.id), 0)::int AS contact_count
  FROM customers c
  LEFT JOIN contacts ct ON ct.customer_id = c.id AND ct.archived_at IS NULL
`;

export function createCustomerRepository(queryTarget) {
  return {
    async listCustomers(filter = {}) {
      const where = [];
      const params = [];
      if (filter.archiveScope === 'all') {
        // Include active and archived customer records.
      } else if (filter.archiveScope === 'archived') {
        where.push('c.archived_at IS NOT NULL');
      } else {
        where.push('c.archived_at IS NULL');
      }
      if (filter.ownerUserId) {
        params.push(filter.ownerUserId);
        where.push(`c.owner_user_id = $${params.length}`);
      }
      if (filter.searchTerm) {
        params.push(`%${String(filter.searchTerm).replace(/[\\%_]/g, '\\$&')}%`);
        const searchParam = `$${params.length}`;
        where.push(`(
          c.customer_code ILIKE ${searchParam} ESCAPE '\\'
          OR c.name ILIKE ${searchParam} ESCAPE '\\'
          OR c.website ILIKE ${searchParam} ESCAPE '\\'
        )`);
      }
      const result = await queryTarget.query(`
        ${customerSelect}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY c.id
        ORDER BY c.created_at DESC, c.id DESC
      `, params);
      return result.rows.map(mapCustomerRow);
    },

    async getCustomerDetail(id) {
      const result = await queryTarget.query(`
        ${customerSelect}
        WHERE c.id = $1
        GROUP BY c.id
        LIMIT 1
      `, [id]);
      const customer = mapCustomerRow(result.rows[0]);
      if (!customer) {
        return null;
      }
      const contacts = await queryTarget.query(`
        SELECT id, contact_code, customer_id, name, title, phone, email, wechat, notes,
          record_uid, archived_at, archived_by, archive_reason, merged_into_id
        FROM contacts
        WHERE customer_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id]);
      return {
        ...customer,
        contacts: contacts.rows.map(mapContactRow)
      };
    },

    async findDuplicatesByName(name, { excludeId } = {}) {
      const params = [String(name || '').trim()];
      const excludeClause = excludeId ? `AND c.id <> $${params.push(excludeId)}` : '';
      const result = await queryTarget.query(`
        SELECT
          c.id,
          c.customer_code,
          c.name,
          c.owner_user_id,
          u.display_name AS owner_display_name,
          u.username AS owner_username,
          COALESCE(count(ct.id), 0)::int AS contact_count
        FROM customers c
        LEFT JOIN users u ON u.id = c.owner_user_id
        LEFT JOIN contacts ct ON ct.customer_id = c.id
        WHERE lower(regexp_replace(btrim(c.name), '[[:space:]]+', ' ', 'g'))
          = lower(regexp_replace(btrim($1), '[[:space:]]+', ' ', 'g'))
          ${excludeClause}
        GROUP BY c.id, u.display_name, u.username
        ORDER BY c.created_at DESC, c.id DESC
      `, params);
      return result.rows.map(mapDuplicateCustomerRow);
    },

    async createCustomer(input) {
      const result = await queryTarget.query(`
        INSERT INTO customers (
          name,
          website,
          industry,
          country,
          region,
          parent_company,
          enterprise_nature,
          company_highlights,
          address,
          owner_user_id,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *, 0::int AS contact_count
      `, [
        input.name,
        input.website,
        input.industry,
        input.country,
        input.region,
        input.parentCompany,
        input.enterpriseNature,
        input.companyHighlights,
        input.address,
        input.ownerUserId,
        input.notes
      ]);
      return mapCustomerRow(result.rows[0]);
    },

    async updateCustomer(id, input) {
      const result = await queryTarget.query(`
        UPDATE customers
        SET
          name = $1,
          website = $2,
          industry = $3,
          country = $4,
          region = $5,
          parent_company = $6,
          enterprise_nature = $7,
          company_highlights = $8,
          address = $9,
          notes = $10,
          updated_at = now()
        WHERE id = $11
        RETURNING *, 0::int AS contact_count
      `, [
        input.name,
        input.website,
        input.industry,
        input.country,
        input.region,
        input.parentCompany,
        input.enterpriseNature,
        input.companyHighlights,
        input.address,
        input.notes,
        id
      ]);
      return mapCustomerRow(result.rows[0]);
    },

    async archiveById(id, input) {
      const result = await queryTarget.query(`
        WITH archived AS (
          UPDATE customers
          SET archived_at = now(), archived_by = $2, archive_reason = $3, updated_at = now()
          WHERE id = $1 AND archived_at IS NULL
          RETURNING id, record_uid, archived_at
        ), lifecycle_event AS (
          INSERT INTO record_lifecycle_events (
            record_type, record_id, record_uid, event_type, actor_user_id, reason, event_data
          )
          SELECT 'customer', id, record_uid, 'archive', $2, $3,
            jsonb_build_object('archivedAt', archived_at)
          FROM archived
          RETURNING id
        )
        SELECT archived.id, archived.record_uid
        FROM archived
        JOIN lifecycle_event ON true
      `, [id, input.actorUserId, input.reason]);
      return result.rowCount > 0;
    },

    async reopenById(id, input) {
      const result = await queryTarget.query(`
        WITH previous AS (
          SELECT id, record_uid, archived_at, archived_by, archive_reason
          FROM customers
          WHERE id = $1 AND archived_at IS NOT NULL AND merged_into_id IS NULL
          FOR UPDATE
        ), reopened AS (
          UPDATE customers customer
          SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = now()
          FROM previous
          WHERE customer.id = previous.id
          RETURNING customer.id, customer.record_uid
        ), lifecycle_event AS (
          INSERT INTO record_lifecycle_events (
            record_type, record_id, record_uid, event_type, actor_user_id, reason, event_data
          )
          SELECT 'customer', id, record_uid, 'reopen', $2, $3,
            jsonb_build_object(
              'previousArchivedAt', archived_at,
              'previousArchivedBy', archived_by,
              'previousArchiveReason', archive_reason
            )
          FROM previous
          RETURNING id
        )
        SELECT reopened.id, reopened.record_uid
        FROM reopened
        JOIN lifecycle_event ON true
      `, [id, input.actorUserId, input.reason]);
      return result.rowCount > 0;
    }
  };
}
