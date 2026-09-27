function mapVersion(row) {
  if (!row) return null;
  return {
    id: Number(row.id), materialId: Number(row.material_id),
    topicId: Number(row.topic_id), originalName: row.original_filename,
    storedPath: row.stored_path, mimeType: row.mime_type,
    fileSize: Number(row.file_size), sha256: row.sha256,
    accessClass: row.access_class, uploadedByUserId: Number(row.recorded_by_user_id)
  };
}

/** P3c data access only. No HTTP route or public file path is provided here. */
export function createDevelopmentMaterialFileRepository(pool) {
  return {
    async findMemberTopic({ topicId, actorUserId }) {
      const result = await pool.query(`
        SELECT topic.id, topic.topic_no, topic.title, topic.owner_user_id
        FROM development_topics topic
        JOIN development_memberships membership
          ON membership.topic_id = topic.id
          AND membership.user_id = $2
          AND membership.added_at <= now() AND membership.ended_at IS NULL
        JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
        WHERE topic.id = $1
        LIMIT 1
      `, [topicId, actorUserId]);
      const row = result.rows[0];
      return row ? { id: Number(row.id), topicNo: row.topic_no, title: row.title,
        ownerUserId: Number(row.owner_user_id) } : null;
    },

    async createMaterial({ topicId, actorUserId, title, categoryCode, sourceReference }) {
      const result = await pool.query(`
        INSERT INTO development_materials (
          topic_id, title, category_code, source_reference, created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [topicId, title, categoryCode, sourceReference, actorUserId]);
      return { id: Number(result.rows[0].id) };
    },

    async listReadableMaterials({ topicId, actorUserId }) {
      const result = await pool.query(`
        SELECT material.id AS material_id, material.title, material.category_code,
          material.source_reference, version.id AS version_id, version.version_no,
          version.original_filename, version.mime_type, version.file_size,
          version.recorded_at, activation.access_class
        FROM development_materials material
        LEFT JOIN LATERAL (
          SELECT candidate.* FROM development_material_versions candidate
          JOIN development_material_file_activations state
            ON state.material_version_id = candidate.id
          WHERE candidate.material_id = material.id
            AND bestcrm_development_can_read_material_version(candidate.id, $2)
        ) version ON true
        LEFT JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
        WHERE material.topic_id = $1
          AND EXISTS (
            SELECT 1 FROM development_memberships membership
            JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
            WHERE membership.topic_id = material.topic_id
              AND membership.user_id = $2 AND membership.added_at <= now()
              AND membership.ended_at IS NULL
          )
          AND (material.created_by_user_id = $2 OR version.id IS NOT NULL)
        ORDER BY material.id DESC, version.version_no DESC
      `, [topicId, actorUserId]);
      const materials = new Map();
      for (const row of result.rows) {
        const id = Number(row.material_id);
        if (!materials.has(id)) {
          materials.set(id, { id, title: row.title, categoryCode: row.category_code,
            sourceReference: row.source_reference, versions: [] });
        }
        if (row.version_id) {
          materials.get(id).versions.push({
            id: Number(row.version_id), versionNo: Number(row.version_no),
            originalName: row.original_filename, mimeType: row.mime_type,
            fileSize: Number(row.file_size), recordedAt: row.recorded_at,
            accessClass: row.access_class
          });
        }
      }
      return [...materials.values()];
    },

    async listRestrictedAccessForOwner({ topicId, actorUserId }) {
      const ownerGuard = `EXISTS (
        SELECT 1 FROM development_topics topic
        JOIN development_memberships owner_member
          ON owner_member.topic_id = topic.id
          AND owner_member.user_id = $2
          AND owner_member.added_at <= now() AND owner_member.ended_at IS NULL
        JOIN users owner_user
          ON owner_user.id = owner_member.user_id AND owner_user.is_active = true
        WHERE topic.id = $1 AND topic.owner_user_id = $2
      )`;
      const versions = await pool.query(`
        SELECT version.id, version.version_no, version.original_filename,
          version.recorded_at, version.recorded_by_user_id,
          material.title AS material_title
        FROM development_material_versions version
        JOIN development_materials material ON material.id = version.material_id
        JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
          AND activation.access_class = 'restricted'
        WHERE material.topic_id = $1 AND ${ownerGuard}
        ORDER BY material.id DESC, version.version_no DESC
      `, [topicId, actorUserId]);
      const members = await pool.query(`
        SELECT membership.id, membership.user_id,
          actor.display_name, actor.username
        FROM development_memberships membership
        JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
        WHERE membership.topic_id = $1
          AND membership.added_at <= now() AND membership.ended_at IS NULL
          AND ${ownerGuard}
        ORDER BY actor.display_name, membership.id
      `, [topicId, actorUserId]);
      const grants = await pool.query(`
        SELECT grant_row.id, grant_row.material_version_id,
          grant_row.grantee_membership_id, grant_row.granted_at,
          member.user_id, actor.display_name, actor.username
        FROM development_restricted_file_grants grant_row
        JOIN development_material_versions version
          ON version.id = grant_row.material_version_id
        JOIN development_materials material ON material.id = version.material_id
        JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
          AND activation.access_class = 'restricted'
        JOIN development_memberships member
          ON member.id = grant_row.grantee_membership_id
          AND member.topic_id = material.topic_id
          AND member.added_at <= now() AND member.ended_at IS NULL
        JOIN users actor ON actor.id = member.user_id AND actor.is_active = true
        WHERE material.topic_id = $1 AND ${ownerGuard}
          AND NOT EXISTS (
            SELECT 1 FROM development_restricted_file_grant_revocations revoked
            WHERE revoked.grant_id = grant_row.id
          )
        ORDER BY grant_row.id DESC
      `, [topicId, actorUserId]);
      const byVersion = new Map(versions.rows.map((row) => [Number(row.id), {
        id: Number(row.id), versionNo: Number(row.version_no),
        originalName: row.original_filename, recordedAt: row.recorded_at,
        uploadedByUserId: Number(row.recorded_by_user_id),
        materialTitle: row.material_title, grants: []
      }]));
      for (const row of grants.rows) {
        byVersion.get(Number(row.material_version_id))?.grants.push({
          id: Number(row.id), membershipId: Number(row.grantee_membership_id),
          userId: Number(row.user_id), displayName: row.display_name,
          username: row.username, grantedAt: row.granted_at
        });
      }
      return {
        versions: [...byVersion.values()],
        members: members.rows.map((row) => ({
          membershipId: Number(row.id), userId: Number(row.user_id),
          displayName: row.display_name, username: row.username
        }))
      };
    },

    async grantRestrictedAccess({ topicId, versionId, membershipId, actorUserId, reason }) {
      const result = await pool.query(`
        INSERT INTO development_restricted_file_grants (
          material_version_id, grantee_membership_id,
          granted_by_owner_user_id, reason
        )
        SELECT version.id, membership.id, $4, $5
        FROM development_material_versions version
        JOIN development_materials material ON material.id = version.material_id
        JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
          AND activation.access_class = 'restricted'
        JOIN development_memberships membership
          ON membership.id = $3 AND membership.topic_id = material.topic_id
          AND membership.added_at <= now() AND membership.ended_at IS NULL
        JOIN users recipient
          ON recipient.id = membership.user_id AND recipient.is_active = true
        WHERE material.topic_id = $1 AND version.id = $2
          AND version.recorded_by_user_id <> membership.user_id
      `, [topicId, versionId, membershipId, actorUserId, reason]);
      return result.rowCount > 0;
    },

    async revokeRestrictedAccess({ topicId, grantId, actorUserId, reason }) {
      const result = await pool.query(`
        INSERT INTO development_restricted_file_grant_revocations (
          grant_id, revoked_by_owner_user_id, reason
        )
        SELECT grant_row.id, $3, $4
        FROM development_restricted_file_grants grant_row
        JOIN development_material_versions version
          ON version.id = grant_row.material_version_id
        JOIN development_materials material ON material.id = version.material_id
        JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
          AND activation.access_class = 'restricted'
        WHERE material.topic_id = $1 AND grant_row.id = $2
          AND NOT EXISTS (
            SELECT 1 FROM development_restricted_file_grant_revocations revoked
            WHERE revoked.grant_id = grant_row.id
          )
      `, [topicId, grantId, actorUserId, reason]);
      return result.rowCount > 0;
    },

    /**
     * The uncommitted activation is not visible to readers. Promote the
     * already-scanned private file before COMMIT so a committed activation
     * never deliberately points at a file we have not placed and verified.
     * A lost connection at COMMIT is ambiguous: callers must retain the
     * promoted file for read-only reconciliation, never delete it on error.
     */
    async registerScannedVersion({
      topicId, materialId, actorUserId, accessClass, prepared, promote
    }) {
      const client = await pool.connect();
      let committed = false;
      let discardClient = false;
      try {
        await client.query('BEGIN');
        const material = await client.query(`
          SELECT id FROM development_materials
          WHERE id = $1 AND topic_id = $2 FOR UPDATE
        `, [materialId, topicId]);
        if (!material.rowCount) {
          throw new Error('Research material does not belong to this topic');
        }
        const next = await client.query(`
          SELECT coalesce(max(version_no), 0) + 1 AS version_no
          FROM development_material_versions WHERE material_id = $1
        `, [materialId]);
        const version = await client.query(`
          INSERT INTO development_material_versions (
            material_id, version_no, original_filename, stored_path,
            mime_type, file_size, sha256, recorded_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, version_no
        `, [materialId, next.rows[0].version_no, prepared.originalName,
          prepared.storedPath, prepared.mimeType, prepared.fileSize,
          prepared.sha256, actorUserId]);
        await client.query(`
          INSERT INTO development_material_file_activations (
            material_version_id, access_class, scan_engine,
            scan_engine_version, scan_signature_version,
            scan_completed_at, activated_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [version.rows[0].id, accessClass, prepared.scan.engine,
          prepared.scan.engineVersion, prepared.scan.signatureVersion,
          prepared.scan.completedAt, actorUserId]);
        await promote();
        await client.query('COMMIT');
        committed = true;
        return {
          id: Number(version.rows[0].id), versionNo: Number(version.rows[0].version_no)
        };
      } catch (error) {
        if (!committed) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // A lost connection makes the COMMIT outcome uncertain. Never
            // return this client to the pool as a healthy transaction.
            discardClient = true;
          }
        }
        throw error;
      } finally {
        client.release(discardClient ? new Error('Research upload transaction lost') : undefined);
      }
    },

    async listVersionStorageRecords() {
      const result = await pool.query(`
        SELECT version.id, material.topic_id, version.stored_path,
          version.file_size, version.sha256,
          activation.id IS NOT NULL AS activated
        FROM development_material_versions version
        JOIN development_materials material ON material.id = version.material_id
        LEFT JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
        ORDER BY version.id
      `);
      return result.rows.map((row) => ({
        versionId: Number(row.id), topicId: Number(row.topic_id),
        storedPath: row.stored_path, fileSize: Number(row.file_size),
        sha256: row.sha256, activated: row.activated
      }));
    },

    async findReadableVersion({ topicId, versionId, actorUserId }) {
      const result = await pool.query(`
        SELECT version.id, version.material_id, material.topic_id,
          version.original_filename, version.stored_path, version.mime_type,
          version.file_size, version.sha256, version.recorded_by_user_id,
          activation.access_class
        FROM development_material_versions version
        JOIN development_materials material ON material.id = version.material_id
        JOIN development_material_file_activations activation
          ON activation.material_version_id = version.id
        WHERE material.topic_id = $1 AND version.id = $2
          AND bestcrm_development_can_read_material_version(version.id, $3)
        LIMIT 1
      `, [topicId, versionId, actorUserId]);
      return mapVersion(result.rows[0]);
    },

    async recordFileAccess({ versionId, actorUserId, accessKind }) {
      const result = await pool.query(`
        INSERT INTO development_material_file_accesses (
          material_version_id, access_kind, accessed_by_user_id
        ) VALUES ($1, $2, $3) RETURNING id
      `, [versionId, accessKind, actorUserId]);
      return Number(result.rows[0].id);
    }
  };
}
