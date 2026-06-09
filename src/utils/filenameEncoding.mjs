export function normalizeUploadedFilename(filename) {
  const value = String(filename || 'attachment');
  if (!/[\u0080-\u009fÃÂÅÆÐÑæçå]/.test(value)) {
    return value;
  }
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD')) {
    return value;
  }
  return decoded;
}
