/* Shared pure rules. No requests, page mutations, or inferred profile locations. */
(() => {
  'use strict';
  const normalize = value => typeof value === 'string'
    ? value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
      .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim() : '';
  const aliases = new Map();
  const countries = new Map();
  const groups = new Map();
  const labels = new Map();
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const alias = (from, to) => aliases.set(normalize(from), normalize(to));
  for (const [code, formal, ...regions] of globalThis.XRF_REGIONS) {
    const display = names.of(code);
    const key = normalize(display);
    labels.set(key, display);
    alias(formal, display);
    alias(code, display);
    countries.set(key, new Set(regions.map(normalize)));
    for (const region of regions) {
      const group = normalize(region);
      labels.set(group, region);
      if (!groups.has(group)) groups.set(group, new Set());
      groups.get(group).add(key);
    }
  }
  // Familiar English labels for the UN M49 subregions.
  for (const [short, official] of Object.entries({
    'South Asia': 'Southern Asia', 'East Asia': 'Eastern Asia',
    'Southeast Asia': 'South-eastern Asia', 'South East Asia': 'South-eastern Asia',
    'West Asia': 'Western Asia', 'North Africa': 'Northern Africa',
    'East Africa': 'Eastern Africa', 'West Africa': 'Western Africa',
    'Central Africa': 'Middle Africa', 'Latin America': 'Latin America and the Caribbean'
  })) alias(short, official);
  for (const [short, official] of Object.entries({
    'USA': 'US', 'United States of America': 'US', 'UK': 'GB',
    'United Kingdom': 'GB', 'Great Britain': 'GB', 'Russia': 'RU',
    'South Korea': 'KR', 'North Korea': 'KP', 'Turkey': 'TR',
    'Ivory Coast': 'CI', 'Congo DRC': 'CD', 'DR Congo': 'CD',
    'Vietnam': 'VN', 'UAE': 'AE', 'Palestine': 'PS'
  })) alias(short, names.of(official));
  const northAmerica = new Set(['Northern America', 'Central America', 'Caribbean']
    .flatMap(region => [...(groups.get(normalize(region)) || [])]));
  groups.set('north america', northAmerica);
  labels.set('north america', 'North America');
  labels.set('middle east', 'Middle East'); // Exact X label only: no universal membership.
  const canonical = value => {
    const key = normalize(value);
    return aliases.get(key) || key;
  };
  const defaults = Object.freeze({enabled: true, blocked: ['India', 'Africa'], expandRegions: true, blockNewAccounts: true});
  function settings(value = {}) {
    return {
      enabled: value.enabled !== false,
      blocked: [...new Set((Array.isArray(value.blocked) ? value.blocked : defaults.blocked)
        .filter(v => typeof v === 'string' && v.trim() && v.length <= 80).map(v => v.trim()))].slice(0, 100),
      expandRegions: value.expandRegions !== false,
      blockNewAccounts: value.blockNewAccounts !== false
    };
  }
  function matches(location, config) {
    if (!config.enabled || !location) return false;
    const key = canonical(location);
    return config.blocked.some(label => {
      const blocked = canonical(label);
      if (blocked === key) return true;
      if (!config.expandRegions) return false;
      const members = groups.get(blocked);
      if (!members) return false;
      if (members.has(key)) return true;
      const subregion = groups.get(key);
      return !!subregion?.size && [...subregion].every(country => members.has(country));
    });
  }
  const active = config => config.enabled && (config.blocked.length > 0 || config.blockNewAccounts);
  function ageLimitAt(createdAt) {
    if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
    // Three calendar months, with month-end dates clamped to the last valid day.
    // Compute an anniversary so the account ages out once and never becomes young again.
    const date = new Date(createdAt);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 3);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    return date.getTime();
  }
  function matchReason(account, config, now = Date.now()) {
    if (!config.enabled || !account) return null;
    if (matches(account.location, config)) return 'region';
    const limit = ageLimitAt(account.createdAt);
    return config.blockNewAccounts && limit !== null && account.createdAt <= now && now < limit ? 'age' : null;
  }
  const reserved = new Set(['home', 'explore', 'search', 'i', 'settings', 'messages',
    'notifications', 'compose', 'intent', 'tos', 'privacy', 'login', 'logout', 'signup']);
  function handleFromLink(href) {
    try {
      const url = new URL(href, 'https://x.com');
      if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
      const hit = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(?:status\/\d+))?\/?$/);
      return hit && !reserved.has(hit[1].toLowerCase()) ? hit[1].toLowerCase() : null;
    } catch { return null; }
  }
  function headerHandle(header) {
    for (const link of header.querySelectorAll('a[href]')) {
      const handle = handleFromLink(link.getAttribute('href'));
      if (handle) return handle;
    }
    // X also renders linkless quote headers. The handle follows the display name.
    const handles = [...header.querySelectorAll('span, div[dir="ltr"]')]
      .map(node => node.textContent.trim()).filter(text => /^@[A-Za-z0-9_]{1,15}$/.test(text));
    return handles.length ? handles.at(-1).slice(1).toLowerCase() : null;
  }
  function authors(article) {
    const found = new Map();
    const headers = [...article.querySelectorAll('[data-testid="User-Name"]')]
      .filter(node => node.closest('article[data-testid="tweet"]') === article);
    headers.forEach((header, index) => {
      const handle = headerHandle(header);
      if (handle && !found.has(handle)) found.set(handle, index === 0 ? 'author' : 'quoted author');
    });
    // Reposts show the original author in the main header and the reposter above it.
    for (const link of article.querySelectorAll('[data-testid="socialContext"] a[href], a[data-testid="socialContext"][href]')) {
      const handle = handleFromLink(link.getAttribute('href'));
      if (handle && !found.has(handle)) found.set(handle, 'reposter');
    }
    return [...found].slice(0, 12).map(([handle, role]) => ({handle, role}));
  }
  function identity(article) {
    const header = article.querySelector('[data-testid="User-Name"]');
    const timeLink = header?.querySelector('a[href*="/status/"]');
    return `${timeLink?.getAttribute('href') || ''}|${authors(article).map(a => `${a.role}:${a.handle}`).join(',')}`;
  }
  function parseAccountDetails(data, requested) {
    const user = data?.data?.user_result_by_screen_name?.result;
    if (!user) throw new Error('Unsupported account response');
    if (['UserUnavailable', 'UserTombstone'].includes(user.__typename)) return {location: null, createdAt: null};
    const handle = user.core?.screen_name || user.legacy?.screen_name;
    if (typeof handle !== 'string' || handle.toLowerCase() !== requested.toLowerCase()) {
      throw new Error('Account identity did not match');
    }
    const location = user.about_profile?.account_based_in;
    if (location != null && (typeof location !== 'string' || location.length > 100)) throw new Error('Unsupported location');
    const rawDate = user.core?.created_at || user.legacy?.created_at;
    const timestamp = typeof rawDate === 'string' ? Date.parse(rawDate) : NaN;
    const createdAt = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() ? timestamp : null;
    return {location: location?.trim() || null, createdAt};
  }
  const parseAccount = (data, requested) => parseAccountDetails(data, requested).location;
  const feedPath = path => /^\/home\/?$/.test(path) || /^\/i\/lists\/\d+\/?$/.test(path);
  globalThis.XRF = Object.freeze({normalize, canonical, settings, defaults, matches, active, ageLimitAt, matchReason,
    handleFromLink, authors, identity, parseAccount, parseAccountDetails, feedPath,
    choices: [...labels.values()].sort((a, b) => a.localeCompare(b)),
    members: label => [...(groups.get(canonical(label)) || [])].map(key => labels.get(key) || key).sort()
  });
})();
