# Astra task 10: privacy-bounded GA4 measurement foundation

Date: 2026-09-05. Worktree `audit-20260905`; implementation started from `6d5c016`. GA4 was explicitly selected during this task. No measurement ID, provider property, credentials, storage, database or production settings were configured or contacted. No deployment/commit/push was performed by this agent.

## Implemented source

- Retained the existing 18 business event names and added internal page_view, inquiry_conversion and web_vital contracts. Every dispatch passes one closed event/key registry and field-specific runtime validation. Unknown events/keys, customer fields, phone/email-shaped values, unbounded/nonfinite values and unsupported nested payloads fail closed. Existing Chinese video categories use the current authoritative category constants; public UUID transaction IDs retain their explicit public-entity format. Removed the unvalidated DEV console transport.
- Public URLs are reduced to an explicit route allowlist/templates. Dynamic entity segments never become raw path dimensions, and query/hash payloads never enter stored attribution or GA4 page_location. The shared isAnalyticsPrivatePath helper supports root's document-boundary enforcement.
- First touch stores only a safe landing template, hostname and explicitly approved bounded UTM tokens. It is write-once for the browser session, ignores arbitrary campaigns by default, tolerates corrupt/blocked storage and does no storage work on private/disabled surfaces. Later campaign URLs cannot silently rebase the original source. The provider accepts an optional approvedCampaignTokens list; default is empty until actual campaign tokens are reviewed.
- The GA4 adapter requires a valid measurement ID and an approved public/private document isolation boundary. React mounting additionally requires confirmation that automatic Enhanced Measurement has been disabled. It disables automatic initial page views, Google signals and ad-personalization signals and supplies sanitized page location, a fixed site title and an empty raw referrer. All manually emitted events pass validation again before gtag. inquiry_conversion maps to GA4 generate_lead.
- Successful inquiry conversion accepts only the server's durable UUID, deduplicates its canonical identity locally, and never includes that UUID in provider payloads. IDs remain in a bounded session ledger (maximum 500); missing/blocked/corrupt/full storage suppresses conversion instead of risking duplicates or breaking inquiry success. This establishes at-most-once attempts within that browser session across response retries/reload; it does not claim exactly-once provider delivery or global cross-device deduplication. Throwing/rejecting sinks are isolated from user actions.
- Web Vitals uses installed official web-vitals 6.2.1 onCLS/onINP/onLCP with default lifecycle reporting, once per document, preserving CLS precision and metric ID/value/delta. It does not synthesize INP from page load. Measurement URL belongs to the measured navigation/landing document, never the later SPA route. Raw PerformanceEntry/element/URL objects are excluded. Private entry suppresses reporting; actual observer teardown depends on root's fresh-document transition, because the official library has document-lifetime observers.
- A bounded aggregate reporting model validates daily traffic/operational rows and exposes persisted inquiries, linked leads and unassigned inquiries separately from page views/click/conversion events. Missing provider data is null, never fabricated zero. Event-per-page-view ratios state their denominator and are not presented as customer/cohort conversion rates. The /admin/analytics route now serves the real operational view through a dedicated validated server function and server-only admin/manager authorization. One parameterized SQL statement separately aggregates inquiries, crm_leads and whatsapp_conversations before joining a generated Hong Kong daily series, avoiding cross-product counts. Date ranges are at most 90 inclusive days; missing/malformed daily results are unavailable rather than silently zero. Only date/count fields leave this boundary. No speculative migration/index or raw-event storage was introduced.

## Integration ownership and APIs

Root mounts `<AnalyticsProvider pathname={pathname} documentIsolationApproved />` only with the tested public/private fresh-document boundary. Root owns package/lockfile and test registration. The intake owner integrates `trackInquiryConversion(result.id)` from events.ts only after successful persistence and keeps analytics exceptions isolated. This agent did not edit __root.tsx or admin-data.ts.

Activation settings (not configured):

