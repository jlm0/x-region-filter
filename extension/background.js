importScripts('shared/regions.js', 'shared/core.js', 'shared/endpoint.js');
'use strict';
const DAY = 86400000;
const MAX_CACHE = 2000;
const MIN_GAP = 30000;
const BUDGET_WINDOW = 15 * 60000;
const PER_WINDOW = 20;
let config = XRF.settings();
let sessionHeaders = null;
let queryId = XRF_ENDPOINT.query;
let cache = new Map();
let guard = {starts: [], nextAt: 0, until: 0, reason: ''};
const jobs = new Map();
const queue = [];
const visibility = new Map();
let running = false;
let timer = null;
let controller = null;
let lastLookup = null;
let quota = null;
const ready = Promise.all([chrome.storage.local.get(['settings', 'cache', 'guard', 'queryId', 'quota']),
  chrome.storage.session.get(['sessionHeaders', 'lastLookup'])]).then(([local, session]) => {
  config = XRF.settings(local.settings);
  cache = new Map((local.cache || []).filter(([handle, entry]) =>
    /^[a-z0-9_]{1,15}$/.test(handle) && entry?.expiresAt > Date.now()).slice(-MAX_CACHE));
  if (local.guard) guard = {...guard, ...local.guard};
  if (local.quota && Number.isFinite(local.quota.resetAt) && Number.isFinite(local.quota.remaining)) quota = local.quota;
  if (/^[\w-]{10,80}$/.test(local.queryId || '')) queryId = local.queryId;
  // Old versions accidentally prefixed an already-complete Authorization value.
  const authorization = session.sessionHeaders?.authorization;
  sessionHeaders = /^Bearer [^\s]+$/.test(authorization || '') ? {authorization} : null;
  lastLookup = session.lastLookup || null;
}).catch(() => {});

