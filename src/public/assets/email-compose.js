for (const picker of document.querySelectorAll('[data-customer-email-file-picker]')) {
  const input = picker.querySelector('input[type="file"]');
  const status = picker.querySelector('[data-customer-email-file-status]');
  if (!input || !status) continue;

  const updateStatus = () => {
    const filenames = Array.from(input.files || [], (file) => file.name);
    status.textContent = filenames.length
      ? filenames.join(', ')
      : picker.dataset.emptyLabel || '';
  };

  input.addEventListener('change', updateStatus);
  updateStatus();
}

for (const picker of document.querySelectorAll('[data-approved-file-picker]')) {
  const checkboxes = Array.from(picker.querySelectorAll('input[type="checkbox"]'));
  const count = picker.querySelector('[data-approved-file-count]');
  if (!count) continue;

  const updateCount = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked).length;
    count.textContent = `${selected} ${picker.dataset.selectedLabel || ''}`.trim();
  };

  for (const checkbox of checkboxes) checkbox.addEventListener('change', updateCount);
  updateCount();
}

for (const select of document.querySelectorAll('[data-email-quotation-select]')) {
  const form = select.closest('form');
  const preview = form?.querySelector('[data-email-signature-preview]');
  if (!preview) continue;
  select.addEventListener('change', () => {
    const template = select.value
      ? Array.from(form.querySelectorAll('template[data-email-signature-quotation]'))
        .find((item) => item.dataset.emailSignatureQuotation === select.value)
      : form.querySelector('template[data-email-signature-default]');
    if (template?.innerHTML) {
      preview.innerHTML = template.innerHTML;
      preview.classList.remove('is-empty');
    } else {
      preview.textContent = preview.dataset.emptyLabel || '';
      preview.classList.add('is-empty');
    }
  });
}

const EMAIL_ALLOWED_TAGS = [
  'p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span',
  'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td'
];

