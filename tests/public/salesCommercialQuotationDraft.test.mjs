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

test('a selected typical term can be edited for one quotation without keeping a second row open', () => {
  const dom = new JSDOM(`<!doctype html>
    <form id="sales-quote-draft-form"></form>
    <div data-term-control data-term-invalid-message="Complete the wording.">
      <div class="draft-term-row">
        <select data-standard-term-select>
          <option value="">Select a typical term</option>
          <option value="fca" data-term-template-body="FCA [Named Place], Incoterms® 2020.">FCA [Named Place], Incoterms® 2020.</option>
        </select>
        <button type="button" data-term-edit-button disabled>Edit</button>
      </div>
      <div data-term-editor hidden>
        <textarea data-term-body-input></textarea>
        <button type="button" data-term-apply>Done</button>
        <button type="button" data-term-cancel>Cancel</button>
      </div>
    </div>`, { runScripts: 'outside-only' });
  try {
    dom.window.eval(draftScript);
    const { document, Event } = dom.window;
    const select = document.querySelector('[data-standard-term-select]');
    const editor = document.querySelector('[data-term-editor]');
    const textarea = document.querySelector('[data-term-body-input]');
    const editButton = document.querySelector('[data-term-edit-button]');

    assert.equal(editor.hidden, true);
    select.value = 'fca';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(editButton.disabled, false);
    assert.equal(editor.hidden, false);
    assert.equal(textarea.value, 'FCA [Named Place], Incoterms® 2020.');

    textarea.value = 'FCA Busan, Korea, Incoterms® 2020.';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-term-apply]').click();
    assert.equal(editor.hidden, true);
    assert.equal(select.selectedOptions[0].textContent, 'FCA Busan, Korea, Incoterms® 2020.');
    assert.equal(textarea.value, 'FCA Busan, Korea, Incoterms® 2020.');

    editButton.click();
    assert.equal(editor.hidden, false);
  } finally {
    dom.window.close();
  }
});