function deferred(reason, delay = 60000) {
  return {location: null, reason, retryAt: Date.now() + delay};
}
function finish(job, result) {
  jobs.delete(job.handle);
  job.resolve(result);
}
function clearQueue(reason, retryAt) {
  for (const job of queue.splice(0)) finish(job, retryAt ? {location:null,reason,retryAt} : deferred(reason));
}
function schedule() {
  if (timer || running || !queue.length) return;
  const delay = Math.max(0, guard.nextAt - Date.now());
  timer = setTimeout(() => { timer = null; void pump(); }, delay);
}
function capacity() {
  const now = Date.now();
  if (guard.until > now) return {reason: guard.reason, retryAt: guard.until};
  if (quota?.resetAt > now) {
    const reserve = Math.min(quota.limit - 1, Math.max(10, Math.ceil(quota.limit * .2)));
    if (quota.remaining <= reserve) return {
      reason: `Automatic lookups paused to preserve About-page capacity (${quota.remaining} requests remaining).`,
      retryAt: quota.resetAt + 1000
    };
  }
  const starts = guard.starts.filter(time => time > now - BUDGET_WINDOW);
  if (starts.length >= PER_WINDOW) return {
    reason: 'Automatic lookups paused after 20 new accounts. Cached accounts still filter.',
    retryAt: starts[0] + BUDGET_WINDOW + 1
  };
  return null;
}
async function observeQuota(headers) {
  const limit = Number(headers.get('x-rate-limit-limit'));
  const remaining = Number(headers.get('x-rate-limit-remaining'));
  const resetAt = Number(headers.get('x-rate-limit-reset')) * 1000;
  if (!headers.has('x-rate-limit-remaining') || !Number.isInteger(limit) || limit < 1 ||
      !Number.isInteger(remaining) || remaining < 0 || remaining > limit || !Number.isFinite(resetAt) || resetAt <= Date.now()) return;
  // Native About visits and extension requests use the same allowance. Out-of-order
  // responses may lower the remaining count, but must never increase it in one window.
  if (quota?.resetAt > resetAt) return;
  quota = {limit, remaining: quota?.resetAt === resetAt ? Math.min(quota.remaining, remaining) : remaining, resetAt};
  await chrome.storage.local.set({quota});
  const wait = capacity();
  if (wait) clearQueue(wait.reason, wait.retryAt);
}
async function lookup(handle, tabId) {
  await ready;
  if (!XRF.active(config)) return deferred('paused');
  const entry = cache.get(handle);
  if (entry && entry.expiresAt > Date.now() &&
      (!entry.ageUnchecked || !config.blockNewAccounts || XRF.matches(entry.location, config))) return {...entry, cached: true};
  if (!(entry?.expiresAt > Date.now())) cache.delete(handle);
  const wait = capacity();
  if (wait) return {location: null, ...wait};
  if (!sessionHeaders) return deferred('Open or reload your X feed to connect.');
  if (jobs.has(handle)) {
    jobs.get(handle).clients.add(tabId);
    return jobs.get(handle).promise;
  }
  if (queue.length >= 60) return deferred('Waiting for lookup capacity.');
  const job = {handle, clients: new Set([tabId]), created: Date.now()};
  job.promise = new Promise(resolve => {job.resolve = resolve;});
  jobs.set(handle, job);
  queue.push(job);
  schedule();
  return job.promise;
}
async function cooldown(reason, until) {
  guard.reason = reason;
  guard.until = Math.max(guard.until, until);
  await chrome.storage.local.set({guard});
  clearQueue(reason, guard.until);
}
async function rememberAbout(handle, location) {
  await ready;
  const previous = cache.get(handle);
  // The visible About page supplies a region, not an exact creation timestamp.
  const entry = {location, createdAt: previous?.createdAt || null,
    ageUnchecked: !previous?.createdAt, expiresAt: Date.now() + DAY / 4};
  cache.delete(handle);
  cache.set(handle, entry);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  const queued = queue.findIndex(job => job.handle === handle);
  if (queued !== -1 && (!entry.ageUnchecked || !config.blockNewAccounts || XRF.matches(location, config))) {
    finish(queue.splice(queued, 1)[0], entry);
  }
  await chrome.storage.local.set({cache: [...cache]});
  lastLookup = {handle, location, createdAt: entry.createdAt, at: Date.now(), source: 'about-page'};
  await chrome.storage.session.set({lastLookup});
  return {ok: true};
}
function resetTime(headers) {
  const now = Date.now();
  const reset = Number(headers.get('x-rate-limit-reset')) * 1000;
  const retry = headers.get('retry-after');
  const retryAt = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry || '');
  return Math.max(now + 60000, Number.isFinite(reset) ? reset : 0, Number.isFinite(retryAt) ? retryAt : 0);
}
function requestFromTab(tabId, handle, signal) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      void chrome.tabs.sendMessage(tabId, {type: 'cancelLookup', requestId}).catch(() => {});
      reject(new Error('Lookup cancelled'));
    };
    if (signal.aborted) {cancel(); return;}
    signal.addEventListener('abort', cancel, {once: true});
    chrome.tabs.sendMessage(tabId, {type: 'fetchCountry', requestId, handle, queryId,
      authorization: sessionHeaders.authorization}).then(resolve, () => reject(Object.assign(new Error('X tab disconnected'), {code: 'tab-disconnected'})))
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}
async function pump() {
  if (running) return;
  await ready;
  if (!XRF.active(config)) {clearQueue('paused'); return;}
  const wait = capacity();
  if (wait) {clearQueue(wait.reason, wait.retryAt); return;}
  const now = Date.now();
  guard.starts = guard.starts.filter(time => time > now - BUDGET_WINDOW);
  if (guard.nextAt > now) {schedule(); return;}
  const job = queue.shift();
  if (!job) return;
  if (now - job.created > 60000 || [...job.clients].every(id => visibility.get(id) === false)) {
    finish(job, deferred('Waiting until this post is visible.')); schedule(); return;
  }
  if (!sessionHeaders) {finish(job, deferred('Open or reload your X feed to connect.')); clearQueue('Waiting for X.'); return;}
  running = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 8000);
  try {
    guard.starts.push(now);
    // Reserve the timeout plus the pacing interval while the request is in flight.
    // A worker restart during a lookup therefore errs toward waiting longer.
    guard.nextAt = now + 8000 + MIN_GAP;
    // Persist pacing before sending: a disposable MV3 worker must not restart its budget.
    await chrome.storage.local.set({guard});
    const tabId = [...job.clients].find(id => visibility.get(id) !== false);
    // Fetch inside X's isolated content context, using its current CSRF cookie.
    // The background worker still owns the shared queue, cache and rate budget.
    const response = await requestFromTab(tabId, job.handle, controller.signal);
    if (!response || typeof response.status !== 'number') throw new Error('No tab response');
    await observeQuota(new Headers(response.headers || {}));
    if (response.status === 429) {
      await cooldown('X rate limit: lookups are temporarily paused.', resetTime(new Headers(response.headers)));
      finish(job, {location: null, reason: guard.reason, retryAt: guard.until});
    } else if ([401, 403].includes(response.status)) {
      sessionHeaders = null;
      await chrome.storage.session.remove('sessionHeaders');
      await cooldown(`X declined the lookup (HTTP ${response.status}${response.errorCode ? `, code ${response.errorCode}` : ''}). Reload X or open About this account.`, Date.now() + 300000);
      finish(job, {location: null, reason: guard.reason, retryAt: guard.until});
    } else {
      if (response.status !== 200 || response.error) throw new Error('Lookup endpoint unavailable');
      const location = response.location;
      if (location !== null && (typeof location !== 'string' || location.length > 100)) throw new Error('Unsupported location');
      const createdAt = Number.isFinite(response.createdAt) && response.createdAt > 0 && response.createdAt <= Date.now()
        ? response.createdAt : null;
      const entry = {location, createdAt, expiresAt: Date.now() + (location || createdAt ? DAY / 4 : 300000)};
      cache.delete(job.handle);
      cache.set(job.handle, entry);
      while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
      await chrome.storage.local.set({cache: [...cache]});
      lastLookup = {handle: job.handle, location, createdAt, at: Date.now()};
      await chrome.storage.session.set({lastLookup});
      if (guard.until <= Date.now()) guard.reason = '';
      finish(job, entry);
    }
  } catch (error) {
    if (!XRF.active(config)) finish(job, deferred('paused'));
    else if (error.code === 'tab-disconnected') finish(job, deferred('Waiting for an active X tab.', MIN_GAP));
    else {
      await cooldown('Lookup unavailable. Open About this account on an X profile to refresh it.', Date.now() + 300000).catch(() => {});
      finish(job, {location: null, reason: guard.reason, retryAt: guard.until || Date.now() + 60000});
    }
  } finally {
    clearTimeout(timeout);
    // Space requests after completion as well as before dispatch. Storage latency
    // must never shorten the minimum interval between actual network starts.
    guard.nextAt = Date.now() + MIN_GAP;
    await chrome.storage.local.set({guard}).catch(() => {});
    controller = null;
    running = false;
    schedule();
  }
}