- `VITE_GA4_MEASUREMENT_ID`: GA4 Web data stream measurement ID, `G-` plus 10–16 uppercase alphanumeric characters. Blank/invalid means disabled.
- `VITE_GA4_MANUAL_EVENTS_CONFIRMED=true`: release-owner assertion after checking the selected stream's Enhanced Measurement is disabled; unset/false means disabled. This is required because send_page_view:false alone does not disable GA4 history-based page views or other automatic events that bypass the application registry.
- approvedCampaignTokens: optional reviewed source list passed to the provider; no arbitrary query token is approved automatically.

## Evidence

Strict TDD was applied to the main dispatch, conversion, lifecycle, GA4 adapter and aggregate contracts. Initial dispatch regressions failed 4/4; missing conversion plus optional-context PII failed 3/6; lifecycle failed 3/3; GA4 adapter failed 3/3; aggregate reporting failed 3/3. Additional red regressions caught campaign rebasing, legitimate Chinese category rejection, UUID case-sensitive deduplication and public transaction UUID rejection before their fixes.

Final foundation verification before dashboard addition: `node --test src/lib/analytics/*.test.mjs`: **32 passed, 0 failed, 0 skipped**. The dashboard addition then reproduced 5 missing date/auth/server/view regressions, passed its first 7 cases, reproduced and fixed incomplete-day results being reported as zero, and passed 8/8 dashboard/server tests. Includes actual transpiled provider mount with fake DOM/gtag/vitals, account/private/invalid config inactivity, deferred observer setup, CLS precision and lifecycle updates, sink rejection isolation, conversion retries, corrupt storage and aggregate-only shape rejection. No real provider was called. Focused ESLint over owned TypeScript/TSX passed with exit 0 after Prettier; root owns combined typecheck/build and route-browser verification.

## Remaining acceptance and reporting work

No production measurement is enabled or verified. A named GA4 property/stream and settings review, approved environment setup, captured staging payload inspection, fake/staging inquiry conversion workflow, root public/private boundary browser acceptance, deployment verification and real-user monitoring remain gates. The 32 deterministic tests do not establish production p75 LCP/INP/CLS.

The authenticated /admin/analytics dashboard and aggregate API are implemented with real operational query code, but their actual database/runtime result has not been executed by this agent. Root owns its navigation link, route generation and isolated Preview/staging acceptance. GA4 Data API authentication/import and provider aggregate persistence remain unconfigured/unimplemented: the dashboard explicitly shows those provider metrics as unavailable, while the operational counts come only from database results. No historical branch implementation is represented as verified current work and no production counts/provider results are invented.

## Official API references

- [Google Web Vitals source and lifecycle documentation](https://github.com/GoogleChrome/web-vitals): default callbacks can report on visibility changes and BFCache restoration; INP needs interaction; register once per document.
- [Google Analytics pageview controls](https://developers.google.com/analytics/devguides/collection/ga4/views): disable automatic pageviews and separately disable Enhanced Measurement history events when manually controlling views.
- [GA4 Enhanced Measurement settings](https://support.google.com/analytics/answer/9216061): stream settings own automatic event behavior.


Final combined analytics verification after dashboard completion: `node --test src/lib/analytics/*.test.mjs` **40/40 passed**, with 0 failed and 0 skipped. Focused ESLint over analytics TypeScript, provider component and admin.analytics route passed. No full build/typecheck or database/provider execution was performed by this agent; root owns combined and isolated Preview verification.

## Independent review fixes (2026-09-06)

Closed the formatted-phone validation bypass and initial child view loss documented in astra-review-task10.md. Phone-shaped tokens are checked after permitted separator normalization. Mounted page-view hooks wait for enabled dispatch, mark sent only after acceptance and unsubscribe on cleanup. New tests reproduced both defects before correction, then passed3/3. Full analytics suite now43/43 passed; focused lint passed. No root/package/provider configuration changed and no real analytics was sent.
