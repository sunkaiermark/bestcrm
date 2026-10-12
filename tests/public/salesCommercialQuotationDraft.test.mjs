import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const draftScript = readFileSync(new URL('../../src/public/assets/sales-commercial-quotation-draft.js', import.meta.url), 'utf8');

test('every retained quotation row contributes to draft subtotal, tax, and total', () => {
  const dom = new JSDOM(`<!doctype html>
    <input name="currency" value="USD"><input name="taxRate" value="9">
    <table><tbody id="sales-quote-draft-rows">
      <tr class="draft-row"><th><span class="draft-row-number">1</span></th><td>
        <textarea name="description">Mixer</textarea><input name="quantity" value="1">
        <input name="unit" value="set"><input name="unitPrice" value="100">
        <span data-line-amount></span><button type="button" data-remove-quote-row>Remove</button>
      </td></tr>
      <tr class="draft-row"><th><span class="draft-row-number">2</span></th><td>
        <textarea name="description">Spare seal</textarea><input name="quantity" value="2">
        <input name="unit" value="piece"><input name="unitPrice" value="20">
        <span data-line-amount></span><button type="button" data-remove-quote-row>Remove</button>
      </td></tr>
    </tbody></table>
    <button type="button" data-add-quote-row>Add row</button>
    <strong data-draft-subtotal></strong><strong data-draft-tax-amount></strong><strong data-draft-grand-total></strong>`,
  { runScripts: 'outside-only' });
  try {
    dom.window.eval(draftScript);
    const { document, Event } = dom.window;
    assert.equal(document.querySelector('[data-draft-subtotal]').textContent, 'USD 140.00');
    assert.equal(document.querySelector('[data-draft-tax-amount]').textContent, 'USD 12.60');
    assert.equal(document.querySelector('[data-draft-grand-total]').textContent, 'USD 152.60');

    document.querySelectorAll('[data-remove-quote-row]')[1].click();
    assert.equal(document.querySelector('[data-draft-grand-total]').textContent, 'USD 109.00');

    document.querySelector('[data-add-quote-row]').click();
    assert.equal(document.querySelector('[data-draft-grand-total]').textContent, 'USD 109.00');
    const newPrice = document.querySelectorAll('[name="unitPrice"]')[1];
    newPrice.value = '20';
    newPrice.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(document.querySelector('[data-draft-grand-total]').textContent, '—');
  } finally {
    dom.window.close();
  }
});
