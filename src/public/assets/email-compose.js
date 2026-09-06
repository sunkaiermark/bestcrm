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
