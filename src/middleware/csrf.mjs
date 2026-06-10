import { randomBytes, timingSafeEqual } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createToken() {
  return randomBytes(32).toString('base64url');
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isMultipartRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data');
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureCsrfToken(req) {
  if (!req.session) {
    return '';
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = createToken();
  }
  return req.session.csrfToken;
}

export function validateCsrfToken(req) {
  const expectedToken = req.session?.csrfToken;
  const submittedToken = req.body?._csrf || req.get('x-csrf-token');
  return Boolean(expectedToken && submittedToken && safeCompare(submittedToken, expectedToken));
}

export function csrfProtection({ enabled = true } = {}) {
  return (req, res, next) => {
    const token = ensureCsrfToken(req);
    req.csrfProtectionEnabled = enabled;
    req.validateCsrf = () => validateCsrfToken(req);
    res.locals.csrfToken = token;
    res.locals.csrfField = () => token
      ? `<input type="hidden" name="_csrf" value="${escapeAttribute(token)}">`
      : '';

    if (!enabled || SAFE_METHODS.has(req.method) || isMultipartRequest(req)) {
      next();
      return;
    }

    if (!validateCsrfToken(req)) {
      res.status(403).send('Invalid CSRF token');
      return;
    }

    next();
  };
}
