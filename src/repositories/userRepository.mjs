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
    personalMailboxAddress: row.personal_mailbox_address || '',
    phone: row.phone,
    emailSignatureName: row.email_signature_name || '',
    emailSignatureTitle: row.email_signature_title || '',
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
    (
      SELECT assignment.mailbox_address
      FROM user_personal_mailbox_assignments assignment
      WHERE assignment.user_id = u.id
        AND assignment.unassigned_at IS NULL
      ORDER BY assignment.assigned_at DESC, assignment.id DESC
      LIMIT 1
    ) AS personal_mailbox_address,
    u.phone,
    u.email_signature_name,
    u.email_signature_title,
    u.is_active,
    COALESCE(array_remove(array_agg(r.code ORDER BY r.code), NULL), ARRAY[]::text[]) AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
    AND r.is_active = true
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
      AND is_active = true
    ON CONFLICT (user_id, role_id) DO NOTHING
  `, [userId, roles]);
}

function hasPersonalMailboxInput(user) {
  return Object.prototype.hasOwnProperty.call(user, 'personalMailboxAddress');
}

async function createPersonalMailboxAssignment(pool, userId, mailboxAddress, assignedBy) {
  if (!mailboxAddress) return;
  await pool.query(`
    INSERT INTO user_personal_mailbox_assignments (
      user_id,
      mailbox_address,
      assigned_by
    )
    VALUES ($1, $2, $3)
  `, [userId, mailboxAddress, assignedBy]);
}

async function replacePersonalMailboxAssignment(pool, userId, mailboxAddress, assignedBy) {
  const currentResult = await pool.query(`
    SELECT id, mailbox_address
    FROM user_personal_mailbox_assignments
    WHERE user_id = $1
      AND unassigned_at IS NULL
    ORDER BY assigned_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
  `, [userId]);
  const current = currentResult.rows[0] || null;
  if ((current?.mailbox_address || '') === mailboxAddress) return;

  if (current) {
    await pool.query(`
      UPDATE user_personal_mailbox_assignments
      SET unassigned_by = $2, unassigned_at = now()
      WHERE id = $1
        AND unassigned_at IS NULL
    `, [current.id, assignedBy]);
  }
  await createPersonalMailboxAssignment(pool, userId, mailboxAddress, assignedBy);
}

function personalizeMailboxConflict(error) {
  if (error?.code === '23505' && String(error.constraint || '').startsWith('user_personal_mailbox_active_')) {
    error.statusCode = 409;
    error.message = 'Personal mailbox is already assigned to another active user';
  }
  return error;
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
          INSERT INTO users (
            username, password_hash, display_name, email, phone,
            email_signature_name, email_signature_title, is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `, [
          user.username,
          user.passwordHash,
          user.displayName,
          user.email || null,
          user.phone || null,
          user.emailSignatureName || '',
          user.emailSignatureTitle || '',
          user.isActive
        ]);
        const userId = Number(result.rows[0].id);
        await replaceUserRoles(pool, userId, user.roles);
        if (hasPersonalMailboxInput(user)) {
          await createPersonalMailboxAssignment(
            pool,
            userId,
            user.personalMailboxAddress,
            user.mailboxAssignedBy
          );
        }
        await pool.query('COMMIT');
        return { id: userId };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw personalizeMailboxConflict(error);
      }
    },

    async updateUser(id, user) {
      await pool.query('BEGIN');
      try {
        const passwordAssignment = user.passwordHash ? 'password_hash = $8,' : '';
        const params = [
          id,
          user.displayName,
          user.email || null,
          user.phone || null,
          user.emailSignatureName || '',
          user.emailSignatureTitle || '',
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
            email_signature_name = $5,
            email_signature_title = $6,
            is_active = $7,
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
        if (hasPersonalMailboxInput(user)) {
          await replacePersonalMailboxAssignment(
            pool,
            userId,
            user.personalMailboxAddress,
            user.mailboxAssignedBy
          );
        }
        if (user.passwordHash || user.isActive === false) {
          await pool.query(`
            UPDATE user_trusted_devices
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE user_id = $1
              AND revoked_at IS NULL
          `, [userId]);
          await pool.query(`
            DELETE FROM "session"
            WHERE sess ->> 'userId' = $1
          `, [String(userId)]);
        }
        await pool.query('COMMIT');
        return { id: userId };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw personalizeMailboxConflict(error);
      }
    },

    async changePassword(id, passwordHash, auditEvent) {
      await pool.query('BEGIN');
      try {
        const result = await pool.query(`
          UPDATE users
          SET password_hash = $2, updated_at = now()
          WHERE id = $1
            AND is_active = true
          RETURNING id, username
        `, [id, passwordHash]);
        if (!result.rows[0]) {
          await pool.query('COMMIT');
          return null;
        }

        const userId = Number(result.rows[0].id);
        await pool.query(`
          INSERT INTO login_audit_events (
            username,
            user_id,
            ip_address,
            user_agent,
            result,
            reason
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          result.rows[0].username,
          userId,
          auditEvent?.ipAddress || null,
          auditEvent?.userAgent || null,
          auditEvent?.result || 'success',
          auditEvent?.reason || 'password_changed'
        ]);
        await pool.query(`
          UPDATE user_trusted_devices
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            AND revoked_at IS NULL
        `, [userId]);
        await pool.query(`
          DELETE FROM "session"
          WHERE sess ->> 'userId' = $1
        `, [String(userId)]);
        await pool.query('COMMIT');
        return { id: userId };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    },

    async deactivateUser(id) {
      await pool.query('BEGIN');
      try {
        const result = await pool.query(`
          UPDATE users
          SET is_active = false, updated_at = now()
          WHERE id = $1
          RETURNING id
        `, [id]);
        if (!result.rows[0]) {
          await pool.query('COMMIT');
          return null;
        }
        const userId = Number(result.rows[0].id);
        await pool.query(`
          UPDATE user_trusted_devices
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = $1
            AND revoked_at IS NULL
        `, [userId]);
        await pool.query(`
          DELETE FROM "session"
          WHERE sess ->> 'userId' = $1
        `, [String(userId)]);
        await pool.query('COMMIT');
        return { id: userId };
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
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
