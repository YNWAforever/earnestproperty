# FX-14: Security headers and public-form abuse protection. Implementation plan

**Owner decisions (2026-10-08):** every default under "Open questions" is accepted. A honeypot-flagged lead still raises the staff alert, tagged 「（疑似機械人）」, and the Task 5 **[owner copy]** is approved as written. Fixed by the brief:
1. **Never drop a lead.** A honeypot-flagged submission is saved, gets the same on-page success message, and still raises the FX-05b staff WhatsApp alert.
2. **No migration.** No new env var. No setting is removed, because none is made redundant (fact 22).
3. **Cut from `main` (1216ab8d). Never stack on #239 (FX-13).** This batch's `vercel.ts` hunk is one import line, one type field and one `headers:` line, so either merge order rebases trivially (fact 3).
4. **Copy.** zh-HK. The only new text is staff-facing or invisible, listed in Task 5 as **[owner copy]**.
5. **Production is read-only** for whoever runs this plan: `curl -sI`/GET only, no POST, no Neon, no deploy. `wrangler deploy` is an owner action.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY` and an **enforced** `Content-Security-Policy: frame-ancestors 'none'`, so no page (admin included) can be framed for clickjacking (B-02 / F-23).
- A full **report-only** CSP ships alongside. It lists every third-party origin the site really loads, so it reports real problems and not noise. Enforcing it is a later, separate PR.
- Every machine endpoint that checks a bearer secret uses one timing-safe helper. Status codes and bodies do not change (B-07 / H-19).
- The staff session reader trusts only the bearer token the admin client attaches. It never forwards visitors' cookies (GA and others) to Neon Auth (B-08).
- Rate limits bucket an IPv6 client by its /64, so rotating addresses inside one allocation shares one bucket. IPv4 is unchanged (B-05, first half).
- Contact, property-enquiry, valuation and listing-alert forms carry an invisible honeypot field. A filled field **flags** the submission. It never blocks, drops or delays it (B-05, second half).

Findings: B-02 (= F-23), B-05 (IPv6 and bot-check parts), B-07 (= H-19), B-08. Out of scope from B-05/E-12: the daily AI spend cap and `LIVE_AGENT_ENABLED`, which are moot after FX-11b (the public chatbot makes no model call).

**Approach.**
- **Task 1 (headers).** A plain module `scripts/vercel-headers.mjs` exports `SECURITY_HEADERS`, using the same pattern as `scripts/site-origin.mjs`, which `vercel.ts` already imports. `vercel.ts` gains `headers: SECURITY_HEADERS`. There are two rules: everything gets the security headers, and everything **except `/w/*`** gets `Referrer-Policy`, because tracked links set their own stricter `no-referrer` (fact 6).
- **Task 2 (bearer).** `src/lib/http/bearer-secret.ts` compares SHA-256 digests of the presented header and `Bearer <secret>` with `crypto.timingSafeEqual`. The digests are always 32 bytes, so the length check never branches on the secret. It is used by the 5 routes that compare with `!==` and replaces the private helper in `api.mls-sync.ts`. The Cloudflare worker gets a 10-line twin using `crypto.subtle.timingSafeEqual`, because it has no `nodejs_compat`.
- **Task 3 (B-08).** Delete the cookie branch in `createNeonSessionReader`. Also stop `staff-identity-provider.server.ts` forwarding the cookie: its only live call is the public `request-password-reset` (fact 18).
- **Task 4 (IPv6).** Move `clientIpFromRequest` into a pure `src/lib/client-ip.ts`. It returns IPv4 unchanged, and for IPv6 returns the /64 prefix. `ratelimit.server.ts` re-exports it, so the 6 callers are untouched.
- **Task 5 (honeypot).** One `HoneypotField` component and one schema field `website: z.unknown().optional()`, which cannot fail validation. The server turns it into `suspectedBot: boolean`. CRM leads get a system `crm_activities` row of type `suspected_bot`, and the staff alert's source label gains 「（疑似機械人）」. Valuation and listing-alert rows, which are not CRM leads until FX-02, get an `audit_logs` row. **No migration** (fact 15).

**Tech stack.** `node --test` (Node 24 imports `.ts` directly), `bun test`, the owned-Postgres lead-alert suite, and the existing public-forms Playwright fixture. No new `test:*` script and no `ci.yml` edit (fact 25).

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: B-02 (`:165`), B-05 (`:168`), B-07 (`:169`), B-08 (`:170`), L-07 (`:153`), E-12 (`:259`), executive summary (`:79`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-14 (`:626-646`), Global constraints (`:17-39`), D9 (`:79`), FX-18c migration table (`:731-736`).

## Verified current behaviour (main `1216ab8d`, 2026-10-08)

| # | Fact | Where |
|---|---|---|
| 1 | **Production sends no security headers.** `curl -sI https://www.earnestproperty.com/` and `/admin` (2026-10-08 15:26 UTC) return only `Cache-Control: public, max-age=0, must-revalidate`, `Content-Type`, `Server: Vercel`, `Strict-Transport-Security: max-age=63072000`, `X-Vercel-Cache` and `X-Vercel-Id: sin1::iad1::…`. There is no CSP, XFO, nosniff, Referrer-Policy or Permissions-Policy. `earnestproperty.vercel.app` sends Vercel's own `max-age=63072000; includeSubDomains; preload`. www has no `includeSubDomains`, and D9 keeps it that way. | live `curl -sI` |
| 2 | **`vercel.ts` has no `headers`.** `VercelConfig` is `{ buildCommand; crons; redirects }` (`:19-23`). The `config` object is `:45-107`. `@vercel/config` 0.5.3 (main checkout `node_modules`, not a dependency) defines `HeaderRule { source; headers: {key,value}[]; has?; missing? }` and `headers?: HeaderRule[]` (`types.d.ts:243-246,317-334,395`). `vercel.ts` rules are applied in production today: `/profile.php` → 308 `/about` (live). | `vercel.ts`; `node_modules/@vercel/config/dist/types.d.ts` |
| 3 | **#239 (FX-13) rewrites `vercel.ts:26-55` and `:84-105`** and adds `scripts/vercel-config.test.mjs` to `test:seo`. It does not touch the imports (`:1-3`), the type block (`:5-23`) or `:45-48`. Its `package.json` hunks touch `test:seo` (`:25`), `test:listing-search` (`:32`), `test:estate-conversion` (`:37`) and `test:property-experience` (`:46`). #238 (FX-12) inserts scripts after `:118` and edits `website-inquiry.js:76-83`, `admin.leads.tsx` (not `formatActivityType`) and `admin-data.server.ts` (not `:4557-4680`). #240 (FX-11a) edits `test:crm-analysis` (`:49`) and `admin-data.server.ts` elsewhere. | `git diff origin/main...origin/<branch>` |
| 4 | **Third-party origins actually loaded.** Live HTML of `/`, `/listings`, `/contact`, `/videos`, `/estate/bellagio`, `/blog` and `/property/C007232` references `i.ytimg.com`, `imgs.property.hk`, `sehe3hq90qgbyxqa.public.blob.vercel-storage.com`, `www.youtube.com`, `www.google.com` (maps embed) and outbound links (`wa.me`, `eaa.org.hk`, `fimmick.com`). Code adds: GA4 `https://www.googletagmanager.com/gtag/js` (`AnalyticsProvider.tsx:52`, only when a measurement id is set); YouTube embeds `https://www.youtube.com/embed/*` (`youtube-video-url.js:43`, `property.$listingNo.tsx:278`, `videos.tsx:573`); Google Maps `?output=embed` iframes (`contact.tsx:33,137`, `property.$listingNo.tsx:504-506,774`); VR iframes `my.matterport.com` and `kuula.co` (`property-public.ts:73-85`); listing and floorplan images from arbitrary synced hosts (`floorplan_url`, 28hse, property.hk, Blob); Neon Auth `https://ep-divine-frost-aokzrg7f.neonauth.c-2.ap-southeast-1.aws.neon.tech` (read from the live admin bundle; `src/auth.ts:51`). Fonts are self-hosted via `@fontsource` (`__root.tsx:18-30`). There is no Google Fonts, no other analytics and no WebSocket. Previews also inject the Vercel toolbar (`vercel.live`). | as listed |
| 5 | **Inline scripts.** The home page HTML has 3 `<script data-tsr-stream-part>`, 2 plain inline `<script>` (TanStack Start hydration) and 2 `application/ld+json`. A CSP without `'unsafe-inline'` (or nonces) would block hydration, which is why the full policy starts report-only. | live HTML |
| 6 | **`/w/*` sets its own `Referrer-Policy: no-referrer`** (with `no-store`, `X-Robots-Tag`) from the function (`whatsapp-enquiries.server.ts:81-86`; live `curl -sI …/w/doesnotexist` → 204 with those headers). A config-level `strict-origin-when-cross-origin` on `/w/*` would weaken it or duplicate it. | as listed |
| 7 | **Nothing frames the site.** No iframe in `src/components` or `src/routes` points at our own origin. The admin estate preview links out to Google Maps (`EstatePreviewCard.tsx:27`); it is not an iframe of our pages. There is no `frame-ancestors`/XFO anywhere today. The Vercel toolbar is injected script, not a frame of the page, so `frame-ancestors 'none'` does not affect it. | `grep -rn "<iframe" src` |
| 8 | **Bearer-secret comparisons (B-07 "6 places").** With `!==`: `api.admin.control-plane.worker.ts:9-13` (401 `{ok:false,error:"UNAUTHORIZED"}`), `api.admin.jobs.send-queue.ts:12-16` (401 `{ok:false,error:"Unauthorized"}`), `api.admin.whatsapp.service-worker.ts:9-11` (401 `{error:"UNAUTHORIZED"}`), `youtube-http.server.ts:120-123` (401 `{ok:false,error:"Unauthorized"}`), `workers/cron/src/index.ts:49-51` (401 `{error:"UNAUTHORIZED"}`). Already timing-safe but private: `api.mls-sync.ts:5-11` (`hasValidAuthorization`, 503 when unconfigured, then 401). The 7th, `propertyhk-http.mjs:53-57`, is already timing-safe and is left alone. All but mls-sync treat a missing secret as 401. | as listed |
| 9 | **Tests pin today's comparison text.** `control-plane.routes.test.mjs:72-73` asserts `request.headers.get("authorization")` and ``actual !== `Bearer ${expected}` `` in the worker route. `job-wake.test.mjs:82` asserts `/authorization.*Bearer/` in `workers/cron/src/index.ts`. `api.mls-sync.test.mjs:11` asserts `/authorization/i`. `control-plane.routes.test.mjs:248-290` requires `CRON_SECRET` to be read in the route or its local imports. These must be rewritten, not deleted. | as listed |
| 10 | **The Cloudflare worker has no `nodejs_compat`** (`wrangler.jsonc:1-25`: only `compatibility_date`), so it cannot import `node:crypto`. Workers expose `crypto.subtle.timingSafeEqual`. `test:job-wake` runs `workers/cron/src/job-alarm.test.mjs` under Node. | `workers/cron/wrangler.jsonc` |
| 11 | **The B-08 cookie branch cannot authenticate staff.** `createNeonSessionReader` forwards the whole `cookie` header to `${NEON_AUTH_BASE_URL}/get-session` whenever one is present (`auth.server.ts:132-163`), then falls back to the bearer token. The Neon Auth session cookie lives on `*.neonauth…neon.tech` (fact 4; audit L-07), a different site, so the browser never sends it to `www.earnestproperty.com`. The branch only ever forwards first-party cookies (GA and others) to Neon Auth, then returns `null`. | as listed |
| 12 | **The admin client always sends the bearer.** `withStaffAuthHeaders` sets `authorization: Bearer <opaque session token>` (`src/auth.ts:86-101`). `callStaffServerFn` wraps every migrated staff server function with it (`staff-server-fn.ts:1,30`), and `staff-server-fn.contract.test.mjs:108-203` enforces the wrapper (no pending modules). `admin-data.ts` calls it directly (e.g. `:695`, `:96`). Raw `/api/admin/*` fetches attach it: woztell send/backfill/template (`admin-data.ts:1586-1701`), campaign queue (`:1864`), control-plane (`operations-client.ts:60-78`) and media upload (`media-upload.ts:37`, via `withStaffUploadIdentity`, `auth.ts:104-110`). Every `/api/admin/*` route authenticates via `requireStaffAccess`/`requireStaffPermission(request, …)` (17 routes) or `CRON_SECRET` (3 routes). CSV exports are built client-side from fetched data (`PerformanceTable.tsx:44`, `WhatsappBatchResult.tsx:52`, `WhatsappLinksTable.tsx:159`), so there is no cookie-only download URL. `/w/*` is public. There is no image or file proxy. | as listed |
| 13 | **The only SSR staff call** is the `loader: () => fetchAdminAgentEditorContext()` on `admin.agents_.$id.tsx:19` and `admin.agents_.new.tsx:12`. On the server, `withStaffAuthHeaders` has no token (`auth.ts:43`, `typeof window === "undefined"`), so the call relies on cookies. By fact 11 that already fails, and the wrapper returns `null` on an auth error (`admin-data.ts:93-101`). Removing the branch therefore changes nothing. A hard reload of those two pages likely already shows the no-access state, which is a pre-existing bug (GUESS, not reproduced; follow-up). | as listed |
| 14 | **Rate-limit IP.** `clientIpFromRequest` takes the first `x-forwarded-for` hop, else `x-real-ip`, else `"unknown"` (`ratelimit.server.ts:56-65`). Vercel overwrites `x-forwarded-for` with the client IP to prevent spoofing (Vercel docs, "Request headers"), which settles the audit's GUESS. The IP is used **only** inside rate-limit keys: `admin-data.ts:767-794,865-884,940-959` (website inquiry, listing alert, valuation; per IP and per IP+phone) and `api.live-agent.{handoff,message,session}.ts`. The bucket is `rate_limits.bucket` text, pruned after 1 day (`rate-limit-prune.ts`). `ratelimit.server.ts` imports `server-only` and `db.server`, so bun cannot unit-test it directly. `test:ratelimit` is `bun test src/lib/rate-limit-prune.test.ts`. | as listed |
| 15 | **Where a bot flag can live without a migration.** `crm_leads` has no metadata column (`20260623090000…:104-118`). `inquiry_quality_revisions` needs a staff `changed_by` (`20260927171000_inquiry_quality.sql`), so it cannot be used. `crm_activities.activity_type` is free `TEXT` with no CHECK (`…:120-130`), and system rows with `staff_user_id` NULL are an established pattern (`live-agent.server.ts:341-351`, the 「可能與現有 WhatsApp 對話相關」 note). The lead timeline shows them (`admin-data.server.ts:2540-2552`) and maps labels in `formatActivityType` (`admin.leads.tsx:1976-1984`, unknown types print raw). `audit_logs(actor_id NULL ok, action, subject_type, subject_id, metadata jsonb)` accepts any subject (`…:211-219`). `valuation_leads` and `listing_alerts` have only `source text` and `utm jsonb`, and no admin screen reads them (FX-02 not merged). | as listed |
| 16 | **Staleness is not disturbed by a system activity in the same statement.** `stale_new` takes `COALESCE(max(activity.created_at), l.created_at)` (`admin-data.server.ts:1035-1039`). A row inserted in the intake statement has the same `now()`. FX-03's handoff check looks only at activities with `staff_user_id IS NOT NULL` (`live-agent.server.ts:438`). | as listed |
| 17 | **Public forms.** All four are React `onSubmit` + `preventDefault`, with no `action`, posting through TanStack server functions: contact `ContactInquiryForm.tsx:47-105` → `createWebsiteInquiry`; property enquiry `PropertyInquiryForm.tsx:48-90` → `createWebsiteInquiry`; listing alert `ListingAlertForm.tsx:75-121` → `createListingAlert`; valuation `OwnerValuationPanel.tsx:73-107` → `createValuationLead`. Schemas `admin-data.ts:730-752`, `:828-850` and `:898-927` all end `.strip()`, so an unknown `website` key is silently dropped today. The live-agent phone panel is **not a form**: a `type="button"` that POSTs JSON to `/api/live-agent/handoff` with a `sessionId` + `accessToken` from `/api/live-agent/session` (`LiveAgentWidget.tsx:101,233-246`; `api.live-agent.handoff.ts:29-37`). | as listed |
| 18 | **A second cookie forwarder.** `staff-identity-provider.server.ts:40-52` copies the request `cookie` into every Neon Auth call. `staff-lifecycle.server.ts:990-1001` replaces every provider method with local ones except `requestPasswordReset`, whose endpoint is public. `staff-identity-provider.contract.test.mjs:84-91` pins the forwarded cookie. | as listed |
| 19 | **FX-05b alert.** Intake queues `lead.staff.alert` in the same statement (`website-inquiry.js:129-137`, `lead-alert-enqueue.js:17-27`). The handler reads `l.source,l.property_id,p.listing_no,c.name` (`lead-alert.server.ts:136`) and sends the template with `name`, `source: sourceLabel(lead)` and `link` (`:200-207`). `sourceLabel` gives 網站查詢 / 樓盤查詢 {no} (`:73-80`). | as listed |
| 20 | **Intake hash.** `persistWebsiteInquiry` hashes an explicit field list for replay (`website-inquiry.js:38-57`). A honeypot value must **not** join it, or a replay during deploy would look like a conflict. | as listed |
| 21 | **There is no customer acknowledgement** for these forms beyond the on-page success line (e.g. 「已收到查詢，我們會盡快聯絡你。」, `ContactInquiryForm.tsx:84`). "Normal acknowledgement" therefore means the identical success response. | as listed |
| 22 | **No setting becomes redundant.** There is no CSP, rate-limit or security env flag (`grep process.env` for RATE/CSP/SECUR/COOKIE: none). `NEON_AUTH_BASE_URL` stays: it gates the session reader (`auth.server.ts:66-67,133-134`) and the password-reset provider (`staff-identity-provider.server.ts:80`). | grep |
| 23 | **Stale doc comment.** `src/lib/schema.ts:26-28` says "admin auth is cookie-based with no CSP". After this batch both halves are wrong. | as listed |
| 24 | **Test wiring.** `src/test-wiring.test.mjs:39-52` requires every `src/**/*.test.*` to be in a `test:*` script, and `:87-125` requires every deterministic script to be in `ci.yml`. CI runs `test:control-plane` (`ci.yml:117`), `test:job-wake` (`:118`), `test:ratelimit` (`:119`), `test:team` (`:120`), `test:contact` (`:104`), `test:cron` (`:102`), `test:youtube-sync` (`:127`), `test:valuation` (`:136`), `test:listing-search` (`:98`), `test:property-experience` (`:121`), `test:public-forms:ui` (`:90`) and `test:lead-alert:owned:db` (`:173`). | as listed |
| 25 | **Script lines this batch may edit without touching an open PR's hunk:** `test:contact` (`:35`), `test:control-plane` (`:42`), `test:ratelimit` (`:101`), `test:job-wake` (`:102`). Existing test files in other scripts are edited in place, with no script change. | fact 3 |

## Global Constraints

- **Never lose an enquiry.** The honeypot cannot fail validation (`z.unknown().optional()`), never changes the response, and never skips the rate limiter, persistence, the alert or analytics. The lead, inquiry, contact and alert job are written exactly as today, in the same statement. Headers never apply a redirect or block a request; the only enforced CSP directive is `frame-ancestors`.
- **Never message the wrong person.** The alert's recipients, template and planning SQL are unchanged. Only the `source` text variable gains a suffix.
- **No behaviour change for machine callers.** Every bearer-protected route keeps its exact status codes, bodies and "not configured" order (fact 8). `/api/*` and `/w/*` responses get the new headers, which do not alter their status or body. `/w/*` keeps its own `no-referrer`.
- **No migration, no new env var, no `VITE_*`.** No `ci.yml` edit and no new `test:*` script. **Do not create `scripts/vercel-config.test.mjs`** (#239's file).
- **`vercel.ts` hunk is minimal:** one import after `:3`, one optional field in `VercelConfig` (`:19-23`) and `headers: SECURITY_HEADERS,` directly after `buildCommand` (`:46`). Nothing else in that file moves.
- **Do not touch `bun.lockb` or `package-lock.json`** (the worktree's `bun.lockb` shows a stray local modification: leave it unstaged).
- **D9:** do not set `Strict-Transport-Security`. Vercel's default stays.
- **Copy:** zh-HK. **[owner copy]** strings are in Task 5.
- **Every PR passes** `npm run lint`, `npm run typecheck`, `npm run build`, `test:control-plane`, `test:job-wake`, `test:ratelimit`, `test:team`, `test:contact`, `test:cron`, `test:youtube-sync`, `test:valuation`, `test:listing-search`, `test:property-experience`, `test:staff-notifications`, `test:public-forms:ui`, `test:lead-alert:owned:db`, and the admin browser suites in `playwright.admin-owned.config.ts`.

## Review Focus

1. **A security header breaks a real page or a machine caller.** This covers a framed page we did not know about, a `/w/` link losing `no-referrer`, a webhook or drain response changing, or an enforced directive other than `frame-ancestors` slipping in. *Tests (Task 1):* `only frame-ancestors is enforced; the full policy is report-only`; `tracked links keep their own no-referrer`; `every path including /api and /w gets nosniff and frame-ancestors`. *Preview curl matrix* rows 1-6.
2. **The report-only CSP is so noisy that nobody reads it,** or so loose it proves nothing. *Test (Task 1):* `report-only policy allows every third-party origin the site loads` (fact 4 list as fixtures) and `report-only policy keeps object-src none, base-uri self and form-action self`. *Preview console sweep* (Owner action 2).
3. **The timing-safe helper changes who is let in.** It could accept a wrong secret, accept anything when the secret is empty, or turn a 503 into a 401. *Tests (Task 2):* `hasBearerSecret refuses an empty or missing secret even when the header matches`; `hasBearerSecret accepts only the exact Bearer value`; `each cron route keeps its status codes` (one assertion per route, fact 8).
4. **Staff lose access when the cookie branch goes.** *Tests (Task 3):* `cookie-only request is unauthenticated and contacts Neon Auth zero times`; `a bearer request with cookies still authenticates and forwards no cookie`. *Preview:* sign in, open 客戶查詢, WhatsApp, 營運 and the team page, and upload one image.
5. **A real customer is treated as a bot,** or a bot-flagged lead is lost or not alerted. *Tests (Task 5):* `a flagged website inquiry still writes contact, lead, inquiry and alert job in one statement`; `an oversized or non-string honeypot never fails validation`; `a suspected-bot lead is still alerted, tagged 疑似機械人` (owned DB); `a keyboard user never reaches the honeypot and a real submission sends it empty` (Playwright).

## Out of scope / follow-ups

| Follow-up | Owner | Note |
|---|---|---|
| Enforce the full CSP (drop `-Report-Only`, add nonces or hashes for the TanStack inline scripts) | small PR after the preview and production console sweeps are clean | Fix plan: "a separate small PR". |
| CSP report collection endpoint | only if the owner wants it (Open question 2) | Adds a public POST route and storage. |
| `includeSubDomains` / preload | D9 = no | — |
| SSR loader on `/admin/agents/new` and `/admin/agents/$id` returns `null` on a hard reload (fact 13, GUESS) | FX-17 | Pre-existing. Not caused or changed by B-08. Fix by moving the editor context fetch to the client, as the rest of the admin does. |
| Daily AI cap / `LIVE_AGENT_ENABLED` (B-05, E-12) | dropped | FX-11b removed public model calls. |
| Flag leads from the live-agent handoff | none | Not a form, and it needs a session token (fact 17). |
| Carry the valuation and listing-alert bot flag into CRM when FX-02 backfills them | FX-02 | FX-02 reads `audit_logs` `public_form.suspected_bot` by subject id. |
| `propertyhk-http.mjs` onto the shared helper | FX-19 | Already timing-safe (fact 8). |
| CLAUDE.md "Neon Auth JWT" wording (B-14) | FX-19b | — |

---

### Task 1: Security headers on every response; the full CSP is report-only

**Files:**
- **Create `scripts/vercel-headers.mjs`** (plain JS, no imports, so `vercel.ts`, `node --test` and a future enforcing PR all read one source).
- **Create `scripts/vercel-headers.d.mts`** (types for `vercel.ts`), on the pattern of `scripts/site-origin.d.mts`.
- **Modify `vercel.ts`:**
  - after `:3`: `import { SECURITY_HEADERS } from "./scripts/vercel-headers.mjs";`
  - `:19-23`: add `headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;`
  - after `:46`: `headers: SECURITY_HEADERS,`
- **Create `scripts/vercel-headers.test.mjs`** and add it to `test:control-plane` (after `scripts/neon/check-migration-drift.test.mjs`).
- **Modify `src/lib/schema.ts:26-28`:** "admin auth is cookie-based with no CSP" → "staff auth is a bearer token held by the admin client; the site's CSP is report-only until FX-14's follow-up enforces it".

**Interfaces:**
```js
// scripts/vercel-headers.mjs
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",          // listing photos come from many synced hosts (fact 4)
  "font-src 'self' data:",
  "connect-src 'self' https://*.neon.tech https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://vercel.live wss://ws-us3.pusher.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.google.com https://my.matterport.com https://kuula.co https://vercel.live",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
export const CSP_ENFORCED = "frame-ancestors 'none'";
export const SECURITY_HEADERS = [
  { source: "/(.*)", headers: [
    { key: "Content-Security-Policy", value: CSP_ENFORCED },
    { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ]},
  // /w/* sets its own stricter Referrer-Policy: no-referrer (whatsapp-enquiries.server.ts:84).
  { source: "/((?!w/).*)", headers: [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ]},
];
```
Headers apply to `/api/*` too. They are harmless on JSON, and nosniff protects JSON from being sniffed as HTML (Open question 1).

**TDD steps:**
- [ ] **Step 1: failing tests** in `scripts/vercel-headers.test.mjs`. The `match(source, path)` helper uses `new RegExp("^" + source + "$")`, which is exact for these two sources (no named params). It does not depend on `path-to-regexp`, which only #239 adds.
  - `vercel.ts exposes SECURITY_HEADERS as config.headers`: child process `node --experimental-strip-types --input-type=module -e "import {config} from './vercel.ts'; console.log(JSON.stringify(config.headers))"` (the `scripts/site-origin.test.mjs:34-58` pattern) deep-equals `SECURITY_HEADERS`.
  - `every path including /api and /w gets nosniff and frame-ancestors`: for `/`, `/admin`, `/admin/leads`, `/api/woztell/webhook`, `/api/admin/control-plane/worker`, `/w/abc`, `/assets/index-x.js` and `/property/C007232`, the merged headers contain `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` and the Permissions-Policy value.
  - `only frame-ancestors is enforced; the full policy is report-only`: the `Content-Security-Policy` value is exactly `"frame-ancestors 'none'"`, and no other rule sets `Content-Security-Policy`.
  - `tracked links keep their own no-referrer`: `/w/abc` and `/w/ABC123` get no `Referrer-Policy` from config. `/`, `/wiki` and `/api/x` get `strict-origin-when-cross-origin`.
  - `report-only policy allows every third-party origin the site loads`: parse `CSP_REPORT_ONLY` into directives. A fixture table from fact 4 asserts that `frame-src` allows `https://www.youtube.com/embed/x`, `https://www.google.com/maps?…&output=embed`, `https://my.matterport.com/show/?m=x` and `https://kuula.co/post/x`; `script-src` allows `https://www.googletagmanager.com/gtag/js`; `connect-src` allows `https://ep-divine-frost-aokzrg7f.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth/get-session`; and `img-src` allows `https://i.ytimg.com/vi/x/hqdefault.jpg`, `https://imgs.property.hk/a.jpg` and `https://sehe3hq90qgbyxqa.public.blob.vercel-storage.com/a.jpg`. (A tiny host-source matcher in the test: scheme, `*.` prefix, exact host.)
  - `report-only policy keeps object-src none, base-uri self and form-action self`.
  - `no HSTS override (D9)`: no rule sets `Strict-Transport-Security`.
- [ ] **Step 2: red.** `node --test scripts/vercel-headers.test.mjs` fails: the module does not exist.
- [ ] **Step 3: implement** the module, the `vercel.ts` lines and the `schema.ts` comment.
- [ ] **Step 4: green.** `npm run test:control-plane && npm run test:seo && npm run test:job-wake` (the last two still read `vercel.ts`: `crons: []`, the host rule, the cron-block slice at `control-plane.routes.test.mjs:265-268`, which is unaffected because `headers:` sits before `crons:`).
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: commit.**
  ```
  fix(security): anti-framing and baseline security headers; full CSP in report-only

  B-02/F-23. Every response gets frame-ancestors 'none', X-Frame-Options DENY,
  nosniff, Permissions-Policy and (except /w/*) strict-origin-when-cross-origin.
  The full CSP lists every origin the site loads and only reports for now.
  ```

### Task 2: One timing-safe bearer check for every machine endpoint

**Files:**
- **Create `src/lib/http/bearer-secret.ts`.** It imports only `node:crypto`, so `node --test` can import it.
- **Create `src/lib/http/bearer-secret.test.mjs`** and add it to `test:control-plane`.
- **Modify** (only the comparison expression; every status code, body and earlier "not configured" branch stays):
  - `src/routes/api.admin.control-plane.worker.ts:9-13`: `if (!hasBearerSecret(request, process.env.CRON_SECRET)) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });`
  - `src/routes/api.admin.jobs.send-queue.ts:12-16` (401 `"Unauthorized"`).
  - `src/routes/api.admin.whatsapp.service-worker.ts:9-11` (401 `{ error: "UNAUTHORIZED" }`).
  - `src/lib/youtube-sync/youtube-http.server.ts:120-123`: `hasBearerSecret(request, dependencies.cronSecret())`.
  - `src/routes/api.mls-sync.ts:1,5-11,30`: delete `hasValidAuthorization` and the `timingSafeEqual` import. Keep the 503 when `!cronSecret || !databaseUrl` **before** the 401.
- **Create `workers/cron/src/bearer.js` + `bearer.d.ts`** and **`workers/cron/src/bearer.test.mjs`** (add to `test:job-wake`). **Modify `workers/cron/src/index.ts:49-51`** to `if (!(await hasBearerSecret(request, env.CRON_SECRET)))`.
- **Update source-scan tests** (fact 9):
  - `control-plane.routes.test.mjs:72-73`: assert `hasBearerSecret(request, process.env.CRON_SECRET)`, and `doesNotMatch(/!==\s*`Bearer/)`.
  - `job-wake.test.mjs:82`: assert `/hasBearerSecret\(request, env\.CRON_SECRET\)/`.
  - `api.mls-sync.test.mjs:11`: assert `/hasBearerSecret\(request, cronSecret\)/`.
  - Keep `:248-290` (CRON_SECRET read in the route chain) passing. Every route still reads `process.env.CRON_SECRET` itself.

**Interfaces:**
```ts
// src/lib/http/bearer-secret.ts
/**
 * True only when `Authorization` is exactly `Bearer <secret>`. An empty or missing
 * secret always refuses. SHA-256 both sides so timingSafeEqual sees equal-length
 * buffers and the comparison never branches on the secret's length.
 */
