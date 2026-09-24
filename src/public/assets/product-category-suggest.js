(() => {
  for (const picker of document.querySelectorAll('[data-product-category-picker]')) {
    let rules;
    try {
      rules = JSON.parse(picker.dataset.rules || '[]').map((rule) => ({
        code: rule.code,
        pattern: new RegExp(rule.source, 'i')
      }));
    } catch {
      continue;
    }
    const product = document.querySelector('input[name="productInterest"]');
    const subject = document.querySelector(`input[name="${picker.dataset.subjectInput}"]`);
    const requirement = document.querySelector(`textarea[name="${picker.dataset.requirementInput}"]`);
    const choices = [...picker.querySelectorAll('input[name="confirmedProductCategoryCodes"]')];
    const suggestionBox = picker.querySelector('[data-product-category-suggestions]');
    const count = picker.querySelector('[data-product-category-count]');
    let automaticProduct = false;

    function matches(value) {
      const source = String(value || '').slice(0, 2000);
      return rules.map((rule) => ({ code: rule.code, text: source.match(rule.pattern)?.[0] }))
        .filter((match) => match.text);
    }

    function refresh() {
      if (product && !product.value.trim()) {
        for (const source of [subject?.value, requirement?.value]) {
          const sourceMatches = matches(source);
          if (sourceMatches.length > 1) break;
          if (sourceMatches.length === 1) {
            product.value = sourceMatches[0].text;
            automaticProduct = true;
            break;
          }
        }
      }
      const suggestedCodes = [...new Set([product?.value, subject?.value, requirement?.value]
        .flatMap((value) => matches(value).map((match) => match.code)))];
      const unchecked = choices.filter((choice) => suggestedCodes.includes(choice.value) && !choice.checked);
      count.textContent = String(choices.filter((choice) => choice.checked).length);
      suggestionBox.replaceChildren();
      const title = document.createElement('span');
      title.textContent = `${picker.dataset.suggestedLabel}:`;
      suggestionBox.append(title);
      if (!unchecked.length) {
        const none = document.createElement('span');
        none.className = 'muted';
        none.textContent = picker.dataset.noneLabel;
        suggestionBox.append(none);
      }
      for (const choice of unchecked) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary-action product-category-suggestion';
        button.textContent = `${picker.dataset.addLabel}: ${choice.parentElement.textContent.trim()}`;
        button.addEventListener('click', () => {
          choice.checked = true;
          refresh();
        });
        suggestionBox.append(button);
      }
    }

    product?.addEventListener('input', () => { automaticProduct = false; refresh(); });
    subject?.addEventListener('input', () => {
      if (automaticProduct && product) product.value = '';
      automaticProduct = false;
      refresh();
    });
    requirement?.addEventListener('input', () => {
      if (automaticProduct && product) product.value = '';
      automaticProduct = false;
      refresh();
    });
    choices.forEach((choice) => choice.addEventListener('change', refresh));
    refresh();
  }
})();
