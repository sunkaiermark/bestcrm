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

export function sanitizeRichEmailBody(rawHtml) {
  const fragment = purify.sanitize(String(rawHtml || ''), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['colspan', 'rowspan'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  });
  const container = window.document.createElement('div');
  container.append(fragment);

  // These fixed styles are added only to already-sanitized table elements.
  // No pasted style, URL, event handler, image, or other attribute survives.
  for (const table of container.querySelectorAll('table')) {
    table.setAttribute('style', TABLE_STYLE);
  }
  for (const cell of container.querySelectorAll('td, th')) {
    cell.setAttribute('style', `${CELL_STYLE}${cell.tagName === 'TH' ? 'font-weight:700;' : ''}`);
    for (const attribute of ['colspan', 'rowspan']) {
      const value = boundedSpan(cell.getAttribute(attribute));
      if (value) cell.setAttribute(attribute, value);
      else cell.removeAttribute(attribute);
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