export function hasBearerSecret(request: Request, secret: string | null | undefined): boolean;

// workers/cron/src/bearer.js (no node:crypto: the worker has no nodejs_compat)
export async function hasBearerSecret(
  request, secret,
  equal = (a, b) => crypto.subtle.timingSafeEqual(a, b), // Workers runtime API
): Promise<boolean>; // SHA-256 via crypto.subtle.digest, same rules as above
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `bearer-secret.test.mjs`:
    - `hasBearerSecret accepts only the exact Bearer value`: `Bearer s3cret` → true. `Bearer  s3cret` (two spaces), `bearer s3cret`, `Bearer s3cre`, `Bearer s3cretX`, `s3cret` and a missing header → false.
    - `hasBearerSecret refuses an empty or missing secret even when the header matches`: secret `""`, `undefined` or `null` with header `Bearer ` or `Bearer undefined` → false.
    - `hasBearerSecret compares fixed-length digests`: a source scan of `bearer-secret.ts` matches `timingSafeEqual(` and `createHash("sha256")`, and has no `===`/`!==` against the header.
  - `workers/cron/src/bearer.test.mjs`: the same three cases, passing `equal = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b))` from `node:crypto`, plus `the worker default uses crypto.subtle.timingSafeEqual` (source scan).
  - `control-plane.routes.test.mjs`, new test `each cron route keeps its status codes`. Source scans of the four `src/routes` files plus `youtube-http.server.ts`: each calls `hasBearerSecret(`, keeps its exact 401 body literal from fact 8, and none contains ``!== `Bearer``. `api.mls-sync.ts` still has `status: 503` before the first `hasBearerSecret(`.
  - `youtube-http.test.ts` "cron rejects missing or invalid bearer authorization" (existing, bun) must stay green unchanged. It is the behaviour proof for the youtube route.
- [ ] **Step 2: red.** `node --test src/lib/http/bearer-secret.test.mjs workers/cron/src/bearer.test.mjs src/routes/control-plane.routes.test.mjs`.
- [ ] **Step 3: implement** the helpers and the six call sites; update the three pinned assertions.
- [ ] **Step 4: green.** `npm run test:control-plane && npm run test:job-wake && npm run test:cron && npm run test:youtube-sync && npm run test:property-sync`. Then `npx tsc --noEmit -p workers/cron` and `npm run typecheck`.
- [ ] **Step 5: commit.**
  ```
  fix(security): every CRON_SECRET check is timing-safe through one helper

  B-07/H-19. hasBearerSecret compares SHA-256 digests with timingSafeEqual and
  refuses an empty secret. Five !== comparisons and mls-sync's private helper move
  onto it; the Cloudflare worker uses crypto.subtle.timingSafeEqual. Status codes
  and bodies are unchanged.
  ```

### Task 3: Staff auth reads only the bearer token; no visitor cookie goes to Neon Auth (B-08)

**Files:**
- **Modify `src/lib/neon/auth.server.ts:96-101,132-164`.** Delete the cookie variable, the `fetch(…/get-session)` block and `asRecord` if unused. The function becomes: `if (!getAuthBaseUrl()) return null; const token = getBearerToken(request); return token ? getNeonSessionFromBearerToken(token) : null;`. Update the doc comment.
- **Modify `src/lib/neon/staff-identity-provider.server.ts:40-52`.** `forwardedHeaders` no longer copies `cookie`, and the comment says why (fact 18). Keep the diagnostic log at `:110-127` (it reports only shape and lengths).
- **Modify `src/lib/neon/auth.server.test.mjs`** (in `test:team`).
- **Modify `src/lib/neon/staff-identity-provider.contract.test.mjs:84-91`:** the expected headers lose `cookie`.

**Interfaces:** none new. `getNeonSessionFromRequest(request)` keeps its signature and `NeonSession` shape.

**TDD steps:**
- [ ] **Step 1: failing tests** in `auth.server.test.mjs`. Stub `globalThis.fetch` to count calls, and restore it in `finally`. Set `NEON_AUTH_BASE_URL=https://auth.invalid`.
  - `cookie-only request is unauthenticated` (fix-plan name, extended): a `Request` with `cookie: "_ga=GA1.1.x; neon-auth.session_token=abc"` and no `authorization` → `null`, `fetch` called **0** times, `queryRows` called 0 times.
  - `a bearer request with cookies still authenticates and forwards no cookie`: the same cookie plus `authorization: Bearer live-token` → `user.id === "auth-kevin"`, `fetch` called 0 times.
  - `the session reader never calls Neon Auth over HTTP`: `auth.server.ts` source has no `get-session` and no `headers.get("cookie")`.
  - Update `staff-identity-provider.contract.test.mjs` "provider adapter … forwards no credential": the expected headers are `{ accept, "content-type" }` only. Add `password reset sends no visitor cookie` (with `authorizedRequest`, the `/request-password-reset` request has no `cookie` header).
- [ ] **Step 2: red.** `node --test src/lib/neon/auth.server.test.mjs src/lib/neon/staff-identity-provider.contract.test.mjs`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:team && npm run test:neon-auth && npm run test:staff-server-fn && npm run test:command-center`.
- [ ] **Step 5: browser check (owned admin suites).** `playwright test --config playwright.admin-owned.config.ts` passes unchanged.
- [ ] **Step 6: commit.**
  ```
  fix(auth): staff sessions come only from the bearer token; no cookies sent to Neon Auth

  B-08. The cookie branch could never authenticate (the Neon Auth cookie lives on
  neon.tech) and only forwarded first-party cookies such as GA. The password-reset
  adapter stops forwarding cookies too.
  ```

### Task 4: IPv6 clients share one rate-limit bucket per /64

**Files:**
- **Create `src/lib/client-ip.ts`** (pure, no imports).
- **Modify `src/lib/ratelimit.server.ts:51-65`:** delete the body and `export { clientIpFromRequest } from "./client-ip";`. The 6 callers (fact 14) do not change.
- **Create `src/lib/client-ip.test.ts`** and add it to `test:ratelimit` (`bun test src/lib/rate-limit-prune.test.ts src/lib/client-ip.test.ts`). The fix plan names `rate-limit-prune.test.ts`; a separate file keeps the prune tests about pruning.

**Interfaces:**
```ts
// src/lib/client-ip.ts
/** Rate-limit identity: IPv4 unchanged; IPv6 -> "<first four hextets>::/64" (lowercase,
 *  zero-expanded, zone id and brackets dropped); IPv4-mapped IPv6 -> the IPv4;
 *  anything unparseable -> returned trimmed as today. */
export function rateLimitClientKey(ip: string): string;
/** Same header order as today (first x-forwarded-for hop, x-real-ip, "unknown"),
 *  then rateLimitClientKey. Used only in rate-limit keys (fact 14). */
export function clientIpFromRequest(request: Request): string;
```

**TDD steps:**
- [ ] **Step 1: failing tests** in `client-ip.test.ts`:
  - `two IPv6 in same /64 share bucket` (fix-plan name): `2001:db8:1:2::1` and `2001:0db8:0001:0002:ffff:ffff:ffff:ffff` → both `2001:db8:1:2::/64`.
  - `different /64s stay apart`: `2001:db8:1:2::1` ≠ `2001:db8:1:3::1`.
  - `IPv4 is unchanged`: `203.0.113.7` → `203.0.113.7`. Via `clientIpFromRequest`, `x-forwarded-for: 203.0.113.7, 10.0.0.1` → `203.0.113.7`, and `x-real-ip` only → that IP.
  - `compressed, bracketed, zoned and mapped forms normalise`: `::1` → `0:0:0:0::/64`; `[2001:db8::1]` → `2001:db8:0:0::/64`; `fe80::1%eth0` → `fe80:0:0:0::/64`; `::ffff:203.0.113.7` → `203.0.113.7`.
  - `unparseable input falls back as today`: no headers → `"unknown"`; `not-an-ip` → `not-an-ip`.
- [ ] **Step 2: red.** `bun test src/lib/client-ip.test.ts`.
- [ ] **Step 3: implement** and re-export.
- [ ] **Step 4: green.** `npm run test:ratelimit && npm run test:live-agent && npm run test:valuation && npm run test:listing-search` (source scans in `listing-alerts.test.mjs:146` and `valuation-leads.test.mjs:169` still find `clientIpFromRequest`).
- [ ] **Step 5: commit.**
  ```
  fix(security): rate limits bucket IPv6 clients by /64

  B-05. Rotating addresses inside one IPv6 allocation now share a bucket. IPv4
  keys are unchanged; old per-address IPv6 buckets expire with the daily prune.
  ```

### Task 5: Invisible honeypot on the four public forms; a hit flags, never drops

**Files:**
- **Create `src/lib/public-form-honeypot.ts`** (pure): `HONEYPOT_FIELD = "website"` and `isHoneypotFilled(value: unknown): boolean` (non-empty after `String(v).trim()`, bounded read of the first 1,000 chars).
- **Create `src/components/site/HoneypotField.tsx`:**
  ```tsx
  // Off-screen, not display:none (bots skip hidden inputs). Hidden from assistive tech.
  <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
    <label htmlFor={id}>請勿填寫此欄</label>
    <input id={id} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" ref={inputRef} />
  </div>
  ```
  The `<form>` already has a positioning context; if not, add `relative` to it.
- **Modify the four forms** (fact 17) to render `<HoneypotField>` and send its value as `website`:
  - `ContactInquiryForm.tsx:59-77`: read `fd.get("website")` and pass it through `submitContactInquiry`. `buildWebsiteInquiryPayload` (`contact-inquiry-form.ts`) gains an optional `website` argument. `contactInquirySchema` is unchanged, because it validates visible fields only.
  - `PropertyInquiryForm.tsx:48-70`: from `fd`.
  - `ListingAlertForm.tsx:75-90` and `OwnerValuationPanel.tsx:73-90`: from the ref.
- **Modify `src/lib/neon/admin-data.ts`:**
  - In each schema (`:730-752`, `:828-850`, `:898-927`), add `website: z.unknown().optional()` before `.strip()`.
  - In each handler, after the rate limits: `const { website, ...fields } = data; const suspectedBot = isHoneypotFilled(website);` and pass `{ ...fields, suspectedBot }`.
- **Modify `src/lib/neon/admin-data.server.ts:4557-4680`:** the three functions accept `suspectedBot?: boolean` and pass it to the persist helpers.
- **Modify `src/lib/neon/website-inquiry.js` (+ `.d.ts`):**
  - `persistWebsiteInquiry` accepts `suspectedBot`, appended as the **last** parameter (its index is computed from the params length, because `$9/$10` exist only with a `submissionId`).
  - After `new_lead`, add these CTEs:
    ```sql
    bot_note AS (
      INSERT INTO crm_activities (lead_id, contact_id, activity_type, body)
      SELECT new_lead.id, (SELECT id FROM contact), 'suspected_bot', $BODY
      FROM new_lead WHERE $FLAG::boolean
      RETURNING id),
    bot_audit AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT NULL, 'public_form.suspected_bot', 'crm_lead', new_lead.id, '{"form":"website_inquiry"}'::jsonb
      FROM new_lead WHERE $FLAG::boolean
      RETURNING id),
    ```
  - The body is a server constant, never user text. **Not** added to the payload hash (fact 20).
- **Modify `src/lib/neon/listing-alerts.js` and `valuation-leads.js`:** the INSERT becomes `WITH inserted AS (INSERT … RETURNING id), bot_audit AS (INSERT INTO audit_logs … SELECT NULL,'public_form.suspected_bot','listing_alert'|'valuation_lead',id,'{"form":"…"}' FROM inserted WHERE $N::boolean RETURNING id) SELECT id FROM inserted`.
- **Modify `src/lib/whatsapp-enquiries/lead-alert.server.ts`:**
  - `:136`: add `EXISTS(SELECT 1 FROM crm_activities a WHERE a.lead_id=l.id AND a.activity_type='suspected_bot') AS suspected_bot`.
  - `sourceLabel` (`:73-80`): append `（疑似機械人）` when it is true.
  - Recipients, template and planning are unchanged.
- **Modify `src/routes/admin.leads.tsx:1976-1984`:** add `suspected_bot: "疑似機械人"` to `formatActivityType`.
- **Tests** (all existing files or scripts):
  - `src/lib/public-form-honeypot.test.ts` → add to the `bun test` half of `test:contact`.
  - `src/components/site/public-forms.test.tsx` (`test:contact`).
  - `src/lib/neon/website-inquiry.test.mjs` (`test:property-experience`).
  - `listing-alerts.test.mjs` (`test:listing-search`).
  - `valuation-leads.test.mjs` (`test:valuation`).
  - `lead-alert.owned.db.test.mjs` (`test:lead-alert:owned:db`).
  - `e2e/public-form-feedback.spec.ts` (`test:public-forms:ui`).

**Copy [owner copy]:**

| Where | Text | Seen by |
|---|---|---|
| Staff WhatsApp alert, `{{2}}` suffix | 「（疑似機械人）」, e.g. 「網站查詢（疑似機械人）」 | duty manager / assigned agent |
| Lead timeline label | 「疑似機械人」 | staff |
| Lead timeline body | 「表格的隱藏欄位有內容，可能是自動程式提交。查詢已照常保存及通知，請照常跟進。」 | staff |
| Honeypot label (off-screen, `aria-hidden`) | 「請勿填寫此欄」 | nobody (bots only) |

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `public-form-honeypot.test.ts`: `isHoneypotFilled` → false for `undefined`, `null`, `""` and `"   "`; true for `"x"`, `"https://spam.example"`, `123` and a 10,000-character string.
  - `public-forms.test.tsx`:
    - `each of the four forms renders one off-screen honeypot`: exactly one `input[name="website"]` per form, with `tabindex="-1"` and `autocomplete="off"`, inside an `aria-hidden="true"` ancestor, and no `type="hidden"` and no `display:none`.
    - `the honeypot is not an accessible form control`: `getByRole("textbox", { name: "請勿填寫此欄" })` throws.
  - `website-inquiry.test.mjs`:
    - `a flagged website inquiry still writes contact, lead, inquiry and alert job in one statement`: with `suspectedBot: true`, one query whose SQL contains `INSERT INTO crm_leads`, `lead_alert AS (`, `INSERT INTO inquiries`, `'suspected_bot'` and `'public_form.suspected_bot'`, and whose last param is `true`.
    - `an unflagged inquiry passes false and the hash ignores the flag`: the payload hash is the same with `suspectedBot` true or false.
  - `admin-data` source scan (in `website-inquiry.test.mjs`, which already scans `admin-data.ts`; otherwise in `listing-alerts.test.mjs`):
    - `an oversized or non-string honeypot never fails validation`: each of the three schemas has `website: z.unknown().optional()`.
    - `each handler derives suspectedBot after the rate limits and never returns early`: the index of `isHoneypotFilled(` is greater than the last `enforceRateLimit(` and is followed by the `adminData.create…` call, with no `return` or `throw` between them.
  - `listing-alerts.test.mjs` / `valuation-leads.test.mjs`: `a flagged submission is saved and audited in one statement`. One query, it contains `INSERT INTO listing_alerts` (resp. `valuation_leads`) and `'public_form.suspected_bot'`, and the last param is `true`. Unflagged gives `false`. The existing consent and stripping tests stay green.
  - `lead-alert.owned.db.test.mjs`: `a suspected-bot lead is still alerted, tagged 疑似機械人`. Seed a website lead + `crm_activities(activity_type='suspected_bot')` on owned Postgres. Run the handler with the mocked transport. Exactly the same destinations as an unflagged lead, and the `source` variable is `網站查詢（疑似機械人）`. A control lead without the row gets `網站查詢`.
  - `e2e/public-form-feedback.spec.ts`: `a keyboard user never reaches the honeypot and a real submission sends it empty`. For each of the four forms, Tab from the first field to the submit button never focuses `input[name="website"]`, and the fixture's recorded call payload has `website` empty or absent. Then `a filled honeypot still shows the normal success message`: fill `website` via `page.fill` (force), submit, and expect the form's usual success copy (`COPY.contactSuccess` etc.).
- [ ] **Step 2: red.** `bun test src/lib/public-form-honeypot.test.ts src/components/site/public-forms.test.tsx && node --test src/lib/neon/website-inquiry.test.mjs src/lib/neon/listing-alerts.test.mjs src/lib/neon/valuation-leads.test.mjs`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green.** `npm run test:contact && npm run test:property-experience && npm run test:listing-search && npm run test:valuation && npm run test:staff-notifications && npm run test:command-center && npm run test:control-plane && npm run test:public-forms:ui && npm run test:lead-alert:owned:db`.
- [ ] **Step 5: screenshots** of the four forms at 375 and 1440 px, before and after. They must be pixel-identical, because the field is off-screen.
- [ ] **Step 6: commit.**
  ```
  feat(forms): invisible honeypot flags likely bots without ever dropping a lead

  B-05. Contact, property enquiry, valuation and listing-alert forms carry an
  off-screen field. A filled field still saves, still shows success and still
  alerts staff, tagged 疑似機械人; CRM leads get a timeline note and every flag is
  audited. No migration.
  ```

### Verification (whole batch)

**Suites:** see Global Constraints, plus `playwright.admin-owned.config.ts`.

**Preview `curl -I` matrix.** `P=https://<preview-host>`. Add `-H "x-vercel-protection-bypass: $VERCEL_BYPASS"` if Deployment Protection is on (token from your shell, never pasted in chat).

| # | Command | Expected |
|---|---|---|
| 1 | `curl -sI $P/` ; `$P/admin` ; `$P/property/<live no>` | 200 with `content-security-policy: frame-ancestors 'none'`, `content-security-policy-report-only: default-src 'self'; …`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()` |
| 2 | `curl -sI $P/w/doesnotexist` | the same status as production today (204) with `referrer-policy: no-referrer` (exactly one), `x-content-type-options: nosniff` |
| 3 | `curl -sI "$P/assets/<chunk>.js"` | 200 JavaScript, `cache-control: …immutable` unchanged, nosniff present |
| 4 | `curl -s -o /dev/null -w "%{http_code}\n" -X POST $P/api/admin/control-plane/worker` | 401 (preview only; never against production) |
| 5 | `curl -s -X POST $P/api/admin/control-plane/worker -H "authorization: Bearer wrong"` | `{"ok":false,"error":"UNAUTHORIZED"}`, 401 |
| 6 | `curl -sI $P/profile.php` | 308 `/about` (redirects unaffected) |

**Browser (preview):**
- Sign in as a staff test user. Open 客戶查詢, WhatsApp, 營運, 團隊 and 內容中心, upload one image and send nothing. Everything works, and the console shows only `[Report Only]` CSP messages, which are recorded (Owner action 2).
- Only on a preview whose `DATABASE_URL` is a Neon branch (skip otherwise; on a shared database this creates a real lead and sends a real alert): submit the contact form once with the honeypot filled through DevTools. The success line shows, the lead appears in 客戶查詢 with a 疑似機械人 timeline row, and `staff_notification_attempts` has a row for it.

**After-deploy canary (production, read-only):** `curl -sI https://www.earnestproperty.com/`, `/admin`, and `/w/doesnotexist` show the row 1-2 headers, and `https://earnestproperty.vercel.app/` shows the row 1 headers. 「工作程序最後回報」 is under 15 minutes old (drains still authenticate). Then update the audit Status for B-02, B-05, B-07, B-08 and `CHANGELOG.md`.

**Rollback:** Vercel → Deployments → previous → Instant Rollback, then revert the PR. The worker change is independent. The old worker keeps working with the new app and the reverse.

## Owner actions before production

**Order:** approve this plan and the copy → CI green → preview matrix + browser check → merge → canary → worker redeploy. There is **no migration**, so there are no Neon branch or `app_migrations` steps.

| # | Action | Steps | Needed before |
|---|---|---|---|
| 1 | **Approve the [owner copy]** in Task 5 | Reply "copy OK" or give replacements. | Task 5 merge |
| 2 | **CSP console sweep** (instead of a report endpoint, Open question 2) | On the preview, then on production after deploy: open `/`, `/listings`, a property with video and VR, `/contact`, `/videos`, an estate, `/blog`, `/mortgage`, `/admin` and the main admin pages in Chrome DevTools. Copy every `[Report Only]` line into the PR (no URLs with personal data). Repeat after 7 days on production. A clean second sweep unlocks the enforcing PR. | enforcing PR |
| 3 | **Redeploy the cron worker** (optional, any time after merge) | `npx wrangler deploy` in `workers/cron`. Smoke-check `POST /wake/general` right after: the correct `CRON_SECRET` bearer gives 202 (it only nudges a drain) and a wrong one gives 401. Then `/admin/operations` 「工作程序最後回報」 updates within 10 minutes. **Undo:** `npx wrangler rollback`. | nothing (both versions interoperate) |
| 4 | **Confirm nothing frames the site** | Tell us if any partner page, kiosk, WozTell widget or old Lovable preview shows earnestproperty.com inside another site. Default assumption: none (fact 7). | merge |
| 5 | **Watch flagged submissions for 2 weeks** | Read-only on Neon: `SELECT subject_type, count(*) FROM audit_logs WHERE action='public_form.suspected_bot' AND created_at > now()-interval '14 days' GROUP BY 1;` If real customers appear (staff confirm by phone), tell us; the field name changes. | after merge |

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **Should the headers apply to `/api/*` too?** **Default: yes, every path** (one simple rule). They do not change any status or body. nosniff protects JSON. `/w/*` keeps its own `no-referrer`.
2. **Collect CSP reports with an endpoint?** **Default: no.** It would be a new public POST route plus storage. Two DevTools sweeps (Owner action 2) gate the enforcing PR instead.
3. **Should a bot-flagged lead skip the staff WhatsApp alert?** **Default: still alert, with the tag 「（疑似機械人）」** appended to the source, e.g. 「網站查詢（疑似機械人）」. Never losing a lead outranks a stray alert, and autofill or password managers can fill hidden fields for real people.
4. **Lead timeline wording.** **Default:** label 「疑似機械人」, body 「表格的隱藏欄位有內容，可能是自動程式提交。查詢已照常保存及通知，請照常跟進。」
5. **Honeypot field name.** **Default: `website`.** Bots fill it eagerly, and browsers do not autofill it (unlike `company` or `organization`). Change it if Owner action 5 shows real customers being flagged.
6. **Add the honeypot to the live-agent phone panel?** **Default: no.** It is not a form and already needs a session token (fact 17).
7. **`X-Frame-Options: DENY` in addition to `frame-ancestors`?** **Default: yes.** It covers old browsers and adds no setting.

## Findings that differ from the approved fix plan

1. **No migration.** The fix plan puts `suspected_bot` on `crm_leads` in "FX-18c's migration", which does not exist yet. Existing tables carry the flag: a system `crm_activities` row of type `suspected_bot` (staff-visible, and read by the alert) and an `audit_logs` row for every form (fact 15). Valuation and listing-alert rows are not CRM leads until FX-02, so `crm_leads` could not have flagged them anyway.
2. **B-08 is wider and safer than stated.** The cookie branch **cannot** authenticate staff, because the Neon Auth cookie is on `neon.tech` (fact 11). Removing it changes nothing for staff. A second forwarder, `staff-identity-provider.server.ts:40-52`, also sends visitor cookies to Neon Auth and is fixed too (fact 18).
3. **`frame-ancestors` alone would weaken tracked links.** `/w/*` sets `Referrer-Policy: no-referrer`, so the config's `strict-origin-when-cross-origin` excludes `/w/*` (fact 6).
4. **The "6 places" are 5 `!==` checks plus mls-sync's private helper.** Property.hk is already timing-safe and is left alone. The Cloudflare worker cannot use `node:crypto` (no `nodejs_compat`), so it gets a `crypto.subtle.timingSafeEqual` twin (facts 8, 10).
5. **Existing tests pin the insecure comparison** (``actual !== `Bearer ${expected}` ``, `control-plane.routes.test.mjs:73`) and the cookie forwarding (`staff-identity-provider.contract.test.mjs:84-91`). They are rewritten in this batch (facts 9, 18).
6. **The honeypot only catches browser-driving bots.** The forms have no HTML `action`, and they post to TanStack server functions, so a script posting straight to `/_serverFn/<id>` never sees the field. That is acceptable because the flag is advisory and the per-IP limits remain the real control.
7. **The XFF "GUESS" is settled.** Vercel overwrites `x-forwarded-for` (docs), so the first hop is trustworthy, and only the IPv6 bucketing changes (fact 14).
8. **Test locations differ:** `scripts/vercel-headers.test.mjs` in `test:control-plane` (not `vercel.config.test.mjs`, and not #239's `scripts/vercel-config.test.mjs`); `src/lib/client-ip.test.ts` in `test:ratelimit` rather than `rate-limit-prune.test.ts`, because `ratelimit.server.ts` is server-only; `src/lib/http/bearer-secret.test.mjs` in `test:control-plane` (fact 25).
9. **Headers live in `scripts/vercel-headers.mjs`,** not inline in `vercel.ts`. This keeps the `vercel.ts` hunk to three lines clear of #239's edits (fact 3), and lets the enforcing PR change one constant.
10. **`src/lib/schema.ts:26-28` says admin auth is cookie-based with no CSP.** That is corrected (fact 23).
11. **One pre-existing issue surfaced:** the SSR loaders on `/admin/agents/new` and `/admin/agents/$id` cannot authenticate on a hard reload (fact 13, GUESS). It is not caused by B-08 and is left for FX-17.
