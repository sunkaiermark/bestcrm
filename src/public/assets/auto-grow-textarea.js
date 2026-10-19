(() => {
  const resize = (field) => {
    field.style.height = 'auto';
    field.style.height = `${Math.max(32, field.scrollHeight + 2)}px`;
  };
  document.querySelectorAll('textarea[data-auto-grow]').forEach((field) => {
    field.addEventListener('input', () => resize(field));
    resize(field);
  });
  window.addEventListener('resize', () => {
    document.querySelectorAll('textarea[data-auto-grow]').forEach(resize);
  });
})();
