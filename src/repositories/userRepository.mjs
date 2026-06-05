function mapUserRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    isActive: row.is_active,
    roles: row.roles || []
  };
}

const userWithRolesSelect = `
  SELECT
    u.id,
    u.username,
    u.password_hash,
    u.display_name,
    u.email,
    u.phone,
    u.is_active,
    COALESCE(array_remove(array_agg(r.code ORDER BY r.code), NULL), ARRAY[]::text[]) AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
`;

export function createUserRepository(pool) {
  return {
    async findByIdWithRoles(id) {
      const result = await pool.query(`${userWithRolesSelect}
        WHERE u.id = $1
        GROUP BY u.id
        LIMIT 1`, [id]);
      return mapUserRow(result.rows[0]);
    },

    async findByUsernameWithRoles(username) {
      const result = await pool.query(`${userWithRolesSelect}
        WHERE u.username = $1
        GROUP BY u.id
        LIMIT 1`, [username]);
      return mapUserRow(result.rows[0]);
    }
  };
}
