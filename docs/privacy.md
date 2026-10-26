# Privacy

X Region Filter runs in your browser. Its only network destination is X, for account lookups within your existing signed-in session. Fonts and scripts are included in the extension package. The project has no telemetry, remote settings service, analytics, or cloud synchronization.

## What is stored

Persistent extension storage holds your filter settings; up to 2,000 account handles with regions, creation dates, and expiry times; request-limit and cooldown state; and the current About query identifier. Metadata with either usable field expires after six hours. A response missing both expires after five minutes. Expired records are ignored and can remain physically stored until the next cache write.

Session storage holds the observed X Authorization header and the most recent successful lookup. Chrome clears session storage when the browser restarts or the extension is disabled, reloaded, or updated. The header is needed to make the same authenticated About request X's own interface uses. The extension reads the current CSRF cookie for each request and does not save it.

The content script reads visible account identities and post IDs to associate results with feed rows. It does not persist post text, messages, passwords, or a browsing history. Its per-tab account cache is bounded at 1,000 entries. On English About pages it also reads the displayed account region, validates the account header, and saves the label without another request. The toolbar badge contains only the current hidden-post count.

## Removing data

“Clear account cache” removes persistent account metadata and clears the content scripts' account caches. It keeps your filters and request-limit state. The latest lookup can remain visible for the current session. Automatic checks resume as you browse with filtering enabled. Opening an About page can also repopulate its displayed region.

Disabling the extension stops its work; reload X to clear any already-injected page state. Uninstalling deletes its extension storage. Reload X afterward to remove the existing placeholders and styles.

## Sharing a bug report

Reports should use synthetic handles and responses where possible. Do not attach browser profiles, cookies, Authorization headers, CSRF values, or a full network export. A cropped screenshot of the error and the extension version are usually enough to start. See [CONTRIBUTING.md](../CONTRIBUTING.md).
