# Public performance evidence — 2026-09-27

## Scope and measurement status

The audit's latency observations are a starting point, not a comparable before/after baseline. This worktree has no reachable staging URL, Hong Kong test point, deployment/Neon region confirmation, or verified isolated Neon database credentials. Consequently there are **no** five-sample warm/cold TTFB, DB p95, LCP, INP, CLS, or request-waterfall measurements for homepage, listings, detail, staff links, and settings. The 30% TTFB and 300 ms DB targets remain open. No cache, index, region move, or public/private response sharing was introduced without the required trace and EXPLAIN evidence.

## Public deployment spot check (read-only, 2026-09-27)

From this Windows workstation, `curl.exe --location --output NUL --write-out` made five sequential anonymous GET requests per path to `https://earnestproperty.vercel.app`. These are current public-deployment observations, **not** isolated staging measurements or a same-condition before/after comparison. The workstation's geographic egress, deployment SHA, cache state, client device class, server/database regions and SSR/DB breakdown were not verified. An initial separate homepage request gave 3.277 s TTFB; it is excluded from the five-sample sets below.

| Path | Five TTFB samples (s) | Median (s) | HTML bytes per response |
| --- | --- | ---: | ---: |
| `/` | 1.979, 1.671, 1.131, 1.456, 1.210 | 1.456 | 341,196 |
| `/listings` | 1.090, 1.047, 1.066, 0.995, 1.024 | 1.047 | 118,431 |
| `/property/A074714` | 3.651, 2.608, 2.334, 2.166, 2.101 | 2.334 | 75,546 |

An anonymous HEAD request to `/` returned `X-Vercel-Cache: MISS` and `X-Vercel-Id: sin1::iad1::...`; that header alone does not establish the database region or a comparable Hong Kong test point. The public A074714 HTML listed Blob WebP photo URLs without `srcSet` or `sizes`. HEAD on its four distinct Blob photos returned `Content-Length` 274,212, 62,680, 91,696 and 54,278 bytes. The first URL is reused for the primary image and a thumbnail. These are source response lengths, not measured browser transfer; the PR still needs remote responsive variants and staging waterfall evidence before F24 can be marked fixed.

## Reproducible local measurements

`node scripts/media/generate-responsive.mjs` used the checked-in sources and WebP quality 78 without upscaling. `docs/audits/astra-task-8-image-metrics.json` records exact per-file bytes and dimensions. Across the 20 inventoried static images, source files total 7,124,290 bytes. The sum of selected 128 px variants is 77,598 bytes; 256 px is 284,828 bytes; 320 px is 428,524 bytes; the 960 px selection proxy is 2,772,130 bytes (using another available size where 960 px is absent). These sums are a file inventory, **not** transfer bytes for a page or a measured browser saving. The 星堤 static source is 356,834 bytes; its 128/256/320 px variants are 2,694/9,690/14,264 bytes respectively.

`AppImage` already resolves local sources against the generated manifest. The detail gallery now asks for an 80 px thumbnail with `sizes="80px"`, and its primary image declares a responsive display size. The new 128/256 px variants allow the browser to select for a roughly 76–80 px thumbnail at DPR 1 or 2. The primary image retains eager/priority loading and gallery thumbnails are lazy with intrinsic dimensions. Remote listing photo URLs are outside this local manifest. Their actual transferred size, including the audit's 1200 px A074714 thumbnail, remains unverified and may still be oversized. A source-host inventory and supported image transformation path are needed before calling F24 fully fixed.

T06's 50-row chunk commit uses a set-based preview/read and one database transaction. Synthetic PostgreSQL fixtures prove the 50+10 sequence and unchanged retry result, but no real Neon round-trip timing or `EXPLAIN` was available. T04 combines staff readiness evidence into one read rather than separate per-staff checks. The staff/private routes were not added to any public cache.

## Redirect capacity

The old single 300/minute row is replaced by 32 fixed global shards (default 5,000/minute each) and a bucket per **registered enabled link** (default 600/minute). The limits are bounded configuration values displayed in operations health. Invalid codes cannot create unbounded per-code buckets. HEAD/prefetch does not touch the buckets or mint a reference. A registered hot link beyond its per-link limit returns a contextual company WhatsApp redirect marked `X-WA-Tracking: untracked`, without an open/reference write. Global overload returns 429 with `Retry-After: 60`. Existing bucket cleanup remains in place.

Synthetic unit cases cover 301 normal opens, 601 same-link opens, 5,001 same-shard opens, at most 32 global bucket keys over 1,000 codes, malformed configuration, prefetch, and contextual fallback. These are **not** a staging load test and do not establish real throughput, bucket contention, DB p95, or simultaneous-campaign fairness. Staging should run a normal campaign over 300/minute plus one hot link and multiple campaigns under two bounded configurations, record request and DB timing, and select the operational limits from those results. Run only against a verified isolated staging database.

## Pending measurement protocol

From a Hong Kong test point, capture at least five warm samples and separate cold samples on desktop and mobile for homepage, listing after redirects, detail, and staff links/settings. Record deployment and DB regions, TTFB, DB/SSR timings, request count and transferred bytes per route. On the isolated Neon branch run `EXPLAIN (ANALYZE, BUFFERS)` for canonical offering, count and page queries before index work. Compare same-condition warm median TTFB to audit baseline; target at least 30% reduction or below 1 second, and core DB p95 at most 300 ms. LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 are later field p75 targets, not conclusions from five synthetic runs.
