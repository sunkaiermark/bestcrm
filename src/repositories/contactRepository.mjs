function mapContactRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    contactCode: row.contact_code || '',
    customerId: Number(row.customer_id),
    customerCode: row.customer_code || '',
    customerName: row.customer_name || '',
    customerOwnerUserId: Number(row.customer_owner_user_id),
    name: row.name,
    title: row.title || '',
    phone: row.phone || '',
    email: row.email || '',
    wechat: row.wechat || '',
    educationBackground: row.education_background || '',
    workExperience: row.work_experience || '',
    keyAchievements: row.key_achievements || '',
    notes: row.notes || '',
    ...(Object.hasOwn(row, 'record_uid') ? { recordUid: row.record_uid } : {}),
    ...(Object.hasOwn(row, 'archived_at') ? { archivedAt: row.archived_at } : {}),
    ...(Object.hasOwn(row, 'archived_by') ? { archivedBy: row.archived_by === null ? null : Number(row.archived_by) } : {}),
    ...(Object.hasOwn(row, 'archive_reason') ? { archiveReason: row.archive_reason || '' } : {}),
    ...(Object.hasOwn(row, 'merged_into_id') ? { mergedIntoId: row.merged_into_id === null ? null : Number(row.merged_into_id) } : {})
  };
}

const contactSelect = `
  SELECT
    ct.id,
    ct.contact_code,
    ct.customer_id,
    c.customer_code,
    c.name AS customer_name,
    c.owner_user_id AS customer_owner_user_id,
    ct.name,
    ct.title,
    ct.phone,
    ct.email,
    ct.wechat,
    ct.education_background,
    ct.work_experience,
    ct.key_achievements,
    ct.notes,
    ct.record_uid,
    ct.archived_at,
    ct.archived_by,
    ct.archive_reason,
    ct.merged_into_id
  FROM contacts ct
  JOIN customers c ON c.id = ct.customer_id
`;

