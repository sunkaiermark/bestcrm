CREATE TABLE IF NOT EXISTS user_mfa_settings (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'totp' CHECK (method = 'totp'),
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('pending', 'active', 'disabled')),
  is_required boolean NOT NULL DEFAULT false,
  secret_ciphertext text,
  secret_nonce text,
  secret_auth_tag text,
  secret_key_version integer,
  enrollment_started_at timestamptz,
  enrolled_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_mfa_settings_id_user_unique UNIQUE (id, user_id),
  CONSTRAINT user_mfa_settings_secret_state_check CHECK (
    (
      status = 'disabled'
      AND secret_ciphertext IS NULL
      AND secret_nonce IS NULL
      AND secret_auth_tag IS NULL
      AND secret_key_version IS NULL
    )
    OR (
      status IN ('pending', 'active')
      AND secret_ciphertext IS NOT NULL
      AND secret_nonce IS NOT NULL
      AND secret_auth_tag IS NOT NULL
      AND secret_key_version > 0
      AND enrollment_started_at IS NOT NULL
    )
  ),
  CONSTRAINT user_mfa_settings_enrollment_state_check CHECK (
    (status = 'active' AND enrolled_at IS NOT NULL)
    OR (status <> 'active' AND enrolled_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS user_mfa_settings_active_lookup_idx
  ON user_mfa_settings(user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS user_mfa_settings_administration_idx
  ON user_mfa_settings(is_required DESC, status, user_id);

CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_setting_id bigint NOT NULL,
  code_hash char(64) NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  invalidated_at timestamptz,
  CONSTRAINT user_mfa_recovery_codes_setting_user_fkey
    FOREIGN KEY (mfa_setting_id, user_id)
    REFERENCES user_mfa_settings(id, user_id) ON DELETE CASCADE,
  CONSTRAINT user_mfa_recovery_codes_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_mfa_recovery_codes_unique_hash UNIQUE (mfa_setting_id, code_hash)
);

CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_available_idx
  ON user_mfa_recovery_codes(user_id, code_hash)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_generation_idx
  ON user_mfa_recovery_codes(mfa_setting_id, generation DESC);

CREATE TABLE IF NOT EXISTS user_trusted_devices (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  device_label text NOT NULL,
  user_agent_hash char(64),
  last_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT user_trusted_devices_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_trusted_devices_user_agent_hash_check CHECK (
    user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT user_trusted_devices_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS user_trusted_devices_user_list_idx
  ON user_trusted_devices(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_trusted_devices_expiry_cleanup_idx
  ON user_trusted_devices(expires_at)
  WHERE revoked_at IS NULL;
