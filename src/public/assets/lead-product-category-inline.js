(() => {
  for (const row of document.querySelectorAll('[data-lead-category-inline]')) {
    const select = row.querySelector('select');
    const confirm = row.querySelector('[data-lead-category-confirm]');
    const confirmed = row.querySelector('[data-lead-category-confirmed]');
    function bindRemoval(chip) {
      chip.querySelector('button').addEventListener('click', () => chip.remove());
    }
    confirmed.querySelectorAll('.status').forEach(bindRemoval);
    confirm.addEventListener('click', () => {
      const value = select.value;
      if (!value) { select.focus(); return; }
      if ([...confirmed.querySelectorAll('input')].some(input => input.value === value)) return;
      const text = select.selectedOptions[0].textContent;
      const chip = document.createElement('span');
      chip.className = 'status';
      const label = document.createElement('span'); label.textContent = text;
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'confirmedProductCategoryCodes'; input.value = value;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `${confirmed.dataset.removeLabel} ${text}`);
      chip.append(label, input, remove); bindRemoval(chip); confirmed.append(chip);
      select.value = '';
    });
  }
})();