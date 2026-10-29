/* Expand only same-origin read-only mail frames so the page owns vertical scrolling. */
(() => {
  if (!window.bestcrmPhoneDesktopLayout) return;
  const main = document.querySelector('.opportunity-detail-page');
  if (!main) return;
  const bound = new WeakSet();
  function bind(frame) {
    if (bound.has(frame)) return;
    bound.add(frame);
    let observer;
    let scheduled = false;
    function measure() {
      scheduled = false;
      try {
        const doc = frame.contentDocument;
        if (!doc?.body || doc.readyState === 'loading' || !frame.getClientRects().length) return;
        const range = doc.createRange();
        range.selectNodeContents(doc.body);
        const bounds = range.getBoundingClientRect();
        const bodyStyle = doc.defaultView.getComputedStyle(doc.body);
        const lastStyle = doc.body.lastElementChild && doc.defaultView.getComputedStyle(doc.body.lastElementChild);
        const frameStyle = getComputedStyle(frame);
        const extra = [bodyStyle.paddingBottom, bodyStyle.marginBottom, lastStyle?.marginBottom, frameStyle.borderTopWidth, frameStyle.borderBottomWidth]
          .reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
        const height = Math.max(240, Math.ceil(bounds.bottom + doc.defaultView.scrollY + extra + 2));
        frame.dataset.phoneExpanded = '';
        if (Math.abs(frame.getBoundingClientRect().height - height) > 1) frame.style.height = height + 'px';
      } catch { /* A cross-origin frame keeps its existing scrolling behavior. */ }
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(measure); } }
    function loaded() {
      observer?.disconnect();
      try {
        const body = frame.contentDocument?.body;
        if (!body) return;
        if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(schedule); observer.observe(body); }
        frame.contentDocument.fonts?.ready.then(schedule);
      } catch { return; }
      schedule();
    }
    frame.addEventListener('load', loaded);
    window.addEventListener('resize', schedule);
    main.addEventListener('toggle', schedule, true);
    loaded();
  }
  const scan = () => main.querySelectorAll('iframe.email-html-body').forEach(bind);
  new MutationObserver(scan).observe(main, {childList:true,subtree:true});
  scan();
})();
