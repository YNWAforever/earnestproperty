# Public performance evidence — 2026-09-27

## Scope and measurement status

The audit latency observations are a starting point, not a comparable before/after baseline. The Neon staging branch and aws-ap-southeast-1 region are verified, and a branch-scoped Preview redeploy plus an empty synthetic acceptance database now exist. The deployed runtime DB host is redacted on Vercel readback; application DB binding has not been independently attested. A five-request Preview detail HTTP spot sample is below, but no authenticated desktop/mobile browser, Hong Kong test point, separate cold/warm set for all routes, DB p95, LCP, INP, CLS or request waterfall has been obtained. The 30% TTFB and 300 ms DB targets remain open. No cache, index, region move or public/private response sharing was introduced without the required trace and EXPLAIN evidence.

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

T06's 50-row chunk commit uses a set-based preview/read and one database transaction. PGlite and a separate real Neon synthetic fixture proved 50+10, same-result retry, and two-connection placement serialization. One 50-row Neon chunk took 256 ms in that test, including its HTTP round trip; this is one sample, not p95 or an `EXPLAIN` plan. T04 combines staff readiness evidence into one read rather than separate per-staff checks. The staff/private routes were not added to any public cache.

## Isolated staging database query plan sample

On Neon staging branch `br-young-breeze-ao85rtx1` in `aws-ap-southeast-1`, read-only `EXPLAIN ANALYZE` used the current `searchListings` canonical CTE for the unfiltered listing count and first 24-row page with newest ordering and the listing-card projection. The branch contains an inherited parent-data snapshot; this is a query-plan observation on that snapshot, not a synthetic test fixture or browser acceptance. No application endpoint or provider was called.

| Query | First run in this sequence (ms) | Five subsequent server execution times (ms) | Warm median (ms) | Rows |
| --- | ---: | --- | ---: | ---: |
| Canonical count | 6.139 | 4.032, 4.188, 4.087, 4.080, 4.292 | 4.087 | 1 aggregate |
| Page, newest, 24 rows | 39.244 | 8.160, 7.697, 7.948, 7.737, 7.697 | 7.737 | 24 |

These are PostgreSQL server execution times, excluding Vercel runtime, network, authentication, rendering and browser transfer. The count had been queried once before this sequence, so its first run is not a clean cold sample. The page first run also had 56.496 ms planning time and 19 shared read blocks; its subsequent runs had zero shared read blocks. This evidence does not establish the DB p95 or the 30% page TTFB target.

## Redirect capacity

The old single 300/minute row is replaced by 32 fixed global shards (default 5,000/minute each) and a bucket per **registered enabled link** (default 600/minute). The limits are bounded configuration values displayed in operations health. Invalid codes cannot create unbounded per-code buckets. HEAD/prefetch does not touch the buckets or mint a reference. A registered hot link beyond its per-link limit returns a contextual company WhatsApp redirect marked `X-WA-Tracking: untracked`, without an open/reference write. Global overload returns 429 with `Retry-After: 60`. Existing bucket cleanup remains in place.

Synthetic unit cases cover 301 normal opens, 601 same-link opens, 5,001 same-shard opens, at most 32 global bucket keys over 1,000 codes, malformed configuration, prefetch, and contextual fallback. These are **not** a staging load test and do not establish real throughput, bucket contention, DB p95, or simultaneous-campaign fairness. Staging should run a normal campaign over 300/minute plus one hot link and multiple campaigns under two bounded configurations, record request and DB timing, and select the operational limits from those results. Run only against a verified isolated staging database.

## Pending measurement protocol

From a Hong Kong test point, capture at least five warm samples and separate cold samples on desktop and mobile for homepage, listing after redirects, detail, and staff links/settings. Record deployment and DB regions, TTFB, DB/SSR timings, request count and transferred bytes per route. On the isolated Neon branch run `EXPLAIN (ANALYZE, BUFFERS)` for canonical offering, count and page queries before index work. Compare same-condition warm median TTFB to audit baseline; target at least 30% reduction or below 1 second, and core DB p95 at most 300 ms. LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 are later field p75 targets, not conclusions from five synthetic runs.

## Protected staging Preview detail HTTP sample

After one separate A074714 detail request returned 200 with a 4.398 s TTFB, five sequential requests to the READY branch-scoped Preview deployment dpl_69QvF5Wx7RTCR8KJs1cnGCecJvWH were measured with Vercel CLI curl using its authenticated deployment-protection path. Each followed redirects and returned 200. The five time_starttransfer values in seconds were 3.408, 3.470, 3.540, 3.266 and 3.344 (median 3.408); corresponding total times were 3.737, 3.807, 3.855, 3.611 and 3.683 (median 3.737). These values are curl network timings from this workstation for this protected Preview, not browser paint or production TTFB. Geographic egress, cache state, SSR/DB split and runtime DB host were not independently verified. They cannot be compared directly to the anonymous public deployment samples above or used to close F23/F24.

## Remote property photo follow-up (read-only, 2026-09-27)

A fresh anonymous GET of the public A074714 HTML showed the same Blob WebP URL in both the 1200 × 900 primary image and a 200 × 150 thumbnail tag, with no `srcSet`. A direct GET downloaded 274,212 bytes for that URL; `sharp` read intrinsic dimensions of 1200 × 900. Four other distinct Blob WebP URLs returned 62,680, 91,696, 54,278 and 37,586 bytes. The five direct asset GETs total 520,452 bytes, but that is **not** a browser page-transfer measurement: lazy loading, cache reuse and viewport visibility were not observed. A read-only request to `/_vercel/image` for a 256 px variant returned 404 on the public deployment, so that optimization path cannot be assumed available.

Commit `2ae5049` starts the read-only public WhatsApp link resolver alongside the detail page's similar listings, estate transactions and branch reads after the primary property resolves. This removes a serial await in source order while preserving the fallback and offering selection. `typecheck`, targeted ESLint, `test:property-experience` and `test:whatsapp-enquiries` passed locally. The Preview has tracked-link dispatch off and no same-condition before/after trace, so no latency saving is claimed. F23 and F24 remain open.

## Public mobile browser photo sample (read-only, 2026-09-27)

A Playwright Chromium visit to the **public production** A074714 detail page used a 390 px viewport at DPR 2, blocked all non-GET/HEAD/OPTIONS requests, scrolled the thumbnail strip into view and collected image bodies for three seconds after DOMContentLoaded. Navigation returned 200. Eight Vercel Blob image responses totalled 705,858 body bytes in this one run. The first 274,212-byte image had intrinsic width 1,200 px, rendered at 356 px as the hero and at 76 px as the first thumbnail; both tags used the same URL and had no `srcSet`. The browser fetched it once in this run. Request interception can change cache behavior; the sample is not an all-page transfer audit, field p75, a staging Preview waterfall or a cold/warm comparison.

An offline `sharp` experiment on that same source produced 5,084 bytes at 160 px and 11,750 bytes at 256 px (WebP quality 78). These are candidate variant sizes, **not** deployed or measured savings. The public `/_vercel/image` 256 px request returned 404, so a supported transformation/storage path must be selected before remote thumbnails can use variants. F24 remains blocked on implementing that path and verifying its staging browser transfer.
