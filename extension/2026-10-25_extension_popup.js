'use strict';
const $ = id => document.getElementById(id);
let config = XRF.settings();
let saving = Promise.resolve();
function render() {
  $('enabled').checked = config.enabled;
  $('expand').checked = config.expandRegions;
  $('new-accounts').checked = config.blockNewAccounts;
  $('count').textContent = `${config.blocked.length} selected`;
  $('chips').replaceChildren();
  $('coverage').replaceChildren();
  for (const label of config.blocked) {
    const chip = document.createElement('span'); chip.className = 'chip';
    chip.append(document.createTextNode(label));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${label}`);
    remove.addEventListener('click', () => {config.blocked = config.blocked.filter(v => v !== label); save();});
    chip.append(remove); $('chips').append(chip);
    const countries = config.expandRegions ? XRF.members(label) : [];
    const line = document.createElement('p');
    line.textContent = `${label}: ${countries.length ? countries.join(', ') : 'exact country or region label'}.`;
    $('coverage').append(line);
  }
}
async function status() {
  $('feed-status').textContent = '';
  $('last-lookup').textContent = '';
  $('quota-status').textContent = '';
  if (!XRF.active(config)) {$('status').textContent = 'Filtering paused. Posts are visible.'; return;}
  try {
    const state = await chrome.runtime.sendMessage({type: 'status'});
    const resume = state.retryAt > Date.now() ? ` Next check after ${new Date(state.retryAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.` : '';
    $('status').textContent = (state.reason ? state.reason + resume : '') || (state.connected
      ? `Connected · ${state.known} locations · ${state.ageKnown} account ages known${state.pending ? ` · ${state.pending} pending` : ''}`
      : 'Ready. Reload your signed-in X feed to connect.');
    if (state.feed) $('feed-status').textContent = state.feed.scope
      ? `${state.feed.hidden} ${state.feed.hidden === 1 ? 'post' : 'posts'} hidden in this feed · ${state.feed.waiting} authors awaiting a check`
      : 'Filtering runs in Home and Lists.';
    if (state.lastLookup) {
      const account = state.lastLookup;
      const joined = account.createdAt ? ` · Joined ${new Date(account.createdAt).toLocaleDateString()}` : '';
      const reason = XRF.matchReason(account, config);
      $('last-lookup').textContent = `Last lookup: @${account.handle} · ${account.location || 'Location unavailable'}${joined}${reason ? ` · ${reason === 'age' ? 'under 3 months old' : 'matches your blocked regions'}` : ''}`;
    }
    $('quota-status').textContent = state.quota
      ? `X About allowance: ${state.quota.remaining} of ${state.quota.limit} remaining. Automatic checks share this with your About-page visits.`
      : 'Unfamiliar accounts are checked gradually: at most 20 per 15 minutes. Missing data does not trigger a rule.';
  } catch {$('status').textContent = 'Reopen the extension to reconnect.';}
}
function save() {
  config = XRF.settings(config);
  const snapshot = structuredClone(config);
  render();
  saving = saving.then(() => chrome.storage.local.set({settings: snapshot})).then(status)
    .catch(() => {$('status').textContent = 'Could not save. Reopen the extension and try again.';});
}
$('enabled').addEventListener('change', event => {config.enabled = event.target.checked; save();});
$('expand').addEventListener('change', event => {config.expandRegions = event.target.checked; save();});
$('new-accounts').addEventListener('change', event => {config.blockNewAccounts = event.target.checked; save();});
$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  const label = $('place').value.trim();
  if (label && !config.blocked.some(v => XRF.canonical(v) === XRF.canonical(label))) config.blocked.push(label);
  $('place').value = ''; save();
});
$('clear').addEventListener('click', async () => {
  try {await chrome.runtime.sendMessage({type: 'clearCache'}); await status();}
  catch {$('status').textContent = 'Could not clear the cache. Please try again.';}
});
for (const label of XRF.choices) {
  const option = document.createElement('option'); option.value = label; $('places').append(option);
}
chrome.storage.local.get('settings').then(result => {config = XRF.settings(result.settings); render(); return status();});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && (changes.lastLookup || changes.sessionHeaders)) || (area === 'local' && (changes.guard || changes.quota))) void status();
});