function safeEmailMarkup(html, preserveWidths = false) {
  return window.DOMPurify.sanitize(html, {
    ALLOWED_TAGS: EMAIL_ALLOWED_TAGS,
    ALLOWED_ATTR: preserveWidths ? ['colspan', 'rowspan', 'width'] : ['colspan', 'rowspan'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false
  });
}

function insertEmailFragment(editor, fragment) {
  editor.focus();
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    editor.append(fragment);
    return;
  }
  range.deleteContents();
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function plainTextTable(text) {
  const rows = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
  if (rows.length < 2 || rows.length > 100 || !rows.every((row) => row.includes('\t'))) return null;
  const cells = rows.map((row) => row.split('\t'));
  const width = cells[0].length;
  if (width < 2 || width > 20 || !cells.every((row) => row.length === width)) return null;
  const table = document.createElement('table');
  const body = table.createTBody();
  for (const row of cells) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
  return table;
}

function selectedEmailTable(editor) {
  const node = window.getSelection()?.anchorNode;
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  const table = element?.closest?.('td, th')?.closest('table');
  return table && editor.contains(table) ? table : null;
}

function simpleTableRows(table) {
  const rows = Array.from(table.rows).filter((row) => row.closest('table') === table);
  const count = rows[0]?.cells.length || 0;
  if (count < 2 || count > 20 || !rows.every((row) => row.cells.length === count &&
    Array.from(row.cells).every((cell) => cell.colSpan === 1 && cell.rowSpan === 1))) return null;
  return rows;
}

function currentColumnWidths(rows) {
  const cells = Array.from(rows[0].cells);
  const stored = cells.map((cell) => Number(cell.getAttribute('width')?.match(/^([1-9]\d?)%$/)?.[1]));
  if (stored.every((value) => Number.isInteger(value) && value >= 1 && value <= 99)
      && stored.reduce((sum, value) => sum + value, 0) === 100) return stored;

  const measured = cells.map((cell) => cell.getBoundingClientRect().width);
  const weights = measured.some((value) => value > 0) ? measured : cells.map(() => 1);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((value) => value * 100 / total);
  const widths = exact.map((value) => Math.max(1, Math.floor(value)));
  const order = exact.map((value, index) => ({ index, remainder: value % 1 }))
    .sort((a, b) => b.remainder - a.remainder).map(({ index }) => index);
  let difference = 100 - widths.reduce((sum, value) => sum + value, 0);
  for (let index = 0; difference > 0; index += 1, difference -= 1) widths[order[index % order.length]] += 1;
  while (difference < 0) {
    const index = widths.findIndex((value) => value > 1);
    if (index < 0) break;
    widths[index] -= 1;
    difference += 1;
  }
  return widths;
}

for (const field of document.querySelectorAll('[data-email-editor]')) {
  const textarea = field.querySelector('textarea[name="body"]');
  const richHtml = field.querySelector('input[name="bodyHtml"]');
  const controls = field.querySelector('.customer-email-rich-controls');
  const editor = field.querySelector('[data-email-rich-body]');
  const errorMessage = field.querySelector('[data-email-editor-error]');
  const widthButton = field.querySelector('[data-email-set-column-widths]');
  const widthPanel = field.querySelector('[data-email-column-width-panel]');
  const widthInputs = field.querySelector('[data-email-column-width-inputs]');
  const widthError = field.querySelector('[data-email-column-width-error]');
  const form = field.closest('form');
  if (!textarea || !richHtml || !controls || !editor || !form || !window.DOMPurify?.isSupported) continue;

  controls.hidden = false;
  editor.textContent = textarea.value;
  textarea.hidden = true;
  textarea.required = false;
  field.querySelector('label[for="customer-email-body"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    editor.focus();
  });

  editor.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    event.preventDefault();
    const clipboardHtml = clipboard.getData('text/html');
    const safeHtml = clipboardHtml && safeEmailMarkup(clipboardHtml);
    if (safeHtml && new DOMParser().parseFromString(safeHtml, 'text/html').body.textContent.trim()) {
      const template = document.createElement('template');
      template.innerHTML = safeHtml;
      insertEmailFragment(editor, template.content);
      return;
    }
    const plain = clipboard.getData('text/plain');
    const table = plainTextTable(plain);
    if (table) {
      insertEmailFragment(editor, table);
    } else if (plain) {
      insertEmailFragment(editor, document.createTextNode(plain));
    }
  });
  editor.addEventListener('drop', (event) => event.preventDefault());

  for (const button of field.querySelectorAll('[data-email-format]')) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      editor.focus();
      document.execCommand(button.dataset.emailFormat, false);
    });
  }
  const insertTable = field.querySelector('[data-email-insert-table]');
  insertTable?.addEventListener('mousedown', (event) => event.preventDefault());
  insertTable?.addEventListener('click', () => {
    const table = document.createElement('table');
    const body = table.createTBody();
    for (let row = 0; row < 2; row += 1) {
      const tr = body.insertRow();
      for (let column = 0; column < 2; column += 1) {
        tr.insertCell().append(document.createElement('br'));
      }
    }
    insertEmailFragment(editor, table);
  });

  if (widthButton && widthPanel && widthInputs && widthError) {
    let activeTable = null;
    const showWidthError = (message = '') => {
      widthError.textContent = message;
      widthError.hidden = !message;
    };
    const closeWidthPanel = () => {
      activeTable = null;
      widthPanel.hidden = true;
      widthInputs.replaceChildren();
      widthButton.setAttribute('aria-expanded', 'false');
    };
    widthButton.addEventListener('mousedown', (event) => event.preventDefault());
    widthButton.addEventListener('click', () => {
      showWidthError();
      const table = selectedEmailTable(editor);
      if (!table) {
        closeWidthPanel();
        showWidthError(widthPanel.dataset.noTableLabel);
        return;
      }
      const rows = simpleTableRows(table);
      if (!rows) {
        closeWidthPanel();
        showWidthError(widthPanel.dataset.mergedLabel);
        return;
      }
      activeTable = table;
      widthInputs.replaceChildren();
      for (const [index, value] of currentColumnWidths(rows).entries()) {
        const label = document.createElement('label');
        const name = widthPanel.dataset.columnLabel.replace('{n}', String(index + 1));
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.value = String(value);
        input.setAttribute('aria-label', name);
        input.addEventListener('input', () => showWidthError());
        label.append(document.createTextNode(`${name} `), input, document.createTextNode('%'));
        widthInputs.append(label);
      }
      widthPanel.hidden = false;
      widthButton.setAttribute('aria-expanded', 'true');
      widthInputs.querySelector('input')?.focus();
    });
    field.querySelector('[data-email-cancel-column-widths]')?.addEventListener('click', () => {
      showWidthError();
      closeWidthPanel();
      editor.focus();
    });
    field.querySelector('[data-email-apply-column-widths]')?.addEventListener('click', () => {
      const rows = activeTable?.isConnected && editor.contains(activeTable) ? simpleTableRows(activeTable) : null;
      if (!rows) {
        closeWidthPanel();
        showWidthError(widthPanel.dataset.mergedLabel);
        return;
      }
      const widths = Array.from(widthInputs.querySelectorAll('input'), (input) => Number(input.value));
      if (widths.length !== rows[0].cells.length || !widths.every((value) => Number.isInteger(value)
          && value >= 1 && value <= 99) || widths.reduce((sum, value) => sum + value, 0) !== 100) {
        showWidthError(widthPanel.dataset.invalidLabel);
        return;
      }
      for (const row of rows) {
        Array.from(row.cells).forEach((cell, index) => cell.setAttribute('width', `${widths[index]}%`));
      }
      activeTable.style.tableLayout = 'fixed';
      showWidthError();
      closeWidthPanel();
      editor.focus();
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  form.addEventListener('submit', (event) => {
    const safeHtml = safeEmailMarkup(editor.innerHTML, true);
    const visibleText = new DOMParser().parseFromString(safeHtml, 'text/html').body.textContent
      .replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (!visibleText) {
      event.preventDefault();
      event.stopImmediatePropagation();
      editor.focus();
      if (errorMessage) errorMessage.hidden = false;
      return;
    }
    if (errorMessage) errorMessage.hidden = true;
    richHtml.value = safeHtml;
    textarea.value = editor.innerText || editor.textContent;
  });
  editor.addEventListener('input', () => {
    if (errorMessage) errorMessage.hidden = true;
  });
}
