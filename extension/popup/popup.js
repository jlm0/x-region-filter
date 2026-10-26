'use strict';
const $ = id => document.getElementById(id);
let config = XRF.settings();
let saving = Promise.resolve();
let statusVersion = 0;
let loaded = false;

function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function render() {
  $('enabled').checked = config.enabled;
  $('expand').checked = config.expandRegions;
  $('new-accounts').checked = config.blockNewAccounts;
  $('count').textContent = `${config.blocked.length} selected`;
  $('chips').replaceChildren();
  $('coverage').replaceChildren();
  if (!config.blocked.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'No regions blocked. Add one below.';
    $('chips').append(empty);
  }
  for (const [index, label] of config.blocked.entries()) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const text = document.createElement('span');
    text.className = 'chip-label';
    text.textContent = label;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${label}`);
    remove.addEventListener('click', () => {
      config.blocked = config.blocked.filter(value => value !== label);
      save();
      const buttons = $('chips').querySelectorAll('button');
      (buttons[Math.min(index, buttons.length - 1)] || $('place')).focus();
    });
    chip.append(text, remove);
    $('chips').append(chip);
    const countries = config.expandRegions ? XRF.members(label) : [];
    const line = document.createElement('p');
    line.textContent = `${label}: ${countries.length ? countries.join(', ') : 'exact country or region label'}.`;
    $('coverage').append(line);
  }
  if (!config.blocked.length) $('coverage').textContent = 'Add a region to see its included countries.';
}
function heading(title, state = '') {
  $('state-title').textContent = title;
  $('state-mark').dataset.state = state;
}
async function status() {
  const version = ++statusVersion;
  try {
    const state = await chrome.runtime.sendMessage({type: 'status'});
    if (version !== statusVersion) return;
    if (!state || typeof state.connected !== 'boolean') throw new Error('Unavailable status');
    const active = XRF.active(config);
    const scoped = state.feed?.scope;
    if (!config.enabled) {
      heading('Filtering paused');
      $('feed-status').textContent = 'Your filters are saved. Posts stay visible.';
    } else if (!active) {
      heading('No filters selected');
      $('feed-status').textContent = 'Add a region or turn on the account age filter.';
    } else {
      heading(state.reason ? 'Waiting to check accounts' : state.connected ? 'Filtering on' : 'Ready for X', state.reason ? 'waiting' : state.connected ? 'on' : '');
      $('feed-status').textContent = scoped
        ? `${state.feed.hidden} ${state.feed.hidden === 1 ? 'post' : 'posts'} hidden in this feed · ${state.feed.waiting} authors awaiting a check`
        : 'Open your X Home feed or a List to start.';
    }
    const resume = state.retryAt > Date.now()
      ? ` Next check after ${new Date(state.retryAt).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}.` : '';
    $('status').textContent = !active ? '' : state.reason ? state.reason + resume
      : state.connected ? 'Connected. New accounts are checked gradually.' : '';
    $('known-locations').textContent = Number.isFinite(state.known) ? state.known.toLocaleString() : '-';
    $('known-ages').textContent = Number.isFinite(state.ageKnown) ? state.ageKnown.toLocaleString() : '-';
    const account = state.lastLookup;
    if (account) {
      const joined = account.createdAt ? ` · Joined ${new Date(account.createdAt).toLocaleDateString()}` : '';
      const reason = XRF.matchReason(account, config);
      $('last-lookup').textContent = `Last lookup: @${account.handle} · ${account.location || 'Location unavailable'}${joined}${reason ? ` · ${reason === 'age' ? 'under 3 months old' : 'matches your blocked regions'}` : ''}`;
    } else $('last-lookup').textContent = 'No account checked in this browser session.';
    $('quota-status').textContent = state.quota
      ? `X About allowance: ${state.quota.remaining} of ${state.quota.limit} remaining. Shared with your About-page visits.`
      : 'At most 20 new checks per 15 minutes, with at least 30 seconds between checks.';
  } catch {
    if (version !== statusVersion) return;
    heading('Status unavailable');
    $('feed-status').textContent = 'Reopen the extension to reconnect.';
    $('status').textContent = '';
  }
}
function save() {
  if (!loaded) return;
  config = XRF.settings(config);
  const snapshot = structuredClone(config);
  render();
  error();
  $('save-status').textContent = 'Saving…';
  saving = saving.then(async () => {
    await chrome.storage.local.set({settings: snapshot});
    $('save-status').textContent = 'Saved';
    await status();
  }).catch(() => {
    $('save-status').textContent = 'Not saved';
    error('Could not save your changes. Reopen the extension and try again.');
  });
}
$('enabled').addEventListener('change', event => {config.enabled = event.target.checked; save();});
$('expand').addEventListener('change', event => {config.expandRegions = event.target.checked; save();});
$('new-accounts').addEventListener('change', event => {config.blockNewAccounts = event.target.checked; save();});
$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  const label = $('place').value.trim();
  const duplicate = config.blocked.some(value => XRF.canonical(value) === XRF.canonical(label));
  $('place-feedback').hidden = false;
  if (!label || duplicate) {
    $('place-feedback').textContent = duplicate ? `${label} is already blocked.` : 'Enter a country or region.';
    $('place').focus();
    return;
  }
  config.blocked.push(label);
  $('place-feedback').textContent = `${label} added.`;
  $('place').value = '';
  save();
  $('place').focus();
});
$('clear').addEventListener('click', async () => {
  $('clear').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({type: 'clearCache'});
    if (!result?.ok) throw new Error('Cache unavailable');
    error();
    $('save-status').textContent = 'Account cache cleared';
    await status();
  } catch {error('Could not clear the cache. Try again.');}
  finally {$('clear').disabled = false;}
});
$('refresh').addEventListener('click', () => void status());
for (const label of XRF.choices) {
  const option = document.createElement('option');
  option.value = label;
  $('places').append(option);
}
chrome.storage.local.get('settings').then(result => {
  config = XRF.settings(result.settings);
  loaded = true;
  render();
  $('enabled').disabled = false;
  $('settings').disabled = false;
  return status();
}).catch(() => {
  heading('Settings unavailable');
  $('feed-status').textContent = 'Reopen the extension to try again.';
  error('Your saved filters could not be loaded.');
});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && (changes.lastLookup || changes.sessionHeaders)) ||
      (area === 'local' && (changes.guard || changes.quota))) void status();
});
