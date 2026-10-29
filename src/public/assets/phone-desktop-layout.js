/* Phones use the same 1280px desktop workspace in either folding state. */
(() => {
  const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!phone) return;
  window.bestcrmPhoneDesktopLayout = true;
  document.documentElement.classList.add('phone-desktop-layout');
  const viewport = document.querySelector('meta[name=viewport]');
  if (viewport) viewport.content = 'width=1280'; // Leave pinch zoom enabled.
  const ready = () => {
    const content = document.querySelector('.app-shell') || document.querySelector('main');
    let priorInert = false;
    let portraitInertApplied = false;
    const guide = document.createElement('div');
    guide.className = 'phone-landscape-guide';
    guide.setAttribute('role', 'status');
    guide.setAttribute('aria-live', 'polite');
    const zh = document.documentElement.lang === 'zh';
    const title = document.createElement('strong');
    title.textContent = zh ? '请横屏使用 BESTCRM' : 'Rotate your phone to use BESTCRM';
    const note = document.createElement('span');
    note.textContent = zh ? '旋转后继续，已填写内容保留' : 'Rotate to continue. Your entered values are kept.';
    guide.append(title, note);
    document.body.append(guide);
    const update = () => {
      const type = window.screen.orientation?.type;
      const portrait = type ? type.startsWith('portrait') : window.matchMedia('(orientation: portrait)').matches;
      guide.hidden = !portrait;
      document.documentElement.classList.toggle('phone-portrait', portrait);
      if (content && portrait && !portraitInertApplied) {
        priorInert = Boolean(content.inert);
        content.inert = true;
        portraitInertApplied = true;
      } else if (content && !portrait && portraitInertApplied) {
        content.inert = priorInert;
        portraitInertApplied = false;
      }
    };
    window.screen.orientation?.addEventListener?.('change', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    update();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
  else ready();
})();
