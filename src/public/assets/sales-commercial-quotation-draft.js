(() => {
  const container = document.getElementById('sales-quote-draft-rows');
  const addButton = document.querySelector('[data-add-quote-row]');
  if (!container || !addButton) return;

  function renumber() {
    [...container.querySelectorAll('.draft-row')].forEach((row, index) => {
      row.querySelector('span').textContent = String(index + 1);
    });
  }

  addButton.addEventListener('click', () => {
    if (container.querySelectorAll('.draft-row').length >= 100) return;
    const template = container.querySelector('.draft-row');
    if (!template) return;
    const row = template.cloneNode(true);
    row.querySelectorAll('input, textarea').forEach((field) => { field.value = ''; });
    container.append(row);
    renumber();
    row.querySelector('textarea')?.focus();
  });

  container.addEventListener('click', (event) => {
    if (!event.target.closest('[data-remove-quote-row]')) return;
    if (container.querySelectorAll('.draft-row').length <= 1) {
      container.querySelectorAll('input, textarea').forEach((field) => { field.value = ''; });
      return;
    }
    event.target.closest('.draft-row')?.remove();
    renumber();
  });
})();
