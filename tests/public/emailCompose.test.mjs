import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const purifyScript = readFileSync(path.join(process.cwd(), 'node_modules', 'dompurify', 'dist', 'purify.min.js'), 'utf8');
const composeScript = readFileSync(new URL('../../src/public/assets/email-compose.js', import.meta.url), 'utf8');

function createEditor() {
  const dom = new JSDOM(`<!doctype html><form><div data-email-editor>
    <textarea name="body" required></textarea><input name="bodyHtml" type="hidden">
    <div class="customer-email-rich-controls" hidden>
      <button type="button" data-email-format="bold">B</button>
      <button type="button" data-email-insert-table>Table</button>
      <button type="button" data-email-set-column-widths aria-expanded="false">Set column widths</button>
      <div data-email-column-width-panel data-column-label="Column {n}" data-no-table-label="Select a cell"
        data-merged-label="Merged cells are unsupported" data-invalid-label="Widths must add to 100" hidden>
        <div data-email-column-width-inputs></div>
        <button type="button" data-email-apply-column-widths>Apply</button>
        <button type="button" data-email-cancel-column-widths>Cancel</button>
      </div>
      <p data-email-column-width-error hidden></p>
      <div data-email-rich-body contenteditable="true"></div>
      <p data-email-editor-error hidden>Message is required</p>
    </div>
    </div><button type="submit">Save</button></form>`, { runScripts: 'outside-only' });
  dom.window.eval(purifyScript);
  dom.window.eval(composeScript);
  return dom;
}

test('rich editor pastes a safe table and submits its HTML separately from plain fallback', () => {
  const dom = createEditor();
  try {
    const { document, Event } = dom.window;
    const editor = document.querySelector('[data-email-rich-body]');
    assert.equal(document.querySelector('textarea[name="body"]').hidden, true);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: {
      getData(type) {
        return type === 'text/html'
          ? '<table><tr><td width="90%" style="color:red" onclick="alert(1)">Mixer</td><td>USD 100</td></tr></table><img src="https://tracker.example/open">'
          : 'Mixer\tUSD 100';
      }
    } });
    editor.dispatchEvent(paste);
    assert.match(editor.innerHTML, /<table>/);
    assert.doesNotMatch(editor.innerHTML, /width=|style=|onclick|tracker\.example|<img/i);
    document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    const html = document.querySelector('input[name="bodyHtml"]').value;
    assert.match(html, /<table>/);
    assert.match(html, /USD 100/);
    assert.doesNotMatch(html, /onclick|tracker\.example|<img/i);
  } finally {
    dom.window.close();
  }
});

test('rich editor keeps an empty message from submitting', () => {
  const dom = createEditor();
  try {
    const { document, Event } = dom.window;
    const submit = new Event('submit', { cancelable: true });
    const form = document.querySelector('form');
    let laterSubmitHandlerRan = false;
    form.addEventListener('submit', () => { laterSubmitHandlerRan = true; });
    form.dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, true);
    assert.equal(laterSubmitHandlerRan, false);
    assert.equal(document.querySelector('[data-email-editor-error]').hidden, false);
  } finally {
    dom.window.close();
  }
});

test('rich editor sets and submits percentage widths for a selected table', () => {
  const dom = createEditor();
  try {
    const { document, Event } = dom.window;
    const editor = document.querySelector('[data-email-rich-body]');
    editor.innerHTML = '<table><tbody><tr><th>Item</th><th>Price</th></tr><tr><td>Mixer</td><td>100</td></tr></tbody></table>';
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector('td'));
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);

    document.querySelector('[data-email-set-column-widths]').click();
    const panel = document.querySelector('[data-email-column-width-panel]');
    assert.equal(panel.hidden, false);
    const widths = panel.querySelectorAll('input');
    assert.deepEqual(Array.from(widths, (input) => input.value), ['50', '50']);
    widths[0].value = '70';
    widths[1].value = '20';
    document.querySelector('[data-email-apply-column-widths]').click();
    assert.match(document.querySelector('[data-email-column-width-error]').textContent, /100/);
    assert.equal(editor.querySelector('td').hasAttribute('width'), false);

    widths[1].value = '30';
    document.querySelector('[data-email-apply-column-widths]').click();
    assert.equal(panel.hidden, true);
    assert.deepEqual(Array.from(editor.querySelectorAll('tr'), (row) =>
      Array.from(row.cells, (cell) => cell.getAttribute('width'))), [['70%', '30%'], ['70%', '30%']]);
    assert.equal(editor.querySelector('table').style.tableLayout, 'fixed');
    document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    const html = document.querySelector('input[name="bodyHtml"]').value;
    assert.match(html, /width="70%"/);
    assert.match(html, /width="30%"/);
    assert.doesNotMatch(html, /style=/);
  } finally {
    dom.window.close();
  }
});

test('rich editor requires a selected cell and a table without merged cells', () => {
  const dom = createEditor();
  try {
    const { document } = dom.window;
    const button = document.querySelector('[data-email-set-column-widths]');
    const panel = document.querySelector('[data-email-column-width-panel]');
    button.click();
    assert.equal(panel.hidden, true);
    assert.match(document.querySelector('[data-email-column-width-error]').textContent, /Select a cell/);

    const editor = document.querySelector('[data-email-rich-body]');
    editor.innerHTML = '<table><tr><td colspan="2">Merged</td></tr><tr><td>A</td><td>B</td></tr></table>';
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector('td'));
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    button.click();
    assert.equal(panel.hidden, true);
    assert.match(document.querySelector('[data-email-column-width-error]').textContent, /Merged cells/);
  } finally {
    dom.window.close();
  }
});

test('cancelling an unfinished width edit does not block the email form', () => {
  const dom = createEditor();
  try {
    const { document } = dom.window;
    const editor = document.querySelector('[data-email-rich-body]');
    editor.innerHTML = '<table><tr><td>A</td><td>B</td></tr></table>';
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector('td'));
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    document.querySelector('[data-email-set-column-widths]').click();
    document.querySelector('[data-email-column-width-inputs] input').value = '';
    document.querySelector('[data-email-cancel-column-widths]').click();
    assert.equal(document.querySelectorAll('[data-email-column-width-inputs] input').length, 0);
    assert.equal(document.querySelector('form').checkValidity(), true);
  } finally {
    dom.window.close();
  }
});
