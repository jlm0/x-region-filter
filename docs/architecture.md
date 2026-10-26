# How the extension works

The extension has three execution contexts. Shared scripts expose the `XRF` helpers in each context without a bundler or a runtime framework.

The service worker owns the queue, local cache, request budget, and session headers. Content scripts run in an isolated world inside X and own feed observation, account requests, and placeholders. The popup reads status from the worker and writes settings to local extension storage.

## From a post to a placeholder

The content script runs on `x.com` but filters only `/home` and `/i/lists/<id>`. A MutationObserver tracks mounted tweet articles; an IntersectionObserver prioritizes authors near the viewport with a 600-pixel margin. Work is batched with a four-millisecond frame budget.

Author extraction uses rendered headers and repost context. It includes visible quoted author headers, including linkless quotes, and excludes ordinary mentions. Each article has an identity so a late result cannot hide a different post after X recycles the row.

A fresh cached result is checked first. If metadata is missing, the worker queues a shared lookup. Region and age are an OR condition; a region match takes precedence in the placeholder wording. Missing data leaves the post visible.

A match adds attributes to the article. CSS hides its children and leaves a 28-pixel placeholder. The article becomes inert and hidden from the accessibility tree, and its videos pause. X retains ownership of its DOM and scroll containers. Disabling the rule, leaving a supported route, or reusing the row restores it. An age anniversary schedules reevaluation without another network request.

## The request path

The worker passively observes X's Authorization header through `webRequest` and saves only that value in session storage. It learns an About query identifier from successful native About requests, with a bundled identifier as the initial fallback.

The worker sends one authorized lookup job to an X content script. The content script reads the current CSRF cookie and requests X's `AboutAccountQuery` with the account handle. It verifies the returned identity and extracts the account region and creation date. The request has an eight-second timeout. No request is replayed solely to obtain age data.

The worker accepts lookup messages only from top-level X tabs and status/cache messages only from this extension's pages. Account handles are validated before queueing. Credentials are not sent to the popup or stored in the persistent account cache.

## Limits and failure handling

| Resource | Bound |
| --- | --- |
| Concurrent account lookups | 1 across tabs |
| Gap after a lookup finishes | At least 30 seconds |
| Starts per rolling 15 minutes | 20 |
| Pending queue | 60 jobs |
| Queued job lifetime | 60 seconds |
| Persistent account cache | 2,000 accounts |
| Account cache within one tab | 1,000 accounts |
| Usable region or creation date | 6-hour cache lifetime |
| Neither field available | 5-minute cache lifetime |

X's reported quota is an additional limit. The extension keeps at least ten requests or 20% of the reported limit in reserve, bounded below the total. Native About-page visits update the same tracker. Late responses cannot increase the remaining allowance within a window. Guard and quota state persist across worker restarts.

Authentication failures, changed response formats, and rate-limit errors pause lookups. An in-flight success cannot clear a concurrent native rate-limit warning. Cache hits remain available before request capacity is checked. Disabling the final rule cancels the lookup without recording a false failure cooldown.

## Changing the UI

The popup uses native controls and locally bundled assets. It queues settings writes in order, reports save failures, and ignores stale status responses. Opening the popup, refreshing status, and editing filters do not themselves look up accounts. Applying new filters to a live feed can queue missing account metadata through the existing content-script path.

Keep feed and request code separate from presentation changes. The current tests can run without an X account or browser profile.
