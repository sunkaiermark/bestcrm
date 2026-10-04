import DOMPurify from 'dompurify';
import { convert } from 'html-to-text';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

const ALLOWED_TAGS = [
  'p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span',
  'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td'
];

const TABLE_STYLE = 'border-collapse:collapse;width:100%;max-width:100%;margin:10px 0;';
const CELL_STYLE = 'border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top;';

function boundedSpan(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 20 ? String(number) : null;
}

function boundedWidth(value) {
  const match = /^([1-9]\d?)%$/.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}

function tableColumnWidths(table) {
  const rows = Array.from(table.rows).filter((row) => row.closest('table') === table);
  const cells = Array.from(rows[0]?.cells || []);
  if (cells.length < 2 || cells.length > 20) return null;
  const widths = cells.map((cell) => boundedWidth(cell.getAttribute('width')));
  if (widths.some((width) => width === null) || widths.reduce((sum, width) => sum + width, 0) !== 100) return null;
  if (!rows.every((row) => row.cells.length === widths.length && Array.from(row.cells).every((cell, index) =>
    cell.colSpan === 1 && cell.rowSpan === 1 && boundedWidth(cell.getAttribute('width')) === widths[index]))) return null;
  return widths;
}

export function sanitizeRichEmailBody(rawHtml) {
  const fragment = purify.sanitize(String(rawHtml || ''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['colspan', 'rowspan', 'width'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  });
  const container = window.document.createElement('div');
  container.append(fragment);

  // Widths are accepted only as a complete, consistent percentage set for a plain table.
  // Pasted styles, URLs, event handlers, and other attributes never survive.
  for (const node of container.querySelectorAll('[width]')) {
    if (!['TD', 'TH'].includes(node.tagName)) node.removeAttribute('width');
  }
  for (const cell of container.querySelectorAll('td, th')) {
    if (!cell.closest('table')) cell.removeAttribute('width');
    cell.setAttribute('style', `${CELL_STYLE}${cell.tagName === 'TH' ? 'font-weight:700;' : ''}`);
    for (const attribute of ['colspan', 'rowspan']) {
      const value = boundedSpan(cell.getAttribute(attribute));
      if (value) cell.setAttribute(attribute, value);
      else cell.removeAttribute(attribute);
    }
  }
  for (const table of container.querySelectorAll('table')) {
    const widths = tableColumnWidths(table);
    table.setAttribute('style', `${TABLE_STYLE}${widths ? 'table-layout:fixed;' : ''}`);
    for (const row of Array.from(table.rows).filter((item) => item.closest('table') === table)) {
      Array.from(row.cells).forEach((cell, index) => {
        const width = widths?.[index];
        if (width) cell.setAttribute('width', `${width}%`);
        else cell.removeAttribute('width');
        cell.setAttribute('style', `${CELL_STYLE}${width ? `width:${width}%;` : ''}${cell.tagName === 'TH' ? 'font-weight:700;' : ''}`);
      });
    }
  }

  const html = container.innerHTML;
  const text = convert(html, {
    wordwrap: false,
    selectors: [{ selector: 'table', format: 'dataTable' }]
  }).trim();
  const hasVisibleText = container.textContent.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().length > 0;
  return { html, text: hasVisibleText ? text : '' };
}
