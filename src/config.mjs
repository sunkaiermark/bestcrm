import 'dotenv/config';

function booleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function numberEnv(value, defaultValue) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : defaultValue;
}

function positiveIntegerEnv(value, defaultValue) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : defaultValue;
}

function isBase64Encoded32ByteKey(value) {
  const encoded = String(value || '').trim();
  if (!encoded) {
    return false;
  }
  try {
    const decoded = Buffer.from(encoded, 'base64');
    return decoded.length === 32 && decoded.toString('base64') === encoded;
  } catch {
    return false;
  }
}

function requireHttpsUrl(value, name) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') throw new Error('not https');
    return url;
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const baseUrl = env.BASE_URL || 'http://127.0.0.1:3000';
  const sessionSecret = env.SESSION_SECRET || '';
  if (nodeEnv === 'production' && !sessionSecret) {
    throw new Error('SESSION_SECRET is required in production');
  }
  const sessionCookieSecure = 'SESSION_COOKIE_SECURE' in env
    ? env.SESSION_COOKIE_SECURE !== 'false'
    : nodeEnv === 'production' && baseUrl.startsWith('https://');
  const authenticatorMfaEnabled = booleanEnv(env.LOGIN_TOTP_2FA_ENABLED, false);
  const authenticatorMfaTrustDays = positiveIntegerEnv(env.LOGIN_TOTP_TRUST_DAYS, 10);
  const authenticatorMfaEncryptionKey = String(env.TOTP_ENCRYPTION_KEY || '').trim();
  const authenticatorMfaEncryptionKeyVersion = positiveIntegerEnv(env.TOTP_ENCRYPTION_KEY_VERSION, 1);
  const authenticatorMfaRecoveryCodePepper = String(env.TOTP_RECOVERY_CODE_PEPPER || '').trim();
  const emailCenterEnabled = booleanEnv(env.CRM_EMAIL_CENTER_ENABLED ?? env.EMAIL_CENTER_ENABLED, false);
  const googleMailEnabled = booleanEnv(env.GOOGLE_MAIL_ENABLED, false);
  const googleMailInboundEnabled = booleanEnv(env.GOOGLE_MAIL_INBOUND_ENABLED, false);
  const googleMailOutboundEnabled = booleanEnv(env.GOOGLE_MAIL_OUTBOUND_ENABLED, false);
  const googleMailPushEnabled = booleanEnv(env.GOOGLE_MAIL_PUSH_ENABLED, false);
  const googleMailMailboxAddress = String(env.GOOGLE_MAILBOX_ADDRESS || 'sales@sunkaier.com').trim().toLowerCase();
  const googleMailOauthClientId = String(env.GOOGLE_MAIL_OAUTH_CLIENT_ID || '').trim();
  const googleMailOauthClientSecret = String(env.GOOGLE_MAIL_OAUTH_CLIENT_SECRET || '').trim();
  const googleMailOauthRedirectUri = String(env.GOOGLE_MAIL_OAUTH_REDIRECT_URI || '').trim();
  const mailOauthEncryptionKey = String(env.MAIL_OAUTH_ENCRYPTION_KEY || '').trim();
  const mailOauthEncryptionKeyVersion = positiveIntegerEnv(env.MAIL_OAUTH_ENCRYPTION_KEY_VERSION, 1);
  const googleMailPubsubTopic = String(env.GOOGLE_MAIL_PUBSUB_TOPIC || '').trim();
  const googleMailPubsubAudience = String(env.GOOGLE_MAIL_PUBSUB_AUDIENCE || '').trim();

  if (nodeEnv === 'production' && authenticatorMfaEnabled) {
    if (authenticatorMfaTrustDays !== 10) {
      throw new Error('LOGIN_TOTP_TRUST_DAYS must be 10 for Authenticator MFA V1');
    }
    if (!isBase64Encoded32ByteKey(authenticatorMfaEncryptionKey)) {
      throw new Error('TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    if (String(env.TOTP_ENCRYPTION_KEY_VERSION || '1') !== String(authenticatorMfaEncryptionKeyVersion)) {
      throw new Error('TOTP_ENCRYPTION_KEY_VERSION must be a positive integer');
    }
    if (authenticatorMfaRecoveryCodePepper.length < 32) {
      throw new Error('TOTP_RECOVERY_CODE_PEPPER must be at least 32 characters');
    }
    if (authenticatorMfaEncryptionKey === sessionSecret) {
      throw new Error('TOTP_ENCRYPTION_KEY must not reuse SESSION_SECRET');
    }
    if (authenticatorMfaRecoveryCodePepper === sessionSecret) {
      throw new Error('TOTP_RECOVERY_CODE_PEPPER must not reuse SESSION_SECRET');
    }
    if (authenticatorMfaRecoveryCodePepper === authenticatorMfaEncryptionKey) {
      throw new Error('TOTP_RECOVERY_CODE_PEPPER must not reuse TOTP_ENCRYPTION_KEY');
    }
  }

  if ((googleMailInboundEnabled || googleMailOutboundEnabled || googleMailPushEnabled) && !googleMailEnabled) {
    throw new Error('GOOGLE_MAIL_ENABLED must be true before enabling Google mail sub-features');
  }
  if (googleMailPushEnabled && !googleMailInboundEnabled) {
    throw new Error('GOOGLE_MAIL_INBOUND_ENABLED must be true before enabling Google mail push');
  }

  if (nodeEnv === 'production' && googleMailEnabled) {
    if (!emailCenterEnabled) {
      throw new Error('CRM_EMAIL_CENTER_ENABLED must be true before enabling Google mail');
    }
    if (googleMailMailboxAddress !== 'sales@sunkaier.com') {
      throw new Error('GOOGLE_MAILBOX_ADDRESS must be sales@sunkaier.com for V1');
    }
    if (!googleMailOauthClientId) {
      throw new Error('GOOGLE_MAIL_OAUTH_CLIENT_ID is required when Google mail is enabled');
    }
    if (!googleMailOauthClientId.endsWith('.apps.googleusercontent.com')) {
      throw new Error('GOOGLE_MAIL_OAUTH_CLIENT_ID must be a Google OAuth web client ID');
    }
    if (!googleMailOauthClientSecret) {
      throw new Error('GOOGLE_MAIL_OAUTH_CLIENT_SECRET is required when Google mail is enabled');
    }
    const base = requireHttpsUrl(baseUrl, 'BASE_URL');
    const redirect = requireHttpsUrl(googleMailOauthRedirectUri, 'GOOGLE_MAIL_OAUTH_REDIRECT_URI');
    if (base.origin !== redirect.origin) {
      throw new Error('GOOGLE_MAIL_OAUTH_REDIRECT_URI must use the BASE_URL origin');
    }
    if (redirect.pathname !== '/system/mail-connections/google/callback' || redirect.search || redirect.hash) {
      throw new Error('GOOGLE_MAIL_OAUTH_REDIRECT_URI must use the frozen Google callback path');
    }
    if (!isBase64Encoded32ByteKey(mailOauthEncryptionKey)) {
      throw new Error('MAIL_OAUTH_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    if (String(env.MAIL_OAUTH_ENCRYPTION_KEY_VERSION || '1') !== String(mailOauthEncryptionKeyVersion)) {
      throw new Error('MAIL_OAUTH_ENCRYPTION_KEY_VERSION must be a positive integer');
    }
    for (const [name, value] of [
      ['SESSION_SECRET', sessionSecret],
      ['TOTP_ENCRYPTION_KEY', authenticatorMfaEncryptionKey],
      ['TOTP_RECOVERY_CODE_PEPPER', authenticatorMfaRecoveryCodePepper],
      ['GOOGLE_MAIL_OAUTH_CLIENT_SECRET', googleMailOauthClientSecret]
    ]) {
      if (value && mailOauthEncryptionKey === value) {
        throw new Error(`MAIL_OAUTH_ENCRYPTION_KEY must not reuse ${name}`);
      }
    }
    if (googleMailOauthClientSecret === sessionSecret) {
      throw new Error('GOOGLE_MAIL_OAUTH_CLIENT_SECRET must not reuse SESSION_SECRET');
    }
    if (googleMailPushEnabled) {
      if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(googleMailPubsubTopic)) {
        throw new Error('GOOGLE_MAIL_PUBSUB_TOPIC must be a full Google Cloud Pub/Sub topic name');
      }
      const audience = requireHttpsUrl(googleMailPubsubAudience, 'GOOGLE_MAIL_PUBSUB_AUDIENCE');
      if (audience.origin !== base.origin
        || audience.pathname !== '/api/mail/google/pubsub'
        || audience.search
        || audience.hash) {
        throw new Error('GOOGLE_MAIL_PUBSUB_AUDIENCE must use the frozen BESTCRM Pub/Sub callback');
      }
    }
  }

  return {
    nodeEnv,
    port: Number(env.PORT || 3000),
    baseUrl,
    databaseUrl: env.DATABASE_URL || '',
    sessionSecret: sessionSecret || 'dev-session-secret',
    sessionCookieSecure,
    inquiryIntakeSecret: env.INQUIRY_INTAKE_SECRET || '',
    chatwootInquiryIntakeSecret: env.CHATWOOT_INQUIRY_INTAKE_SECRET || '',
    bidCenter: {
      enabled: booleanEnv(env.BID_CENTER_ENABLED, false)
    },
    emailCenter: {
      enabled: emailCenterEnabled
    },
    googleMail: {
      enabled: googleMailEnabled,
      inboundEnabled: googleMailInboundEnabled,
      outboundEnabled: googleMailOutboundEnabled,
      pushEnabled: googleMailPushEnabled,
      providerName: 'google_gmail',
      mailboxAddress: googleMailMailboxAddress,
      reconcileIntervalMs: numberEnv(env.GOOGLE_MAIL_RECONCILE_INTERVAL_MS, 5 * 60 * 1000),
      watchRenewalIntervalMs: numberEnv(env.GOOGLE_MAIL_WATCH_RENEWAL_INTERVAL_MS, 24 * 60 * 60 * 1000),
      oauth: {
        clientId: googleMailOauthClientId,
        clientSecret: googleMailOauthClientSecret,
        redirectUri: googleMailOauthRedirectUri,
        encryptionKey: mailOauthEncryptionKey,
        encryptionKeyVersion: mailOauthEncryptionKeyVersion
      },
      pubsub: {
        topic: googleMailPubsubTopic,
        audience: googleMailPubsubAudience
      }
    },
    customerEmail: {
      enabled: booleanEnv(env.CRM_EMAIL_SENDING_ENABLED, false),
      sharedAddress: 'sales@sunkaier.com',
      maxUploadMb: numberEnv(env.CRM_EMAIL_MAX_UPLOAD_MB, 25),
      smtp: {
        host: env.CUSTOMER_SMTP_HOST || env.SMTP_HOST || '',
        port: numberEnv(env.CUSTOMER_SMTP_PORT || env.SMTP_PORT, booleanEnv(env.CUSTOMER_SMTP_SECURE ?? env.SMTP_SECURE, true) ? 465 : 587),
        secure: booleanEnv(env.CUSTOMER_SMTP_SECURE ?? env.SMTP_SECURE, true),
        user: env.CUSTOMER_SMTP_USER || env.SMTP_USER || '',
        password: env.CUSTOMER_SMTP_PASSWORD || env.SMTP_PASSWORD || ''
      }
    },
    emailIntake: {
      enabled: booleanEnv(env.EMAIL_INTAKE_ENABLED, false),
      host: env.EMAIL_INTAKE_HOST || '',
      port: numberEnv(env.EMAIL_INTAKE_PORT, booleanEnv(env.EMAIL_INTAKE_SECURE, true) ? 993 : 143),
      secure: booleanEnv(env.EMAIL_INTAKE_SECURE, true),
      user: env.EMAIL_INTAKE_USER || '',
      password: env.EMAIL_INTAKE_PASSWORD || '',
      mailbox: env.EMAIL_INTAKE_MAILBOX || 'INBOX',
      mailboxKey: env.EMAIL_INTAKE_MAILBOX_KEY || env.EMAIL_INTAKE_USER || 'sales',
      pollIntervalMs: numberEnv(env.EMAIL_INTAKE_POLL_INTERVAL_MS, 5 * 60 * 1000),
      maxMessages: numberEnv(env.EMAIL_INTAKE_MAX_MESSAGES, 20),
      markSeen: booleanEnv(env.EMAIL_INTAKE_MARK_SEEN, false)
    },
    notificationDelivery: {
      enabled: booleanEnv(env.NOTIFICATION_DELIVERY_ENABLED, false),
      pollIntervalMs: numberEnv(env.NOTIFICATION_DELIVERY_POLL_INTERVAL_MS, 10 * 1000),
      batchSize: numberEnv(env.NOTIFICATION_DELIVERY_BATCH_SIZE, 20),
      webPush: {
        publicKey: env.WEB_PUSH_PUBLIC_KEY || '',
        privateKey: env.WEB_PUSH_PRIVATE_KEY || '',
        subject: env.WEB_PUSH_SUBJECT || 'mailto:sales@sunkaier.com'
      },
      smtp: {
        host: env.SMTP_HOST || '',
        port: numberEnv(env.SMTP_PORT, booleanEnv(env.SMTP_SECURE, true) ? 465 : 587),
        secure: booleanEnv(env.SMTP_SECURE, true),
        user: env.SMTP_USER || '',
        password: env.SMTP_PASSWORD || '',
        from: env.SMTP_FROM || 'BESTCRM <sales@sunkaier.com>'
      },
      sms: {
        secretId: env.TENCENT_SMS_SECRET_ID || '',
        secretKey: env.TENCENT_SMS_SECRET_KEY || '',
        region: env.TENCENT_SMS_REGION || 'ap-guangzhou',
        sdkAppId: env.TENCENT_SMS_SDK_APP_ID || '',
        signName: env.TENCENT_SMS_SIGN_NAME || '',
        templateId: env.TENCENT_SMS_TEMPLATE_ID || ''
      }
    },
    loginSecondFactor: {
      enabled: booleanEnv(env.LOGIN_SMS_2FA_ENABLED, false),
      codeTtlMinutes: numberEnv(env.LOGIN_SMS_2FA_CODE_TTL_MINUTES, 5),
      maxAttempts: numberEnv(env.LOGIN_SMS_2FA_MAX_ATTEMPTS, 5),
      resendCooldownSeconds: numberEnv(env.LOGIN_SMS_2FA_RESEND_COOLDOWN_SECONDS, 60),
      sms: {
        secretId: env.TENCENT_SMS_SECRET_ID || '',
        secretKey: env.TENCENT_SMS_SECRET_KEY || '',
        region: env.TENCENT_SMS_REGION || 'ap-guangzhou',
        sdkAppId: env.TENCENT_SMS_SDK_APP_ID || '',
        signName: env.TENCENT_SMS_SIGN_NAME || '',
        templateId: env.TENCENT_SMS_LOGIN_TEMPLATE_ID || ''
      }
    },
    authenticatorMfa: {
      enabled: authenticatorMfaEnabled,
      trustDays: authenticatorMfaTrustDays,
      issuer: String(env.LOGIN_TOTP_ISSUER || 'BESTCRM').trim() || 'BESTCRM',
      encryptionKey: authenticatorMfaEncryptionKey,
      encryptionKeyVersion: authenticatorMfaEncryptionKeyVersion,
      recoveryCodePepper: authenticatorMfaRecoveryCodePepper
    },
    uploadDir: env.UPLOAD_DIR || './var/uploads',
    technicalDocumentFontPath: env.TECHNICAL_DOCUMENT_FONT_PATH || '',
    maxUploadMb: numberEnv(env.MAX_UPLOAD_MB, 3072)
  };
}
