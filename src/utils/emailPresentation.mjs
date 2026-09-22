const LIST_OR_HEADING_LINE = /^(?:[-*•]\s+|\d{1,3}[.)]\s+|(?:from|sent|date|to|cc|subject):\s+)/i;
const QUOTED_OR_FORWARDED_LINE = /^(?:>|-{2,}\s*(?:original|forwarded)\s+message\s*-{2,})/i;
const SIGN_OFF_LINE = /^(?:best\s+regards?|kind\s+regards?|regards|sincerely|thanks|thank\s+you|敬上|此致|谢谢)[,，!！]?$/i;
const CJK_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
export const SUNKAIER_SIGNATURE_LOGO_CID = 'sunkaier-signature-logo@sunkaier.com';
export const SUNKAIER_SIGNATURE_LOGO_URL = '/assets/sunkaier-logo-email.png';

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function joinSeparator(previous, next) {
  if (!previous || !next) return '';
  if (previous.endsWith('-') || CJK_EDGE.test(previous) && CJK_START.test(next)) return '';
  return ' ';
}

function reflowBlock(block) {
  const lines = block.split('\n').map((line) => line.trimEnd());
  if (lines.some((line) => QUOTED_OR_FORWARDED_LINE.test(line.trim()))) return lines.join('\n').trim();
  if (SIGN_OFF_LINE.test(lines[0]?.trim() || '')) return lines.join('\n').trim();

  const output = [];
  let current = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (LIST_OR_HEADING_LINE.test(line)) {
      if (current) output.push(current);
      current = line;
      continue;
    }
    if (!current) {
      current = line;
      continue;
    }
    current += `${joinSeparator(current, line)}${line}`;
  }
  if (current) output.push(current);
  return output.join('\n');
}

export function formatPlainEmailForReading(value) {
  const normalized = String(value || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  return normalized
    .split(/\n[\t ]*\n+/)
    .map(reflowBlock)
    .filter(Boolean)
    .join('\n\n');
}

function normalizedContentId(value) {
  return String(value || '').trim().replace(/^<|>$/g, '');
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveInlineEmailContent(html, attachments = []) {
  let content = String(html || '');
  for (const attachment of attachments) {
    const contentId = normalizedContentId(attachment?.contentId);
    const attachmentId = Number(attachment?.id);
    if (!contentId || !Number.isInteger(attachmentId) || attachmentId <= 0) continue;
    const cidPattern = new RegExp(`cid:(?:%3C|<)?${escapedRegExp(contentId)}(?:%3E|>)?`, 'gi');
    content = content.replace(cidPattern, `/email-center/attachments/${attachmentId}/inline`);
  }

  // Older BESTCRM outbound messages referenced the branded logo in MIME but did
  // not index that inline part in email_attachments. Keep those immutable
  // records readable by resolving only the known company-owned CID locally.
  const signatureLogoPattern = new RegExp(
    `cid:(?:%3C|<)?${escapedRegExp(SUNKAIER_SIGNATURE_LOGO_CID)}(?:%3E|>)?`,
    'gi'
  );
  content = content.replace(signatureLogoPattern, SUNKAIER_SIGNATURE_LOGO_URL);

  // A missing inline part must not leave a large broken-image frame that can
  // obscure the rest of the message. The original HTML remains unchanged in
  // the archive; this replacement is presentation-only.
  content = content.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!/\bsrc\s*=\s*(["'])\s*cid:/i.test(tag)) return tag;
    return tag.replace(
      /\bsrc\s*=\s*(["'])\s*cid:[^"']*\1/i,
      `src="${TRANSPARENT_PIXEL}" data-email-inline-missing="true"`
    );
  });
  return content.replace(/url\(\s*(["']?)cid:[^)]+\1\s*\)/gi, 'none');
}
