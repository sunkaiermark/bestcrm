# Quotation PDF font

`NotoSansCJKsc-Regular.otf` is the standalone fixed-weight Simplified Chinese
font used by commercial quotation preview and formal PDF generation. It also
contains the Hangul glyphs needed by Korean customer contacts. Keeping this
font in the release makes rendering independent from Linux font packages and
avoids PDFKit/fontkit collection-font (`.ttc`) embedding failures.

- Family: Noto Sans SC
- Upstream: https://github.com/notofonts/noto-cjk
- License: SIL Open Font License 1.1 (`LICENSE-NOTO-CJK.txt`)
- Upstream commit: `523d033d6cb47f4a80c58a35753646f5c3608a78`
- Git blob SHA-1: `dc15562470b4f842321894787a0d066879ccff8b`
- SHA-256: `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`
