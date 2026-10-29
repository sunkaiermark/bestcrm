/* Presentation only: never clones forms, submits data or changes permissions. */
(() => {
  if (window.bestcrmPhoneDesktopLayout) return;
  const media = window.matchMedia('(max-width: 860px)');
  const main = document.querySelector('.app-main');
  const nav = document.querySelector('.left-nav');
  const toggle = document.querySelector('.mobile-nav-toggle');
  let backdrop;
  let scheduled = false;
  function closeNavigation(restoreFocus = false) {
    document.body.classList.remove('mobile-nav-open');
    toggle?.setAttribute('aria-expanded', 'false');
    if (backdrop) backdrop.hidden = true;
    if (restoreFocus) toggle?.focus();
  }
  if (toggle && nav) {
    document.body.classList.add('mobile-layout-ready');
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'mobile-nav-backdrop';
    backdrop.style.display = 'none';
    backdrop.hidden = true;
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-label', toggle.dataset.closeLabel);
    document.body.append(backdrop);
    toggle.addEventListener('click', () => {
      if (!media.matches) return;
      const open = !document.body.classList.contains('mobile-nav-open');
      document.body.classList.toggle('mobile-nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      backdrop.hidden = !open;
    });
    backdrop.addEventListener('click', () => closeNavigation(true));
    nav.addEventListener('click', event => {
      if (event.target.closest('a')) closeNavigation();
    });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('mobile-nav-open')) return;
      if (event.key === 'Escape') { closeNavigation(true); return; }
      if (event.key !== 'Tab') return;
      const items = [...nav.querySelectorAll('a[href],button,input,select')].filter(el => !el.disabled && el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }
  function labelTable(table) {
    if (table.closest('.office-word-document,.spreadsheet-preview-table,.office-editor-shell,.office-review-shell') || table.classList.contains('spreadsheet-preview-table')) return;
    const headers = [...(table.tHead?.rows[0]?.cells || [])];
    const fileTable = table.classList.contains('collaboration-work-package-table') && Boolean(table.querySelector('.collaboration-file-actions'));
    const listTable = table.classList.contains('list-table') && table.tHead?.rows.length === 1 && headers.length && headers.every(cell => cell.colSpan === 1 && cell.rowSpan === 1) && [...table.tBodies].every(body => [...body.rows].every(row => [...row.cells].every(cell => cell.rowSpan === 1)));
    const facts = table.matches('.detail-table,.basic-info-table') && !table.tHead && [...table.rows].every(row => [...row.cells].every(cell => cell.rowSpan === 1));
    if (fileTable || listTable) {
      table.classList.add('mobile-cards');
      if (fileTable) table.classList.add('mobile-file-cards');
      for (const body of table.tBodies) for (const row of body.rows) {
        let index = 0;
        for (const cell of row.cells) {
          cell.dataset.mobileLabel = cell.colSpan > 1 ? '' : (cell.dataset.label || headers[index]?.textContent.trim() || '');
          cell.classList.toggle('mobile-wide', cell.colSpan > 1 || cell.matches('.actions-cell') || Boolean(cell.querySelector('.role-list')) || (fileTable && index === 8));
          index += cell.colSpan;
        }
      }
    } else if (facts) {
      table.classList.add('mobile-facts');
      table.querySelectorAll('[colspan]').forEach(cell => cell.classList.toggle('mobile-wide', cell.colSpan > 1));
    }
    if (!table.parentElement.classList.contains('mobile-scroll')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'mobile-scroll';
      wrapper.dataset.mobileWrapper = '';
      wrapper.setAttribute('tabindex', '0');
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', table.caption?.textContent || (document.documentElement.lang === 'zh' ? '表格内容，可横向滚动' : 'Table, scroll horizontally if needed'));
      table.before(wrapper);
      wrapper.append(table);
    }
  }
  function adapt() {
    scheduled = false;
    if (!main) return;
    if (!media.matches) {
      closeNavigation();
      main.querySelectorAll('.mobile-stack').forEach(el => el.classList.remove('mobile-stack'));
      main.querySelectorAll('table.mobile-cards,table.mobile-facts').forEach(table => table.classList.remove('mobile-cards','mobile-file-cards','mobile-facts'));
      main.querySelectorAll('[data-mobile-wrapper]').forEach(wrapper => wrapper.replaceWith(...wrapper.childNodes));
      return;
    }
    main.querySelectorAll('table').forEach(labelTable);
    main.querySelectorAll('.gantt,.dxf-preview-stage').forEach(el => {
      if (el.parentElement.matches('[data-mobile-wrapper],.mobile-scroll')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'mobile-scroll';
      wrapper.dataset.mobileWrapper = '';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', document.documentElement.lang === 'zh' ? '图表内容，可横向滚动' : 'Diagram, scroll horizontally if needed');
      el.before(wrapper);
      wrapper.append(el);
    });
    for (const el of main.querySelectorAll('div,section,form,fieldset,label,article,dl')) {
      if (el.closest('table,.office-word-document,.spreadsheet-viewer-frame,.gantt,.dxf-preview-stage')) continue;
      if (getComputedStyle(el).display === 'grid') el.classList.add('mobile-stack');
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(adapt); } }
  media.addEventListener('change', schedule);
  if (main) new MutationObserver(records => { if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !node.matches?.('[data-mobile-wrapper]')))) schedule(); }).observe(main, { childList:true, subtree:true });
  adapt();
})();
