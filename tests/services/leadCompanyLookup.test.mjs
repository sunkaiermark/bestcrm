import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { createCustomerRepository } from '../../src/repositories/customerRepository.mjs';

function setup(fetchImpl) {
  const dom = new JSDOM('<form><label><span data-lead-company-lookup><input name="companyName" role="combobox"><ul id="lead-company-options" role="listbox" hidden></ul><span role="status"></span></span></label><input name="companyWebsite"><input name="companyAddress"><select name="country"><option value=""></option><option value="China">China</option></select><input name="contactName" value="Original contact"><input name="contactPhone"><input name="contactEmail"><select data-lead-existing-contact hidden></select></form>', { url: 'https://crm.example.invalid/', runScripts: 'outside-only' });
  dom.window.fetch = fetchImpl;
  dom.window.eval(fs.readFileSync('src/public/assets/lead-company-lookup.js', 'utf8'));
  const input = dom.window.document.querySelector('[name=companyName]');
  return { dom, input, form: input.form,
    type(value) { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 280));
const results = [{ id: 1, name: 'Acme <Engineering>', customerCode: 'C001', website: 'https://acme.invalid' },
  { id: 2, name: 'Acme Equipment', customerCode: 'C002', website: 'https://equipment.invalid' }];

test('lookup debounces input, escapes names, and keyboard selection fills company without changing contact', async () => {
  const calls = [];
  const f = setup(async url => { calls.push(url); return { ok: true, json: async () => ({ customers: results }) }; });
  try {
    f.type('A'); f.type('Ac'); f.type('Acme');
    await settle();
    assert.equal(calls.length, 1);
    const list = f.dom.window.document.querySelector('[role=listbox]');
    assert.equal(list.hidden, false);
    assert.equal(list.querySelectorAll('engineering').length, 0);
    assert.match(list.textContent, /Acme <Engineering>/);
    f.input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    f.input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(f.input.value, 'Acme Equipment');
    assert.equal(f.form.elements.companyWebsite.value, 'https://equipment.invalid');
    assert.equal(f.form.elements.contactName.value, 'Original contact');
    assert.equal(list.hidden, true);
    f.type('Different company');
    assert.equal(f.form.elements.companyWebsite.value, '');
  } finally { f.dom.window.close(); }
});

test('late results cannot replace the list for a newer query', async () => {
  let firstResolve;
  const f = setup(async url => {
    if (url.endsWith('first')) return new Promise(resolve => { firstResolve = resolve; });
    return { ok: true, json: async () => ({ customers: [results[1]] }) };
  });
  try {
    f.type('first'); await settle();
    f.type('second'); await settle();
    firstResolve({ ok: true, json: async () => ({ customers: [results[0]] }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.dom.window.document.querySelector('[role=listbox]').textContent, 'C002 · Acme Equipment');
  } finally { f.dom.window.close(); }
});

test('lookup failure keeps manual company and website values available', async () => {
  const f = setup(async () => ({ ok: false }));
  try {
    f.form.elements.companyWebsite.value = 'https://manual.invalid';
    f.type('Manual company'); await settle();
    assert.equal(f.input.value, 'Manual company');
    assert.equal(f.form.elements.companyWebsite.value, 'https://manual.invalid');
    assert.match(f.dom.window.document.querySelector('[role=status]').textContent, /可继续手工填写/);
  } finally { f.dom.window.close(); }
});

test('limited company search retains parameterized literal wildcard matching and active owner scope', async () => {
  let captured;
  const repository = createCustomerRepository({ async query(sql, params) { captured = { sql, params }; return { rows: [] }; } });
  await repository.listCustomers({ searchTerm: 'Acme%_', coordinatorUserId: 7, limit: 15 });
  assert.match(captured.sql, /c\.archived_at IS NULL/);
  assert.match(captured.sql, /coordinator_user_id, c\.owner_user_id\) = \$1/);
  assert.match(captured.sql, /ILIKE \$2/);
  assert.match(captured.sql, /LIMIT \$3/);
  assert.deepEqual(captured.params, [7, '%Acme\\%\\_%', 15]);
});


test('selected company fills address and offers multiple contacts for explicit selection', async () => {
  const f = setup(async url => ({ ok: true, json: async () => url.includes('?q=') ? { customers: results } : {
    customer: { ...results[0], address: 'Example road 1', country: 'China' },
    contacts: [{ id: 11, name: 'Buyer One', title: 'Purchasing', phone: '111', email: 'one@example.invalid' },
      { id: 12, name: 'Engineer Two', title: 'Engineer', phone: '222', email: 'two@example.invalid' }]
  } }));
  try {
    f.type('Acme'); await settle();
    f.input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.form.elements.companyAddress.value, 'Example road 1');
    assert.equal(f.form.elements.country.value, 'China');
    assert.equal(f.form.elements.contactName.value, 'Original contact');
    const picker = f.form.querySelector('[data-lead-existing-contact]');
    assert.equal(picker.hidden, false); assert.equal(picker.options.length, 3);
    picker.value = '1'; picker.dispatchEvent(new f.dom.window.Event('change'));
    assert.equal(f.form.elements.contactName.value, 'Engineer Two');
    assert.equal(f.form.elements.contactPhone.value, '222');
    assert.equal(f.form.elements.contactEmail.value, 'two@example.invalid');
    f.form.elements.companyWebsite.value = 'https://human-edited.invalid';
    f.type('Other company');
    assert.equal(f.form.elements.companyAddress.value, '');
    assert.equal(f.form.elements.contactName.value, '');
    assert.equal(f.form.elements.companyWebsite.value, 'https://human-edited.invalid');
    assert.equal(picker.hidden, true);
  } finally { f.dom.window.close(); }
});

test('one active company contact fills name phone and email automatically', async () => {
  const f = setup(async url => ({ ok: true, json: async () => url.includes('?q=') ? { customers: results } : {
    customer: { ...results[0], address: 'Example road' },
    contacts: [{ id: 11, name: 'Buyer', phone: '123', email: 'buyer@example.invalid' }]
  } }));
  try {
    f.type('Acme'); await settle();
    f.input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.form.elements.contactName.value, 'Buyer');
    assert.equal(f.form.elements.contactPhone.value, '123');
    assert.equal(f.form.elements.contactEmail.value, 'buyer@example.invalid');
    assert.equal(f.form.querySelector('[data-lead-existing-contact]').hidden, true);
  } finally { f.dom.window.close(); }
});
