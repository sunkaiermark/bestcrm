(() => {
  const sellerEntitySelect = document.querySelector('[data-seller-entity-select]');
  function updateSellerProfile() {
    const option = sellerEntitySelect?.selectedOptions[0];
    for (const field of document.querySelectorAll('[data-seller-profile-field]')) {
      const value = option?.dataset[field.dataset.sellerProfileField] || '';
      field.textContent = value || field.dataset.pendingLabel || '—';
      field.classList.toggle('draft-pending', !value);
    }
  }
  sellerEntitySelect?.addEventListener('change', updateSellerProfile);
  updateSellerProfile();

  const customerContactSelect = document.querySelector('[name="customerContactId"]');
  const customerContactPhone = document.querySelector('[data-customer-contact-phone]');
  const customerContactEmail = document.querySelector('[data-customer-contact-email]');
  function updateCustomerContact() {
    const option = customerContactSelect?.selectedOptions[0];
    const phone = option?.dataset.phone || '';
    const email = option?.dataset.email || '';
    if (customerContactPhone) {
      customerContactPhone.textContent = phone || '—';
      customerContactPhone.classList.toggle('draft-pending', !phone);
    }
    if (customerContactEmail) {
      customerContactEmail.textContent = email || '—';
      customerContactEmail.classList.toggle('draft-pending', !email);
    }
  }
  customerContactSelect?.addEventListener('change', updateCustomerContact);

  const unresolvedTermPlaceholders = [
    '[Location]', '[Named Place]', '[Named Port of Shipment]',
    '[Named Port of Destination]', '[Named Place of Destination]', '[Delivery Period]'
  ];
  const quotationForm = document.getElementById('sales-quote-draft-form');
  const termControls = [...document.querySelectorAll('[data-term-control]')];

  function hasUnresolvedTermPlaceholder(value) {
    return unresolvedTermPlaceholders.some((placeholder) => value.includes(placeholder));
  }

  function initializeTermControl(control) {
    const select = control.querySelector('[data-standard-term-select]');
    const editButton = control.querySelector('[data-term-edit-button]');
    const editor = control.querySelector('[data-term-editor]');
    const bodyInput = control.querySelector('[data-term-body-input]');
    const applyButton = control.querySelector('[data-term-apply]');
    const cancelButton = control.querySelector('[data-term-cancel]');
    if (!select || !editButton || !editor || !bodyInput) return;
    let originalBody = bodyInput.value;

    function selectedOption() {
      return select.selectedOptions[0] || null;
    }

    function validateBody() {
      const body = bodyInput.value.trim();
      const invalid = Boolean(select.value) && (!body || hasUnresolvedTermPlaceholder(body));
      bodyInput.setCustomValidity(invalid ? control.dataset.termInvalidMessage : '');
      return !invalid;
    }

    function openEditor() {
      if (editButton.disabled) return;
      originalBody = bodyInput.value;
      editor.hidden = false;
      bodyInput.focus();
      bodyInput.select();
    }

    function closeEditor() {
      editor.hidden = true;
    }

    select.addEventListener('change', () => {
      const option = selectedOption();
      const templateBody = option?.dataset.termTemplateBody || '';
      bodyInput.value = templateBody;
      originalBody = templateBody;
      editButton.disabled = !select.value || !templateBody;
      validateBody();
      if (templateBody && hasUnresolvedTermPlaceholder(templateBody)) {
        editor.hidden = false;
        bodyInput.focus();
        bodyInput.select();
      } else {
        closeEditor();
      }
    });

    editButton.addEventListener('click', openEditor);
    bodyInput.addEventListener('input', validateBody);
    applyButton?.addEventListener('click', () => {
      if (!validateBody()) {
        bodyInput.reportValidity();
        return;
      }
      const body = bodyInput.value.trim();
      bodyInput.value = body;
      const option = selectedOption();
      if (option && body) option.textContent = body;
      originalBody = body;
      closeEditor();
      select.focus();
    });
    cancelButton?.addEventListener('click', () => {
      bodyInput.value = originalBody;
      validateBody();
      closeEditor();
      select.focus();
    });
    validateBody();

    control.openTermEditor = () => {
      editor.hidden = false;
      bodyInput.focus();
    };
    control.validateTermBody = validateBody;
  }

  termControls.forEach(initializeTermControl);
  quotationForm?.addEventListener('submit', (event) => {
    for (const control of termControls) {
      if (!control.validateTermBody || control.validateTermBody()) continue;
      event.preventDefault();
      control.openTermEditor?.();
      control.querySelector('[data-term-body-input]')?.reportValidity();
      break;
    }
  });

  const container = document.getElementById('sales-quote-draft-rows');
  const addButton = document.querySelector('[data-add-quote-row]');
  if (!container) return;
  const currencyInput = document.querySelector('[name="currency"]');
  const taxRateInput = document.querySelector('[name="taxRate"]');
  const subtotalDisplay = document.querySelector('[data-draft-subtotal]');
  const taxAmountDisplay = document.querySelector('[data-draft-tax-amount]');
  const grandTotalDisplay = document.querySelector('[data-draft-grand-total]');

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
      const amountDisplay = row.querySelector('[data-line-amount]');
      if (!description && !quantityText && !unit && !priceText) {
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
      subtotal += cents;
    }
    const currency = String(currencyInput?.value || '').trim().toUpperCase();
    const taxRate = scaledDecimal(taxRateInput?.value || '0', 2, 3);
    const validTaxRate = taxRate !== null && taxRate <= 10000n;
    const ready = hasLine && complete && validTaxRate;
    const taxAmount = ready ? (subtotal * taxRate + 5000n) / 10000n : null;
    const currencyPrefix = /^[A-Z]{3}$/.test(currency) ? `${currency} ` : '';
    if (subtotalDisplay) subtotalDisplay.textContent = ready ? `${currencyPrefix}${formatCents(subtotal)}` : '—';
    if (taxAmountDisplay) taxAmountDisplay.textContent = ready ? `${currencyPrefix}${formatCents(taxAmount)}` : '—';
    if (grandTotalDisplay) grandTotalDisplay.textContent = ready
      ? `${currencyPrefix}${formatCents(subtotal + taxAmount)}` : '—';
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
    row.querySelectorAll('input, textarea').forEach((field) => { field.value = ''; });
    row.querySelector('[data-line-amount]').textContent = '—';
    container.append(row);
    renumber();
    calculate();
    row.querySelector('textarea')?.focus();
  });

  container.addEventListener('click', (event) => {
    if (!event.target.closest('[data-remove-quote-row]')) return;
    if (container.querySelectorAll('.draft-row').length <= 1) {
      container.querySelectorAll('input, textarea').forEach((field) => { field.value = ''; });
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
  currencyInput?.addEventListener('change', calculate);
  taxRateInput?.addEventListener('input', calculate);
  calculate();
})();
