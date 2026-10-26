# Contributing

Use Node.js 22 or later and the setup commands in the README. The `extension` directory is directly loadable, so UI edits need no build step. Reload the extension and your test X tab after changing content scripts or the worker.

Keep changes small enough to review. A popup change should not alter the request queue or matching rules. If you change a rule, add a case that shows the wrong result before the fix. If you change the request path, run both the controlled-clock suite and the local HTTPS transport check.

Run `npm test`, `npm run test:performance`, and `npm run build` before submitting a change. For UI work, inspect the popup at 420, 390, and 360 pixels wide, including paused, empty, loading, cooldown, and error states. Keep keyboard focus visible and check expanded details. The shipped extension must work offline except for its existing X account lookups.

Use synthetic accounts in tests and screenshots. Never commit a browser profile, session headers, cookies, a real network export, or local verification records from someone's feed. Do not add a permission, a lookup type, or an earlier cache refresh without explaining why it is needed and how it affects X's shared allowance.

Report bugs and propose changes through GitHub issues and pull requests. For a release, update both package and manifest versions, add a changelog entry, run the checks, and inspect the packaged extension before uploading it.
