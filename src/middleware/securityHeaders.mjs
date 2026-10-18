export const BASE_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-src 'self'",
  "media-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'"
].join('; ');

export function securityHeaders({ enableHsts = false } = {}) {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', BASE_CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (enableHsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  };
}
