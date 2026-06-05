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

async function replaceUserRoles(pool, userId, roles) {
  await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  if (!roles.length) {
    return;
  }
  await pool.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, id
    FROM roles
    WHERE code = ANY($2::text[])
    ON CONFLICT (user_id, role_id) DO NOTHING
  `, [userId, roles]);
}

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
    },

    async listUsersWithRoles() {
      const result = await pool.query(`${userWithRolesSelect}
        GROUP BY u.id
        ORDER BY u.is_active DESC, u.display_name ASC`);
      return result.rows.map(mapUserRow);
    },

    async createUser(user) {
      await pool.query('BEGIN');
      try {
        const result = await pool.query(`
          INSERT INTO users (username, password_hash, display_name, email, phone, is_active)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          user.username,
          user.passwordHash,
          user.displayName,
          user.email || null,
          user.phone || null,
          user.isActive
        ]);
        const userId = Number(result.rows[0].id);
        await replaceUserRoles(pool, userId, user.roles);
        await pool.query('COMMIT');
        return { id: userId };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    },

    async updateUser(id, user) {
      await pool.query('BEGIN');
      try {
        const passwordAssignment = user.passwordHash ? 'password_hash = $6,' : '';
        const params = [
          id,
          user.displayName,
          user.email || null,
          user.phone || null,
          user.isActive
        ];
        if (user.passwordHash) {
          params.push(user.passwordHash);
        }
        const result = await pool.query(`
          UPDATE users
          SET
            display_name = $2,
            email = $3,
            phone = $4,
            is_active = $5,
            ${passwordAssignment}
            updated_at = now()
          WHERE id = $1
          RETURNING id
        `, params);
        if (!result.rows[0]) {
          await pool.query('COMMIT');
          return null;
        }
        const userId = Number(result.rows[0].id);
        await replaceUserRoles(pool, userId, user.roles);
        await pool.query('COMMIT');
        return { id: userId };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    },

    async deactivateUser(id) {
      const result = await pool.query(`
        UPDATE users
        SET is_active = false, updated_at = now()
        WHERE id = $1
        RETURNING id
      `, [id]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async listUsersByRole(role) {
      const result = await pool.query(`${userWithRolesSelect}
        WHERE u.is_active = true
        GROUP BY u.id
        HAVING $1 = ANY(COALESCE(array_remove(array_agg(r.code ORDER BY r.code), NULL), ARRAY[]::text[]))
        ORDER BY u.display_name ASC`, [role]);
      return result.rows.map(mapUserRow);
    }
  };
}
