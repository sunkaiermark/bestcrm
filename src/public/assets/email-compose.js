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
