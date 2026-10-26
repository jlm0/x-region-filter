(() => {
  'use strict';
  let frame = null;
  let last = '';
  let stopped = false;
  function inspect() {
    frame = null;
    const account = XRF.readAboutPage(document, location.pathname);
    if (!account) return;
    const stamp = `${account.handle}:${account.location}`;
    if (stamp === last) return;
    last = stamp;
    void chrome.runtime.sendMessage({type: 'observedAbout', ...account}).then(result => {
      if (!result?.ok) last = '';
    }).catch(() => {stopped = true; observer.disconnect();});
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(inspect);
  }
  const observer = new MutationObserver(schedule);
  function sync() {
    observer.disconnect();
    cancelAnimationFrame(frame);
    frame = null;
    last = '';
    if (stopped || !XRF.aboutHandle(location.pathname)) return;
    observer.observe(document.body, {childList: true, characterData: true, subtree: true});
    schedule();
  }
  window.addEventListener('popstate', sync);
  window.navigation?.addEventListener('currententrychange', sync);
  window.addEventListener('pageshow', sync);
  sync();
})();
