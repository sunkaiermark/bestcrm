function mapRoleRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description || '',
    isActive: row.is_active
  };
}

const roleSelect = `
  SELECT id, code, name, description, is_active
  FROM roles
`;

export function createRoleRepository(pool) {
  return {
    async listRoles() {
      const result = await pool.query(`
        ${roleSelect}
        ORDER BY is_active DESC, name ASC
      `);
      return result.rows.map(mapRoleRow);
    },

    async listActiveRoles() {
      const result = await pool.query(`
        ${roleSelect}
        WHERE is_active = true
        ORDER BY name ASC
      `);
      return result.rows.map(mapRoleRow);
    },

    async findById(id) {
      const result = await pool.query(`
        ${roleSelect}
        WHERE id = $1
        LIMIT 1
      `, [id]);
      return mapRoleRow(result.rows[0]);
    },

    async createRole(role) {
      const result = await pool.query(`
        INSERT INTO roles (code, name, description, is_active)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        role.code,
        role.name,
        role.description || null,
        role.isActive
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async updateRole(id, role) {
      const result = await pool.query(`
        UPDATE roles
        SET name = $2,
            description = $3,
            is_active = $4
        WHERE id = $1
        RETURNING id
      `, [
        id,
        role.name,
        role.description || null,
        role.isActive
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async deactivateRole(id) {
      const result = await pool.query(`
        UPDATE roles
        SET is_active = false
        WHERE id = $1
        RETURNING id
      `, [id]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    }
  };
}