export function createContactRepository(queryTarget) {
  return {
    async findUniqueByEmail(email) {
      const normalized = String(email || '').trim().toLowerCase();
      if (!normalized) return null;
      const result = await queryTarget.query(`
        ${contactSelect}
        WHERE lower(btrim(ct.email)) = $1
          AND ct.archived_at IS NULL
          AND c.archived_at IS NULL
        ORDER BY ct.id
        LIMIT 2
      `, [normalized]);
      return result.rows.length === 1 ? mapContactRow(result.rows[0]) : null;
    },

    async findDuplicatesByIdentity({ customerId, name, phone }, { excludeId } = {}) {
      const params = [Number(customerId), String(name || '').trim(), String(phone || '').trim()];
      const excludeClause = excludeId ? `AND ct.id <> $${params.push(Number(excludeId))}` : '';
      const result = await queryTarget.query(`
        ${contactSelect}
        WHERE ct.customer_id = $1
          AND bestcrm_normalize_identity_text(ct.name) = bestcrm_normalize_identity_text($2)
          AND bestcrm_normalize_phone(ct.phone) = bestcrm_normalize_phone($3)
          AND bestcrm_normalize_phone(ct.phone) <> ''
          ${excludeClause}
        ORDER BY ct.created_at DESC, ct.id DESC
      `, params);
      return result.rows.map(mapContactRow);
    },

    async listContacts(filter = {}) {
      const where = [];
      const params = [];
      if (filter.archiveScope === 'all') {
        // Include active and archived contact records.
      } else if (filter.archiveScope === 'archived') {
        where.push('ct.archived_at IS NOT NULL');
      } else {
        where.push('ct.archived_at IS NULL');
        where.push('c.archived_at IS NULL');
      }
      if (filter.ownerUserId) {
        params.push(filter.ownerUserId);
        where.push(`c.owner_user_id = $${params.length}`);
      }
      if (filter.customerId) {
        params.push(filter.customerId);
        where.push(`ct.customer_id = $${params.length}`);
      }
      if (filter.searchTerm) {
        params.push(`%${String(filter.searchTerm).replace(/[\\%_]/g, '\\$&')}%`);
        const searchParam = `$${params.length}`;
        where.push(`(
          ct.contact_code ILIKE ${searchParam} ESCAPE '\\'
          OR ct.name ILIKE ${searchParam} ESCAPE '\\'
          OR c.customer_code ILIKE ${searchParam} ESCAPE '\\'
          OR c.name ILIKE ${searchParam} ESCAPE '\\'
          OR ct.email ILIKE ${searchParam} ESCAPE '\\'
          OR ct.phone ILIKE ${searchParam} ESCAPE '\\'
          OR ct.wechat ILIKE ${searchParam} ESCAPE '\\'
        )`);
      }
      const result = await queryTarget.query(`
        ${contactSelect}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ct.created_at DESC, ct.id DESC
      `, params);
      return result.rows.map(mapContactRow);
    },

    async getContactDetail(id) {
      const result = await queryTarget.query(`
        ${contactSelect}
        WHERE ct.id = $1
        LIMIT 1
      `, [id]);
      return mapContactRow(result.rows[0]);
    },

    async createContact(input) {
      const result = await queryTarget.query(`
        WITH inserted AS (
          INSERT INTO contacts (
            customer_id,
            name,
            title,
            phone,
            email,
            wechat,
            education_background,
            work_experience,
            key_achievements,
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        )
        SELECT
          inserted.id,
          inserted.contact_code,
          inserted.customer_id,
          c.customer_code,
          c.name AS customer_name,
          c.owner_user_id AS customer_owner_user_id,
          inserted.name,
          inserted.title,
          inserted.phone,
          inserted.email,
          inserted.wechat,
          inserted.education_background,
          inserted.work_experience,
          inserted.key_achievements,
          inserted.notes
        FROM inserted
        JOIN customers c ON c.id = inserted.customer_id
      `, [
        input.customerId,
        input.name,
        input.title,
        input.phone,
        input.email,
        input.wechat,
        input.educationBackground,
        input.workExperience,
        input.keyAchievements,
        input.notes
      ]);
      return mapContactRow(result.rows[0]);
    },

    async updateContact(id, input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE contacts
          SET
            name = $1,
            title = $2,
            phone = $3,
            email = $4,
            wechat = $5,
            education_background = $6,
            work_experience = $7,
            key_achievements = $8,
            notes = $9,
            updated_at = now()
          WHERE id = $10
          RETURNING *
        )
        SELECT
          updated.id,
          updated.contact_code,
          updated.customer_id,
          c.customer_code,
          c.name AS customer_name,
          c.owner_user_id AS customer_owner_user_id,
          updated.name,
          updated.title,
          updated.phone,
          updated.email,
          updated.wechat,
          updated.education_background,
          updated.work_experience,
          updated.key_achievements,
          updated.notes
        FROM updated
        JOIN customers c ON c.id = updated.customer_id
      `, [
        input.name,
        input.title,
        input.phone,
        input.email,
        input.wechat,
        input.educationBackground,
        input.workExperience,
        input.keyAchievements,
        input.notes,
        id
      ]);
      return mapContactRow(result.rows[0]);
    },

    async archiveById(id, input) {
      const result = await queryTarget.query(`
        WITH archived AS (
          UPDATE contacts
          SET archived_at = now(), archived_by = $2, archive_reason = $3, updated_at = now()
          WHERE id = $1 AND archived_at IS NULL
          RETURNING id, record_uid, archived_at
        ), lifecycle_event AS (
          INSERT INTO record_lifecycle_events (
            record_type, record_id, record_uid, event_type, actor_user_id, reason, event_data
          )
          SELECT 'contact', id, record_uid, 'archive', $2, $3,
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
          FROM contacts
          WHERE id = $1 AND archived_at IS NOT NULL AND merged_into_id IS NULL
          FOR UPDATE
        ), reopened AS (
          UPDATE contacts contact
          SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = now()
          FROM previous
          WHERE contact.id = previous.id
          RETURNING contact.id, contact.record_uid
        ), lifecycle_event AS (
          INSERT INTO record_lifecycle_events (
            record_type, record_id, record_uid, event_type, actor_user_id, reason, event_data
          )
          SELECT 'contact', id, record_uid, 'reopen', $2, $3,
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
