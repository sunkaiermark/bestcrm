document.querySelectorAll('[data-team-selection]').forEach(editor => {
  const rows = editor.querySelector('[data-team-rows]');
  const sync = () => {
    const selected = [...rows.querySelectorAll('[data-team-person]')].map(select => select.value).filter(Boolean);
    rows.querySelectorAll('[data-team-row]').forEach(row => {
      const person = row.querySelector('[data-team-person]');
      row.querySelector('[data-team-position]').name = 'position_' + person.value;
      row.querySelector('[data-team-work]').name = 'specialty_' + person.value;
      [...person.options].forEach(option => { option.disabled = Boolean(option.value && option.value !== person.value && selected.includes(option.value)); });
    });
  };
  editor.addEventListener('change', sync);
  editor.addEventListener('click', event => {
    if (event.target.closest('[data-team-add]')) {
      const row = rows.firstElementChild.cloneNode(true);
      row.querySelector('[data-team-person]').value = '';
      row.querySelector('[data-team-position]').value = 'support';
      row.querySelectorAll('[data-team-legacy-work]').forEach(option => option.remove());
      row.querySelector('[data-team-work]').value = '';
      rows.append(row);
      sync();
    }
    if (event.target.closest('[data-team-remove]')) {
      const row = event.target.closest('[data-team-row]');
      if (rows.children.length > 1) row.remove();
      else { row.querySelector('[data-team-person]').value = ''; row.querySelector('[data-team-work]').value = ''; }
      sync();
    }
  });
  sync();
});
