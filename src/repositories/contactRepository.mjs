function mapContactRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    customerId: Number(row.customer_id),
    customerName: row.customer_name || '',
    customerOwnerUserId: Number(row.customer_owner_user_id),
    name: row.name,
    title: row.title || '',
    phone: row.phone || '',
    email: row.email || '',
    wechat: row.wechat || '',
    notes: row.notes || ''
  };
}

const contactSelect = `
  SELECT
    ct.id,
    ct.customer_id,
    c.name AS customer_name,
    c.owner_user_id AS customer_owner_user_id,
    ct.name,
    ct.title,
    ct.phone,
    ct.email,
    ct.wechat,
    ct.notes
  FROM contacts ct
  JOIN customers c ON c.id = ct.customer_id
`;

export function createContactRepository(queryTarget) {
  return {
    async listContacts(filter = {}) {
      const where = [];
      const params = [];
      if (filter.ownerUserId) {
        params.push(filter.ownerUserId);
        where.push(`c.owner_user_id = $${params.length}`);
      }
      if (filter.customerId) {
        params.push(filter.customerId);
        where.push(`ct.customer_id = $${params.length}`);
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
            notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        )
        SELECT
          inserted.id,
          inserted.customer_id,
          c.name AS customer_name,
          c.owner_user_id AS customer_owner_user_id,
          inserted.name,
          inserted.title,
          inserted.phone,
          inserted.email,
          inserted.wechat,
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
            notes = $6,
            updated_at = now()
          WHERE id = $7
          RETURNING *
        )
        SELECT
          updated.id,
          updated.customer_id,
          c.name AS customer_name,
          c.owner_user_id AS customer_owner_user_id,
          updated.name,
          updated.title,
          updated.phone,
          updated.email,
          updated.wechat,
          updated.notes
        FROM updated
        JOIN customers c ON c.id = updated.customer_id
      `, [
        input.name,
        input.title,
        input.phone,
        input.email,
        input.wechat,
        input.notes,
        id
      ]);
      return mapContactRow(result.rows[0]);
    }
  };
}
