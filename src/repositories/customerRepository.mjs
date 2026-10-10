function numberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function coordinatorUserId(row) {
  return Number(row.coordinator_user_id ?? row.owner_user_id);
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
    coordinatorUserId: coordinatorUserId(row),
    coordinatorDisplayName: row.coordinator_display_name || '',
    coordinatorUsername: row.coordinator_username || '',
    // Transitional aliases keep older integrations readable while customer
    // access and opportunity ownership move to the shared-customer model.
    ownerUserId: coordinatorUserId(row),
    ownerDisplayName: row.coordinator_display_name || row.owner_display_name || '',
    ownerUsername: row.coordinator_username || row.owner_username || '',
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
    coordinatorUserId: coordinatorUserId(row),
    coordinatorDisplayName: row.coordinator_display_name || row.owner_display_name || '',
    coordinatorUsername: row.coordinator_username || row.owner_username || '',
    ownerUserId: coordinatorUserId(row),
    ownerDisplayName: row.coordinator_display_name || row.owner_display_name || '',
    ownerUsername: row.coordinator_username || row.owner_username || '',
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
    COALESCE(c.coordinator_user_id, c.owner_user_id) AS coordinator_user_id,
    coordinator.display_name AS coordinator_display_name,
    coordinator.username AS coordinator_username,
    c.notes,
    c.record_uid,
    c.archived_at,
    c.archived_by,
    c.archive_reason,
    c.merged_into_id,
    COALESCE(count(ct.id), 0)::int AS contact_count
  FROM customers c
  LEFT JOIN users coordinator
    ON coordinator.id = COALESCE(c.coordinator_user_id, c.owner_user_id)
  LEFT JOIN contacts ct ON ct.customer_id = c.id AND ct.archived_at IS NULL
`;

function customerScopeConditions(filter) {
  const where = [];
  const params = [];
  if (filter.archiveScope === 'all') {
    // Include active and archived customer records.
  } else if (filter.archiveScope === 'archived') {
    where.push('c.archived_at IS NOT NULL');
  } else {
    where.push('c.archived_at IS NULL');
  }
  const coordinatorId = filter.coordinatorUserId || filter.ownerUserId;
  if (coordinatorId) {
    params.push(coordinatorId);
    where.push(`COALESCE(c.coordinator_user_id, c.owner_user_id) = $${params.length}`);
  }
  return { where, params };
}

export function createCustomerRepository(queryTarget) {
  return {
    async listCustomerFilterOptions(filter = {}) {
      const { where, params } = customerScopeConditions(filter);
      const result = await queryTarget.query(`
        SELECT c.id, c.customer_code, c.name, btrim(c.country) AS country,
          COALESCE(c.coordinator_user_id, c.owner_user_id) AS coordinator_user_id,
          u.display_name AS coordinator_display_name,
          u.username AS coordinator_username
        FROM customers c
        LEFT JOIN users u ON u.id = COALESCE(c.coordinator_user_id, c.owner_user_id)
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.name, c.id
      `, params);
      const customers = result.rows.map((row) => ({
        id: Number(row.id), customerCode: row.customer_code || '', name: row.name
      }));
      const salesCoordinators = new Map();
      const countries = new Set();
      for (const row of result.rows) {
        const coordinatorId = Number(row.coordinator_user_id);
        if (Number.isSafeInteger(coordinatorId) && coordinatorId > 0 && !salesCoordinators.has(coordinatorId)) {
          salesCoordinators.set(coordinatorId, {
            id: coordinatorId,
            displayName: row.coordinator_display_name || row.coordinator_username || String(coordinatorId)
          });
        }
        if (row.country) countries.add(row.country);
      }
      const sortedCoordinators = [...salesCoordinators.values()]
        .sort((left, right) => left.displayName.localeCompare(right.displayName));
      return {
        customers,
        salesCoordinators: sortedCoordinators,
        salesOwners: sortedCoordinators,
        countries: [...countries].sort((left, right) => left.localeCompare(right))
      };
    },

    async listCustomers(filter = {}) {
      const { where, params } = customerScopeConditions(filter);
      if (filter.customerId) {
        params.push(filter.customerId);
        where.push(`c.id = $${params.length}`);
      }
      if (filter.country) {
        params.push(String(filter.country).trim());
        where.push(`btrim(c.country) = $${params.length}`);
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
        GROUP BY c.id, coordinator.display_name, coordinator.username
        ORDER BY c.created_at DESC, c.id DESC
      `, params);
      return result.rows.map(mapCustomerRow);
    },

    async getCustomerDetail(id) {
      const result = await queryTarget.query(`
        ${customerSelect}
        WHERE c.id = $1
        GROUP BY c.id, coordinator.display_name, coordinator.username
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
          COALESCE(c.coordinator_user_id, c.owner_user_id) AS coordinator_user_id,
          u.display_name AS coordinator_display_name,
          u.username AS coordinator_username,
          COALESCE(count(ct.id), 0)::int AS contact_count
        FROM customers c
        LEFT JOIN users u ON u.id = COALESCE(c.coordinator_user_id, c.owner_user_id)
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
        WITH inserted AS (
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
            coordinator_user_id,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)
          RETURNING *
        ), event AS (
          INSERT INTO customer_coordination_events (
            customer_id, event_type, previous_coordinator_user_id,
            coordinator_user_id, actor_user_id, note
          )
          SELECT id, 'coordinator_assigned', NULL, coordinator_user_id, $12,
            'Initial customer relationship coordinator assigned.'
          FROM inserted
          RETURNING id
        )
        SELECT inserted.*, 0::int AS contact_count
        FROM inserted
        JOIN event ON true
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
        input.coordinatorUserId ?? input.ownerUserId,
        input.notes,
        input.actorUserId || null
      ]);
      return mapCustomerRow(result.rows[0]);
    },

    async updateCoordinator(customerId, input) {
      const result = await queryTarget.query(`
        WITH previous AS (
          SELECT id, COALESCE(coordinator_user_id, owner_user_id) AS coordinator_user_id
          FROM customers
          WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE
        ), updated AS (
          UPDATE customers customer
          SET coordinator_user_id = $2, owner_user_id = $2, updated_at = now()
          FROM previous
          WHERE customer.id = previous.id
          RETURNING customer.*
        ), event AS (
          INSERT INTO customer_coordination_events (
            customer_id, event_type, previous_coordinator_user_id,
            coordinator_user_id, actor_user_id, note
          )
          SELECT previous.id, 'coordinator_changed', previous.coordinator_user_id,
            $2, $3, $4
          FROM previous
          JOIN updated ON updated.id = previous.id
          RETURNING id
        )
        SELECT updated.*, 0::int AS contact_count
        FROM updated
        JOIN event ON true
      `, [customerId, input.coordinatorUserId, input.actorUserId, input.note]);
      return mapCustomerRow(result.rows[0]);
    },

    async listCoordinationEvents(customerId) {
      const result = await queryTarget.query(`
        SELECT
          event.id,
          event.event_type,
          event.previous_coordinator_user_id,
          previous_user.display_name AS previous_coordinator_display_name,
          event.coordinator_user_id,
          coordinator.display_name AS coordinator_display_name,
          event.actor_user_id,
          actor.display_name AS actor_display_name,
          event.note,
          event.created_at
        FROM customer_coordination_events event
        LEFT JOIN users previous_user ON previous_user.id = event.previous_coordinator_user_id
        JOIN users coordinator ON coordinator.id = event.coordinator_user_id
        LEFT JOIN users actor ON actor.id = event.actor_user_id
        WHERE event.customer_id = $1
        ORDER BY event.created_at DESC, event.id DESC
      `, [customerId]);
      return result.rows.map((row) => ({
        id: Number(row.id),
        eventType: row.event_type,
        previousCoordinatorUserId: numberOrNull(row.previous_coordinator_user_id),
        previousCoordinatorDisplayName: row.previous_coordinator_display_name || '',
        coordinatorUserId: Number(row.coordinator_user_id),
        coordinatorDisplayName: row.coordinator_display_name || '',
        actorUserId: numberOrNull(row.actor_user_id),
        actorDisplayName: row.actor_display_name || '',
        note: row.note || '',
        createdAt: row.created_at
      }));
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