// Passive browser observation: never replace X's fetch/XHR, rewrite responses, or block requests.
// Copy the complete Authorization header as-is. Never prepend a second Bearer prefix.
// CSRF is read just before the lookup in the X tab, not reused from this observation.
chrome.webRequest.onSendHeaders.addListener(details => {
  if (details.tabId < 0) return;
  const authorization = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization')?.value;
  if (!/^Bearer [^\s]+$/.test(authorization || '') || authorization.length > 512) return;
  void ready.then(async () => {
    if (sessionHeaders?.authorization === authorization) return;
    sessionHeaders = {authorization};
    await chrome.storage.session.set({sessionHeaders});
  }).catch(() => {});
}, {urls: ['https://x.com/i/api/graphql/*'], types: ['xmlhttprequest']}, ['requestHeaders']);

chrome.webRequest.onCompleted.addListener(details => {
  if (details.tabId < 0 || details.statusCode !== 200) return;
  const match = new URL(details.url).pathname.match(/^\/i\/api\/graphql\/([\w-]{10,80})\/AboutAccountQuery$/);
  if (!match) return;
  void ready.then(async () => {
    queryId = match[1];
    // Successful native About-account requests repair endpoint failures, never rate-limit cooldowns.
    if (!guard.reason.startsWith('X rate limit')) {guard.until = 0; guard.reason = '';}
    await chrome.storage.local.set({queryId, guard});
    schedule();
  }).catch(() => {});
}, {urls: ['https://x.com/i/api/graphql/*/AboutAccountQuery*'], types: ['xmlhttprequest']});

