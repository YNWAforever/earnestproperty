# Synthetic YouTube browser evidence

Run from the repository root with the existing installed dependencies:

```powershell
node node_modules/@playwright/test/cli.js test --config playwright.youtube-owned.config.ts
```

The dedicated config owns only `e2e/youtube-videos.spec.ts`. It refuses
`PLAYWRIGHT_BASE_URL`, starts its HTTP server on `127.0.0.1` with an ephemeral
port, blocks service workers, and runs desktop and 390px viewport projects.
It uses the installed Chromium browser; it never installs dependencies or
downloads a browser.

The Vite build imports the real `src/routes/videos.tsx`, runs its
`Route.options.loader`, and renders its `Route.options.component`. Only the
router runtime, queries, status read, analytics, and environment-dependent
site contact config are synthetic. The build disables env-file loading and
the public directory and rejects real server, auth, or database client
imports. The real cards, Radix sorting control, filters, image facade,
video helpers, and styling remain in use.

The JSON response contains 16 deliberately shuffled synthetic CMS videos.
Their upload and import dates disagree; the newest row represents a Short
already stored under its canonical watch URL. A manual row has no upload
date. The next-response scenario adds a seventeenth row when the browser
reloads. Both the server response and fixture fetch use `no-store`.

The network fence aborts every browser request outside the owned server
origin, including YouTube thumbnails and player frames. Browser fetches are
limited to the fixture JSON GET; unexpected fetch, XHR, beacon, socket, and
request mutations fail the test, even when application code catches their
errors or reloads. The HTTP server also rejects and records mutations.
The player test waits for its external frame request to fail.
The fence was also verified with an intentional caught POST attempt; its
expected failure is retained in `.audit/youtube-videos-red-mutation.log`
and `.audit/youtube-videos-red-mutation/`. Temporarily removing the query
alias made the build reject a real server dependency; that expected
failure is retained in `.audit/youtube-videos-red-real-client.log`.

The parent `YouTubeSyncStatusView` is exercised in browser rendering and
`renderToStaticMarkup` SSR for failed, partial, interrupted, and never-run
states. The real panel is tested through a rejected synthetic status read
and an explicit successful reread. Unknown counts stay unknown, unknown
codes do not disclose the synthetic secret marker, and failed/partial
attempts retain the preceding successful date.

Artifacts go to `.audit/youtube-videos-browser` and
`.audit/youtube-videos-playwright`. Intentional sorting-mutation RED evidence
is retained separately in `.audit/youtube-videos-red-sort.log` and
`.audit/youtube-videos-red-sort/`. That mutation was applied only by a
temporary fixture build transform; the product route was not edited.

These results establish synthetic component behavior only. The tiny router
does not establish TanStack route-tree integration, real query/HTTP cache
behavior, authenticated authorization, CMS/DB writes, daily scheduler
execution, actual channel normalization, YouTube access, deployment, or
production acceptance. The reload case verifies fresh loader input reaches
the real route after reload; the actual queries module is intentionally
excluded. The SSR cases verify the pure status view; the public videos
route is rendered in the browser, not through the full application SSR
pipeline.
