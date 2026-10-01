(() => {
  const container = document.getElementById('sales-quote-draft-rows');
  const addButton = document.querySelector('[data-add-quote-row]');
  if (!container) return;
  const currencyInput = document.querySelector('input[name="currency"]');
  const subtotalDisplay = document.querySelector('[data-draft-subtotal]');

  function scaledDecimal(rawValue, fractionalDigits, wholeDigits) {
    const value = String(rawValue || '').trim();
    if (!new RegExp(`^(?:0|[1-9]\\d{0,${wholeDigits - 1}})(?:\\.\\d{1,${fractionalDigits}})?$`).test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * (10n ** BigInt(fractionalDigits)) + BigInt(fraction.padEnd(fractionalDigits, '0') || '0');
  }

  function formatCents(cents) {
    const whole = cents / 100n;
    const fraction = String(cents % 100n).padStart(2, '0');
    return `${whole.toLocaleString('en-US')}.${fraction}`;
  }

  function calculate() {
    let subtotal = 0n;
    let hasLine = false;
    let complete = true;
    for (const row of container.querySelectorAll('.draft-row')) {
      const description = row.querySelector('[name="description"]').value.trim();
      const quantityText = row.querySelector('[name="quantity"]').value.trim();
      const unit = row.querySelector('[name="unit"]').value.trim();
      const priceText = row.querySelector('[name="unitPrice"]').value.trim();
      const inclusion = row.querySelector('[name="includeInTotal"]').value;
      const amountDisplay = row.querySelector('[data-line-amount]');
      if (!description && !quantityText && !unit && !priceText && !inclusion) {
        amountDisplay.textContent = '—';
        continue;
      }
      hasLine = true;
      const quantity = scaledDecimal(quantityText, 4, 10);
      const price = scaledDecimal(priceText, 2, 12);
      if (quantity === null || price === null) {
        amountDisplay.textContent = '—';
        complete = false;
        continue;
      }
      const cents = (quantity * price + 5000n) / 10000n;
      amountDisplay.textContent = formatCents(cents);
      if (inclusion === 'included') subtotal += cents;
      else if (inclusion !== 'excluded') complete = false;
    }
    const currency = String(currencyInput?.value || '').trim().toUpperCase();
    if (subtotalDisplay) subtotalDisplay.textContent = hasLine && complete
      ? `${/^[A-Z]{3}$/.test(currency) ? `${currency} ` : ''}${formatCents(subtotal)}` : '—';
  }

  function renumber() {
    [...container.querySelectorAll('.draft-row')].forEach((row, index) => {
      row.querySelector('.draft-row-number').textContent = String(index + 1);
    });
  }

  addButton?.addEventListener('click', () => {
    if (container.querySelectorAll('.draft-row').length >= 100) return;
    const template = container.querySelector('.draft-row');
    if (!template) return;
    const row = template.cloneNode(true);
    row.querySelectorAll('input, textarea, select').forEach((field) => { field.value = ''; });
    row.querySelector('[data-line-amount]').textContent = '—';
    container.append(row);
    renumber();
    calculate();
    row.querySelector('textarea')?.focus();
  });

  container.addEventListener('click', (event) => {
    if (!event.target.closest('[data-remove-quote-row]')) return;
    if (container.querySelectorAll('.draft-row').length <= 1) {
      container.querySelectorAll('input, textarea, select').forEach((field) => { field.value = ''; });
      calculate();
      return;
    }
    event.target.closest('.draft-row')?.remove();
    renumber();
    calculate();
  });

  container.addEventListener('input', calculate);
  container.addEventListener('change', calculate);
  currencyInput?.addEventListener('input', calculate);
  document.querySelectorAll('[data-standard-term-select]').forEach((select) => {
    select.addEventListener('change', () => {
      const body = select.closest('td')?.querySelector('[data-standard-term-body]');
      if (!body) return;
      body.textContent = select.selectedOptions[0]?.dataset.body || '';
      body.hidden = !body.textContent;
    });
  });
  calculate();
})();