// Learn the shared allowance from ALL About responses, including manual visits.
// Do not wait for a 429: leave a reserve while filtering already-cached accounts.
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.tabId < 0) return;
  const headers = new Headers();
  for (const header of details.responseHeaders || []) {
    if (/^(x-rate-limit-(limit|remaining|reset)|retry-after)$/i.test(header.name) && typeof header.value === 'string') headers.set(header.name, header.value);
  }
  void ready.then(async () => {
    await observeQuota(headers);
    if (details.statusCode === 429) await cooldown('X rate limit: About-page lookups are paused until the reset time.', resetTime(headers));
  }).catch(() => {});
}, {urls: ['https://x.com/i/api/graphql/*/AboutAccountQuery*'], types: ['xmlhttprequest']}, ['responseHeaders']);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    config = XRF.settings(changes.settings.newValue);
    if (!XRF.active(config)) {clearQueue('paused'); controller?.abort();}
  }
});
chrome.tabs.onRemoved.addListener(id => {
  visibility.delete(id);
  for (const job of jobs.values()) job.clients.delete(id);
});
chrome.runtime.onInstalled.addListener(() => {
  void ready.then(() => chrome.storage.local.set({settings: config}));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  const xPage = sender.tab && sender.frameId === 0 && /^https:\/\/x\.com\//.test(sender.url || '');
  if (!extensionPage && !xPage) return false;
  if (message?.type === 'hiddenCount' && xPage && Number.isInteger(message.hidden) &&
      message.hidden >= 0 && message.hidden <= 10000) {
    const hidden = XRF.feedPath(new URL(sender.url).pathname) && XRF.active(config) ? message.hidden : 0;
    const tabId = sender.tab.id;
    void Promise.all([
      chrome.action.setBadgeText({tabId, text: hidden > 99 ? '99+' : hidden ? String(hidden) : ''}),
      chrome.action.setBadgeBackgroundColor({tabId, color: '#0f766e'}),
      chrome.action.setBadgeTextColor({tabId, color: '#ffffff'}),
      chrome.action.setTitle({tabId, title: hidden ? `X Region Filter · ${hidden} ${hidden === 1 ? 'post' : 'posts'} hidden` : 'X Region Filter'})
    ]).catch(() => {});
    respond({ok: true});
    return false;
  }
  if (message?.type === 'observedAbout' && xPage &&
      /^[a-z0-9_]{1,15}$/.test(message.handle || '') &&
      XRF.aboutHandle(new URL(sender.url).pathname) === message.handle &&
      typeof message.location === 'string' && message.location.trim() && message.location.length <= 100) {
    rememberAbout(message.handle, message.location.trim()).then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (message?.type === 'visibility' && xPage) {
    visibility.set(sender.tab.id, message.visible === true); respond({ok: true}); return false;
  }
  if (message?.type === 'lookup' && xPage && /^[a-z0-9_]{1,15}$/.test(message.handle || '')) {
    lookup(message.handle, sender.tab.id).then(respond).catch(() => respond(deferred('Lookup unavailable.')));
    return true;
  }
  if (message?.type === 'status' && extensionPage) {
    ready.then(async () => {
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      const tab = tabs.find(tab => /^https:\/\/x\.com\//.test(tab.url || ''));
      const feed = tab ? await chrome.tabs.sendMessage(tab.id, {type: 'feedStatus'}).catch(() => null) : null;
      const wait = capacity();
      respond({connected: !!sessionHeaders, cached: cache.size,
        known: [...cache.values()].filter(entry => entry.location && entry.expiresAt > Date.now()).length,
        ageKnown: [...cache.values()].filter(entry => entry.createdAt && entry.expiresAt > Date.now()).length,
        lastLookup, feed, pending: jobs.size, reason: wait?.reason || '', retryAt: wait?.retryAt || 0,
        quota: quota?.resetAt > Date.now() ? quota : null});
    }).catch(() => respond({connected: false, reason: 'Reload X to reconnect.'}));
    return true;
  }
  if (message?.type === 'clearCache' && extensionPage) {
    ready.then(async () => {cache.clear(); await chrome.storage.local.remove('cache'); respond({ok: true});});
    return true;
  }
  return false;
});
