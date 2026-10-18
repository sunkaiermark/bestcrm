import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BUNDLED_QUOTATION_FONT_PATH = fileURLToPath(
  new URL('../assets/fonts/NotoSansCJKsc-Regular.otf', import.meta.url)
);

const PRIMARY_FONT_CANDIDATES = [
  { path: BUNDLED_QUOTATION_FONT_PATH },
  { path: 'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf' },
  { path: 'C:\\Windows\\Fonts\\Deng.ttf' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf' },
  { path: '/usr/share/fonts/truetype/noto/NotoSansCJKsc-Regular.otf' }
];

const KOREAN_FONT_CANDIDATES = [
  { path: 'C:\\Windows\\Fonts\\malgun.ttf' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf' },
  { path: '/usr/share/fonts/truetype/noto/NotoSansKR-Regular.ttf' }
];

function explicitFontCandidate(fontPath) {
  if (!fontPath) return null;
  // PDFKit/fontkit may open a TTC face without throwing while still emitting
  // unusable glyph mappings. A quotation must fail over to a standalone font
  // instead of producing a customer-facing PDF full of missing-glyph boxes.
  if (/\.ttc$/i.test(fontPath)) return null;
  return { path: fontPath };
}

function firstExisting(candidates, fileExists) {
  return candidates.filter(Boolean).find((candidate) => fileExists(candidate.path)) || null;
}

export function resolveSalesCommercialQuotationPdfFonts(fontPath = '', fileExists = existsSync) {
  const primary = firstExisting([
    ...PRIMARY_FONT_CANDIDATES,
    explicitFontCandidate(fontPath)
  ], fileExists);
  if (!primary) return null;
  return {
    primary,
    korean: firstExisting([
      { path: BUNDLED_QUOTATION_FONT_PATH },
      ...KOREAN_FONT_CANDIDATES
    ], fileExists) || primary
  };
}

function registerFont(document, name, font) {
  if (font.postscriptName) {
    document.registerFont(name, font.path, font.postscriptName);
  } else {
    document.registerFont(name, font.path);
  }
}

export function registerSalesCommercialQuotationPdfFonts(document, fonts) {
  registerFont(document, 'quotation', fonts.primary);
  registerFont(document, 'quotation-korean', fonts.korean);
}
