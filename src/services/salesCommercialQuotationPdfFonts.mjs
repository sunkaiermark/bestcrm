import { existsSync } from 'node:fs';

const PRIMARY_FONT_CANDIDATES = [
  { path: 'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf' },
  { path: 'C:\\Windows\\Fonts\\Deng.ttf' },
  {
    path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    postscriptName: 'NotoSansCJKsc-Regular'
  },
  {
    path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    postscriptName: 'NotoSansCJKsc-Regular'
  }
];

const KOREAN_FONT_CANDIDATES = [
  { path: 'C:\\Windows\\Fonts\\malgun.ttf' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf' },
  { path: '/usr/share/fonts/truetype/noto/NotoSansKR-Regular.ttf' },
  {
    path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    postscriptName: 'NotoSansCJKkr-Regular'
  },
  {
    path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    postscriptName: 'NotoSansCJKkr-Regular'
  }
];

function explicitFontCandidate(fontPath) {
  if (!fontPath) return null;
  if (/[/\\]NotoSansCJK-Regular\.ttc$/i.test(fontPath)) {
    return { path: fontPath, postscriptName: 'NotoSansCJKsc-Regular' };
  }
  return { path: fontPath };
}

function firstExisting(candidates, fileExists) {
  return candidates.filter(Boolean).find((candidate) => fileExists(candidate.path)) || null;
}

export function resolveSalesCommercialQuotationPdfFonts(fontPath = '', fileExists = existsSync) {
  const primary = firstExisting([
    explicitFontCandidate(fontPath),
    ...PRIMARY_FONT_CANDIDATES
  ], fileExists);
  if (!primary) return null;
  return {
    primary,
    korean: firstExisting(KOREAN_FONT_CANDIDATES, fileExists) || primary
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
