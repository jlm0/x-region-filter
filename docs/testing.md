# Testing and limits

The automated checks use synthetic data in disposable profiles. They establish behavior for the layouts and responses exercised, not compatibility with every future X layout.

## What runs

`npm run test:unit` runs 20 controlled-clock checks of region membership, response validation, settings migration, calendar-month boundaries, cache expiry, concurrency, pacing, the rolling request budget, native quota accounting, restart persistence, and cancellation. It uses the production limits.

`npm run test:browser` loads the unpacked extension and runs 25 checks against X-shaped pages and intercepted responses. It covers direct posts, original and reposting authors, rendered quotes, linkless and nested quote headers, ordinary mentions, row recycling, delayed responses, navigation, pause/resume, placeholders, popup reporting, fresh CSRF, age-only filtering, automatic age expiry, and old cache entries. This suite accelerates queue waits; the unit suite checks production pacing separately.

`npm run test:popup` checks saved settings, local fonts, narrow widths, long labels, keyboard actions, focus after removal, duplicate entries, pause/reopen, cache clearing, missing data, load/save/status failures, and the absence of HTTP requests from popup interaction. It also runs axe against expanded and collapsed controls. Automated accessibility checks do not replace screen-reader testing.

`npm run test:performance` generates a temporary certificate and a local HTTPS server to check passive header observation and credential storage. It renders 12,000 synthetic posts while keeping 40 rows mounted, checks region and age matches, and checks that repeated recycling does not accumulate event listeners or make requests for cached authors. Frame intervals and long tasks are measurements on the runner, not guarantees about X's full application.

`npm run check` verifies entry points, local assets, versions, syntax, permissions, and common accidental credential/path leaks. `npm run build` verifies each ZIP entry against the original file.

## Live evidence

Earlier development verified a region-based placeholder in a signed-in Brave feed using existing cached data and no additional About lookup. The age rule has automated browser coverage, but a positive age match has not been verified against a young account in the live feed. Quote and repost coverage is automated rather than a claim about every live layout.

The UI reorganization preserves the core matching, content script, placeholder CSS, and request-limit implementation. Browser checks use separate profiles and do not navigate the user's active window.

## Reproducing a failure

Start with `npm ci` and install Playwright's Chromium. Run the failing suite on its own. Reports and screenshots are written under `test-results`, which is ignored by Git. Do not use a signed-in browser to obtain deterministic test data, and do not reset an X cooldown to accelerate a check.
