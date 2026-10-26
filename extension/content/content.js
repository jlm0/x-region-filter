(() => {
  'use strict';
  const ARTICLE = 'article[data-testid="tweet"]';
  const HEADER = '[data-testid="User-Name"], [data-testid="socialContext"]';
  let config = XRF.settings();
  let enabled = false;
  let frame = null;
  let retryTimer = null;
  let stopped = false;
  let badgeTimer = null;
  let lastBadge = -1;
  const records = new Map();
  const dirty = new Set();
  const visible = new Set();
  const accounts = new Map();
  const pending = new Map();
  const subscribers = new Map();
  const send = message => chrome.runtime.sendMessage(message);
  const transports = new Map();
  function reportHidden() {
    if (badgeTimer) return;
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      const hidden = [...records.values()].filter(record => record.hidden).length;
      if (hidden === lastBadge) return;
      lastBadge = hidden;
      void send({type: 'hiddenCount', hidden}).catch(() => {});
    }, 100);
  }

  // The site's JavaScript cannot call this isolated-world extension listener.
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'feedStatus') {
      const waiting = new Set();
      for (const article of visible) {
        const record = records.get(article);
        if (record?.hidden) continue;
        for (const {handle} of record?.authors || []) {
          if (!(accounts.get(handle)?.expiresAt > Date.now())) waiting.add(handle);
        }
      }
      respond({enabled, scope: XRF.feedPath(location.pathname),
        hidden: [...records.values()].filter(record => record.hidden).length, waiting: waiting.size});
      return false;
    }
    if (message?.type === 'cancelLookup') {transports.get(message.requestId)?.abort(); respond({ok: true}); return false;}
    if (message?.type !== 'fetchCountry' || !/^[a-z0-9_]{1,15}$/.test(message.handle || '') ||
        !/^[\w-]{10,80}$/.test(message.queryId || '') || !/^Bearer [^\s]+$/.test(message.authorization || '') ||
        message.authorization.length > 512 || typeof message.requestId !== 'string' ||
        message.requestId.length > 80 || transports.size >= 2 || location.origin !== 'https://x.com') return false;
    const abort = new AbortController();
    transports.set(message.requestId, abort);
    const timeout = setTimeout(() => abort.abort(), 8000);
    void (async () => {
      try {
        const csrf = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('ct0='))?.slice(4);
        if (!csrf) {respond({status: 401, error: 'missing-session'}); return;}
        const url = new URL(`/i/api/graphql/${message.queryId}/AboutAccountQuery`, location.origin);
        url.searchParams.set('variables', JSON.stringify({screenName: message.handle}));
        const response = await fetch(url, {method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
          signal: abort.signal, headers: {authorization: message.authorization, 'x-csrf-token': decodeURIComponent(csrf),
            'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes', 'x-twitter-client-language': 'en',
            'accept-language': 'en-US,en;q=0.9', 'content-type': 'application/json'}});
        const headers = Object.fromEntries(['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset', 'retry-after']
          .map(key => [key, response.headers.get(key)]).filter(([, value]) => value !== null));
        const data = await response.json().catch(() => null);
        if (!response.ok) {respond({status: response.status, headers, errorCode: data?.errors?.[0]?.code}); return;}
        try {respond({status: response.status, headers, ...XRF.parseAccountDetails(data, message.handle)});}
        catch {respond({status: response.status, headers, error: 'unsupported-account-response'});}
      } catch {respond({status: 0, error: 'lookup-unavailable'});}
      finally {clearTimeout(timeout); transports.delete(message.requestId);}
    })();
    return true;
  });

  function restore(article, record) {
    if (!record.hidden) return;
    article.removeAttribute('data-xrf-hidden');
    article.removeAttribute('data-xrf-reason');
    if (record.aria == null) article.removeAttribute('aria-hidden');
    else article.setAttribute('aria-hidden', record.aria);
    article.inert = record.inert;
    record.hidden = false;
    record.reason = null;
    reportHidden();
  }
  function hide(article, record, reason) {
    if (record.reason !== reason) {article.setAttribute('data-xrf-reason', reason); record.reason = reason;}
    if (record.hidden) return;
    record.aria = article.getAttribute('aria-hidden');
    record.inert = article.inert;
    article.setAttribute('data-xrf-hidden', 'true');
    article.setAttribute('aria-hidden', 'true');
    article.inert = true;
    record.hidden = true;
    reportHidden();
    for (const video of article.querySelectorAll('video')) video.pause();
  }
  function unsubscribe(article, record) {
    for (const {handle} of record.authors) {
      const set = subscribers.get(handle);
      set?.delete(article);
      if (set?.size === 0) subscribers.delete(handle);
    }
  }
  function forget(article) {
    const record = records.get(article);
    if (!record) return;
    restore(article, record);
    unsubscribe(article, record);
    intersections.unobserve(article);
    records.delete(article);
    dirty.delete(article);
    visible.delete(article);
  }
  function enqueue(article) {
    if (!enabled || !article.isConnected) return;
    dirty.add(article);
    if (!frame && !document.hidden) frame = requestAnimationFrame(flush);
  }
  function track(article) {
    if (!records.has(article)) {
      records.set(article, {stamp: '', authors: [], hidden: false});
      intersections.observe(article);
    }
    enqueue(article);
  }
  function scan(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches(ARTICLE)) track(node);
    for (const article of node.querySelectorAll(ARTICLE)) track(article);
  }
  function arrangeRetry() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (!enabled || document.hidden) return;
    let next = Infinity;
    for (const article of visible) {
      for (const {handle} of records.get(article)?.authors || []) {
        const entry = accounts.get(handle);
        if (entry) next = Math.min(next, entry.expiresAt || entry.retryAt || Infinity);
        if (entry?.ageUnchecked && config.blockNewAccounts && !XRF.matches(entry.location, config)) {
          next = Math.min(next, entry.retryAt || Infinity);
        }
        const ageLimit = config.blockNewAccounts ? XRF.ageLimitAt(entry?.createdAt) : null;
        if (ageLimit > Date.now()) next = Math.min(next, ageLimit);
      }
    }
    if (Number.isFinite(next)) retryTimer = setTimeout(() => {
      retryTimer = null;
      for (const article of visible) enqueue(article);
    }, Math.max(1000, Math.min(2147483647, next - Date.now() + 5)));
  }
  function request(handle) {
    if (pending.has(handle) || !enabled || document.hidden) return;
    const promise = send({type: 'lookup', handle}).then(result => {
      if (!result || typeof result !== 'object') return;
      // A manual About visit can fill the cache while an older queued reply is pending.
      const current = accounts.get(handle);
      if (current?.expiresAt > Date.now() && !(result.expiresAt >= current.expiresAt)) {
        if (result.retryAt) accounts.set(handle, {...current, retryAt: result.retryAt});
        return;
      }
      accounts.delete(handle);
      accounts.set(handle, result);
      while (accounts.size > 1000) accounts.delete(accounts.keys().next().value);
      for (const article of subscribers.get(handle) || []) enqueue(article);
    }).catch(() => {
      // An extension update invalidates the old content context. Restore the feed.
      stop();
    }).finally(() => {
      pending.delete(handle);
      arrangeRetry();
    });
    pending.set(handle, promise);
  }
  function process(article) {
    if (!article.isConnected) {forget(article); return;}
    const record = records.get(article);
    if (!record) return;
    const stamp = XRF.identity(article);
    if (stamp !== record.stamp) {
      // Restore immediately when X recycles a row, including before a delayed lookup returns.
      restore(article, record);
      unsubscribe(article, record);
      record.stamp = stamp;
      record.authors = XRF.authors(article);
      for (const {handle} of record.authors) {
        if (!subscribers.has(handle)) subscribers.set(handle, new Set());
        subscribers.get(handle).add(article);
      }
    }
    let reason = null;
    const now = Date.now();
    for (const {handle} of record.authors) {
      const entry = accounts.get(handle);
      if (entry?.expiresAt > now) reason ||= XRF.matchReason(entry, config, now);
    }
    if (reason) {hide(article, record, reason); return;}
    restore(article, record);
    if (!visible.has(article)) return;
    for (const {handle} of record.authors) {
      const entry = accounts.get(handle);
      if (!entry || Math.max(entry.expiresAt || 0, entry.retryAt || 0) <= now ||
          (entry.ageUnchecked && config.blockNewAccounts && (entry.retryAt || 0) <= now)) request(handle);
    }
  }
  function flush() {
    frame = null;
    if (!enabled || document.hidden) return;
    const start = performance.now();
    // Limit each batch so a burst of feed updates yields back to scrolling.
    for (const article of dirty) {
      dirty.delete(article);
      process(article);
      if (performance.now() - start >= 4) break;
    }
    if (dirty.size) frame = requestAnimationFrame(flush);
    arrangeRetry();
  }
  const intersections = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {visible.add(entry.target); enqueue(entry.target);}
      else visible.delete(entry.target);
    }
  }, {rootMargin: '600px 0px'});
  const mutations = new MutationObserver(changes => {
    for (const change of changes) {
      const target = change.target.nodeType === Node.ELEMENT_NODE ? change.target : change.target.parentElement;
      if (!target) continue;
      if (change.type === 'childList') {
        const article = target.closest(ARTICLE);
        if (article) enqueue(article);
        for (const node of change.addedNodes) scan(node);
        for (const node of change.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches(ARTICLE) && !node.isConnected) forget(node);
          for (const removed of node.querySelectorAll(ARTICLE)) if (!removed.isConnected) forget(removed);
        }
      } else if (target.closest(HEADER)) {
        const article = target.closest(ARTICLE);
        if (article) enqueue(article);
      }
    }
  });
  function sync() {
    const active = !stopped && XRF.active(config) && XRF.feedPath(location.pathname);
    enabled = !!active;
    reportHidden();
    void send({type: 'visibility', visible: enabled && !document.hidden}).catch(() => {});
    if (!enabled) {
      mutations.disconnect();
      intersections.disconnect();
      cancelAnimationFrame(frame);
      frame = null;
      clearTimeout(retryTimer);
      retryTimer = null;
      for (const article of [...records.keys()]) forget(article);
      dirty.clear();
      return;
    }
    mutations.observe(document.body, {childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['href']});
    scan(document.querySelector('main') || document.body);
  }
  function stop() {stopped = true; sync();}
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {config = XRF.settings(changes.settings.newValue); sync();}
    if (changes.cache && !changes.cache.newValue) {
      accounts.clear();
      for (const article of records.keys()) enqueue(article);
    } else if (changes.cache?.newValue) {
      for (const [handle, entry] of changes.cache.newValue) {
        if (!subscribers.has(handle) || !(entry.expiresAt > Date.now())) continue;
        const previous = accounts.get(handle);
        if (previous?.expiresAt === entry.expiresAt && previous.location === entry.location &&
            previous.createdAt === entry.createdAt && previous.ageUnchecked === entry.ageUnchecked) continue;
        accounts.delete(handle);
        accounts.set(handle, entry);
        while (accounts.size > 1000) accounts.delete(accounts.keys().next().value);
        for (const article of subscribers.get(handle)) enqueue(article);
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    void send({type: 'visibility', visible: enabled && !document.hidden}).catch(() => {});
    if (document.hidden) {clearTimeout(retryTimer); return;}
    for (const article of records.keys()) enqueue(article);
  });
  window.addEventListener('popstate', sync);
  window.navigation?.addEventListener('currententrychange', sync);
  window.addEventListener('pagehide', () => {
    void send({type: 'visibility', visible: false}).catch(() => {});
  });
  window.addEventListener('pageshow', sync);
  chrome.storage.local.get('settings').then(result => {config = XRF.settings(result.settings); sync();}).catch(stop);
})();
