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
    name: row.name,
    industry: row.industry || '',
    country: row.country || '',
    region: row.region || '',
    parentCompany: row.parent_company || '',
    enterpriseNature: row.enterprise_nature || '',
    companyHighlights: row.company_highlights || '',
    address: row.address || '',
    ownerUserId: Number(row.owner_user_id),
    notes: row.notes || '',
    contactCount: numberOrNull(row.contact_count) || 0
  };
}

function mapContactRow(row) {
  return {
    id: Number(row.id),
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
    c.name,
    c.industry,
    c.country,
    c.region,
    c.parent_company,
    c.enterprise_nature,
    c.company_highlights,
    c.address,
    c.owner_user_id,
    c.notes,
    COALESCE(count(ct.id), 0)::int AS contact_count
  FROM customers c
  LEFT JOIN contacts ct ON ct.customer_id = c.id
`;

export function createCustomerRepository(queryTarget) {
  return {
    async listCustomers(filter = {}) {
      const where = [];
      const params = [];
      if (filter.ownerUserId) {
        params.push(filter.ownerUserId);
        where.push(`c.owner_user_id = $${params.length}`);
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
        SELECT id, customer_id, name, title, phone, email, wechat, notes
        FROM contacts
        WHERE customer_id = $1
        ORDER BY created_at DESC, id DESC
      `, [id]);
      return {
        ...customer,
        contacts: contacts.rows.map(mapContactRow)
      };
    },

    async createCustomer(input) {
      const result = await queryTarget.query(`
        INSERT INTO customers (
          name,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *, 0::int AS contact_count
      `, [
        input.name,
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
          industry = $2,
          country = $3,
          region = $4,
          parent_company = $5,
          enterprise_nature = $6,
          company_highlights = $7,
          address = $8,
          notes = $9,
          updated_at = now()
        WHERE id = $10
        RETURNING *, 0::int AS contact_count
      `, [
        input.name,
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

    async deleteById(id) {
      const result = await queryTarget.query(`
        DELETE FROM customers
        WHERE id = $1
      `, [id]);
      return result.rowCount > 0;
    }
  };
}
