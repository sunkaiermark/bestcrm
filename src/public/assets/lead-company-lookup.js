for (const root of document.querySelectorAll('[data-lead-company-lookup]')) {
  const input = root.querySelector('input[name="companyName"]');
  const list = root.querySelector('[role="listbox"]');
  const status = root.querySelector('[role="status"]');
  const form = input.form;
  const contactPicker = form?.querySelector('[data-lead-existing-contact]');
  let timer, controller, sequence = 0, matches = [], active = -1, applied = null, contacts = [];
  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }
  function clearContactPicker() {
    contacts = [];
    if (!contactPicker) return;
    contactPicker.replaceChildren(new Option('选择该公司的联系人', ''));
    contactPicker.hidden = true;
  }
  function setField(name, value) {
    const field = form?.elements[name];
    if (!field) return;
    field.value = value || '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (applied) applied.fields[name] = field.value;
  }
  function clearApplied() {
    if (applied) {
      const values = applied.fields;
      applied = null;
      for (const [name, value] of Object.entries(values)) {
        if (form?.elements[name]?.value === value) setField(name, '');
      }
    }
    clearContactPicker();
  }
  function selectContact(index) {
    const contact = contacts[index];
    if (!contact || !applied || input.value !== applied.name) return;
    setField('contactName', contact.name);
    setField('contactPhone', contact.phone);
    setField('contactEmail', contact.email);
    status.textContent = '已带入联系人：' + contact.name;
  }
  contactPicker?.addEventListener('change', () => {
    if (contactPicker.value !== '') selectContact(Number(contactPicker.value));
  });
  function highlight(index) {
    active = index;
    for (let i = 0; i < list.children.length; i++) list.children[i].setAttribute('aria-selected', String(i === active));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView?.({ block: 'nearest' });
    }
  }
  async function choose(index) {
    const customer = matches[index];
    if (!customer) return;
    clearTimeout(timer);
    controller?.abort();
    const currentSequence = ++sequence;
    close();
    clearApplied();
    input.value = customer.name;
    applied = { name: customer.name, fields: {} };
    setField('companyWebsite', customer.website);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    status.textContent = '正在读取公司基础信息…';
    controller = new AbortController();
    try {
      const response = await fetch('/lead-submissions/customer-options/' + encodeURIComponent(customer.id), {
        signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store'
      });
      if (!response.ok) throw new Error('Details unavailable');
      const data = await response.json();
      if (currentSequence !== sequence || input.value !== customer.name) return;
      setField('companyWebsite', data.customer.website);
      setField('companyAddress', data.customer.address);
      const country = form?.elements.country;
      if (country && !country.value && [...country.options].some(option => option.value === data.customer.country)) setField('country', data.customer.country);
      contacts = Array.isArray(data.contacts) ? data.contacts : [];
      if (contactPicker) {
        contactPicker.replaceChildren(new Option('选择该公司的联系人', ''));
        contacts.forEach((contact, i) => {
          const option = new Option([contact.name, contact.title, contact.phone, contact.email].filter(Boolean).join(' · '), String(i));
          option.title = option.textContent;
          contactPicker.append(option);
        });
        contactPicker.hidden = contacts.length < 2;
      }
      if (contacts.length === 1) selectContact(0);
      else status.textContent = contacts.length > 1 ? '公司信息已带入，请选择联系人。' : '公司信息已带入，暂无联系人，可手工填写。';
    } catch (error) {
      if (error.name === 'AbortError' || currentSequence !== sequence) return;
      status.textContent = '已选择公司，基础信息读取失败，可手工补充或重新选择。';
    }
  }
  function render(customers) {
    matches = customers;
    list.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    matches.forEach((customer, index) => {
      const option = document.createElement('li');
      option.id = 'lead-company-option-' + index;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = [customer.customerCode, customer.name].filter(Boolean).join(' · ');
      option.title = option.textContent;
      option.addEventListener('pointerdown', event => { event.preventDefault(); choose(index); });
      list.append(option);
    });
    list.hidden = matches.length === 0;
    input.setAttribute('aria-expanded', String(matches.length > 0));
    status.textContent = matches.length ? '找到' + matches.length + '家公司，请选择或继续输入。' : '未找到可选公司，可继续手工填写。';
  }
  async function search(query, requestSequence) {
    controller = new AbortController();
    try {
      const response = await fetch('/lead-submissions/customer-options?q=' + encodeURIComponent(query), {
        signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store'
      });
      if (!response.ok) throw new Error('Search unavailable');
      const data = await response.json();
      if (requestSequence !== sequence || input.value.trim() !== query) return;
      render(Array.isArray(data.customers) ? data.customers : []);
    } catch (error) {
      if (error.name === 'AbortError' || requestSequence !== sequence) return;
      close(); status.textContent = '公司查询暂不可用，可继续手工填写。';
    }
  }
  input.addEventListener('input', event => {
    clearTimeout(timer); controller?.abort();
    const requestSequence = ++sequence;
    close();
    if (applied && input.value !== applied.name) clearApplied();
    const query = input.value.trim();
    status.textContent = '';
    if (event.isComposing || !query || query.length > 120) return;
    timer = setTimeout(() => search(query, requestSequence), 250);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (list.hidden || !matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
        : (active + (event.key === 'ArrowDown' ? 1 : matches.length - 1) + matches.length) % matches.length);
    } else if (event.key === 'Enter') { event.preventDefault(); choose(active >= 0 ? active : 0); }
    else if (event.key === 'Tab') close();
  });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
  input.addEventListener('blur', () => { clearTimeout(timer); controller?.abort(); sequence++; close(); });
}
