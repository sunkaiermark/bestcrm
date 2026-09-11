const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

function createToken() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '_');
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

const SUBMIT_CONTROLS = 'button:not([type]), button[type="submit"], input[type="submit"]';

function ensureSubmissionToken(form) {
  let field = form.querySelector('input[name="_submissionToken"]');
  if (!field) {
    field = document.createElement('input');
    field.type = 'hidden';
    field.name = '_submissionToken';
    field.value = createToken();
    form.append(field);
  }
  // Named controls are exposed as form properties. A control named "action"
  // therefore shadows HTMLFormElement.action and can return a RadioNodeList.
  const actionAttribute = form.getAttribute('action');
  const action = new URL(actionAttribute || globalThis.location.href, globalThis.location.href);
  if (action.origin === globalThis.location.origin) {
    action.searchParams.set('_submissionToken', field.value);
    form.setAttribute('action', `${action.pathname}${action.search}${action.hash}`);
  }
  return field.value;
}

function preserveSubmitter(form, submitter) {
  if (!submitter?.name || submitter.disabled) return;
  let field = form.querySelector('input[data-submitter-value]');
  if (!field) {
    field = document.createElement('input');
    field.type = 'hidden';
    field.dataset.submitterValue = 'true';
    form.append(field);
  }
  field.name = submitter.name;
  field.value = submitter.value;
}

function setSubmitting(form, submitter) {
  preserveSubmitter(form, submitter);
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  const processingLabel = document.documentElement.lang === 'zh' ? '处理中…' : 'Processing…';
  for (const control of form.querySelectorAll(SUBMIT_CONTROLS)) {
    control.disabled = true;
    control.setAttribute('aria-disabled', 'true');
    if (control === submitter && control.tagName === 'BUTTON') {
      control.dataset.originalLabel = control.textContent;
      control.textContent = processingLabel;
    }
  }
}

function resetForm(form) {
  delete form.dataset.submitting;
  form.removeAttribute('aria-busy');
  for (const control of form.querySelectorAll(SUBMIT_CONTROLS)) {
    control.disabled = false;
    control.removeAttribute('aria-disabled');
    if (control.dataset.originalLabel) {
      control.textContent = control.dataset.originalLabel;
      delete control.dataset.originalLabel;
    }
  }
  form.querySelector('input[data-submitter-value]')?.remove();
}

for (const form of document.forms) {
  const method = String(form.getAttribute('method') || 'get').toLowerCase();
  if (!MUTATING_METHODS.has(method)) continue;
  ensureSubmissionToken(form);
  form.addEventListener('submit', (event) => {
    if (form.dataset.submitting === 'true') {
      event.preventDefault();
      return;
    }
    setSubmitting(form, event.submitter);
  });
}

for (const item of document.querySelectorAll('details.correspondence-item')) {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    const timeline = item.closest('.correspondence-timeline');
    for (const sibling of timeline?.querySelectorAll('details.correspondence-item[open]') || []) {
      if (sibling !== item) sibling.open = false;
    }
  });
}

globalThis.addEventListener('pageshow', () => {
  for (const form of document.querySelectorAll('form[data-submitting="true"]')) resetForm(form);
});
