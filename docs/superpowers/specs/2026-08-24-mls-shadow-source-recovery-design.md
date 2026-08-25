# MLS Shadow Source Recovery Design

**Date:** 2026-08-24
**Status:** Approved design; implementation requires a separate approved plan
**Scope:** Recover trustworthy old-site and 28Hse source health after the first production shadow run, and preserve actionable diagnostics in R2 evidence.

## Context

The first production shadow Workflow completed its infrastructure path, but the application run was safely blocked:

- Workflow instance: `cf_06241a896bcff20970ebe55d68d685c5785b455e95fd92d1f49b2ed3ae1ff9e4`
- Attempt: `scheduled:production:2026-08-24:manual:shadow-20260824-022842`
- Neon run: `ef9d3de7-04ad-4a5a-bc58-8af3110d5434`
- Terminal application state: `failed`, exit code `20`, failure code `mls_run_failed`
- Gate state: `blocked`; no proposals, publication, media upload, or inactivity advancement occurred

The R2 report identified two independent source failures:

1. The old-site robots request ended at an HTML homepage rather than a safely interpretable robots policy. The crawler correctly failed closed.
2. The 28Hse agent page was a normal populated page, but generic navigation text such as `會員登入` matched the broad challenge regular expression. The parser would still fail after that false positive because it expects synthetic `data-agent-profile` and `data-agent-results` attributes that the live page does not contain.

The emitted `diagnostics.json` was empty even though both adapters already produced bounded diagnostics. `runDualSourceSync` did not carry those adapter diagnostics into the outcome passed to `buildRunArtifactObjects`.

## Goals

- Preserve robots and access-policy compliance. No code path may manufacture permission when a policy is missing, malformed, redirected to non-policy content, or unreachable.
- Stop classifying a normal 28Hse agent page as a challenge merely because navigation contains login-related words.
- Parse the current 28Hse agent-index structure with strict company and licence identity checks.
- Keep known challenge, access-denied, login-gate, malformed-template, and identity-mismatch pages fail closed.
- Carry bounded per-source diagnostics into every relevant terminal artifact, especially blocked runs.
- Keep all shadow and publish safety gates unchanged.

## Non-goals

- No CAPTCHA solving, browser automation, proxy rotation, session impersonation, authentication bypass, or challenge circumvention.
- No robots override, cached allow rule, or first-party exception.
- No schedule creation, deployment, publication, migration, live retry, source write, Neon mutation, R2 mutation, or Blob mutation as part of implementation.
- No broad crawler framework rewrite or unrelated orchestrator refactor.
- No claim that the legacy source is healthy until its live origin meets the operational prerequisites below.

## Chosen Approach

Use a targeted compliance-first repair:

1. Keep the old-site source blocked until the live legacy origin serves a valid robots policy and independent legacy inventory.
2. Replace keyword-only 28Hse challenge detection with strong structural challenge evidence.
3. Update only the 28Hse agent-index parser to recognize the current semantic page shape while retaining strict identity and URL validation.
4. Propagate the diagnostics the adapters already produce into the existing reporting boundary.

This is preferred over a browser-rendered crawler because the current response already contains usable server-rendered inventory, and a browser would add cost, nondeterminism, and anti-bot risk. Temporarily disabling a source is also rejected because it would defeat the approved dual-source health model.

## Design

### 1. Old-site access-policy boundary

`loadRobotsPolicy` remains authoritative. A fetched response is usable only when `parseRobots` marks it safely interpretable. Redirected HTML, malformed text, unreachable policy, and terminal access responses remain disallowed.

The source adapter will continue using the existing bounded codes:

- `robots_malformed`
- `robots_terminal_access`
- `robots_unreachable`

No new allow path is introduced. Tests will make the observed redirect-to-HTML behavior explicit so a future change cannot accidentally treat a homepage as a robots policy.

Before another live shadow run, an operator must verify both conditions:

1. `https://www.earnestproperty.com/robots.txt` terminates at a parseable robots document for the crawler user agent, rather than redirecting to HTML.
2. At least one configured legacy seed and detail URL still serves independent legacy inventory. A redirect into the current canonical application is not an independent source and must not be counted as healthy old-site evidence.

The activation runbook will document these read-only checks. The offline verifier will not perform network access.

### 2. 28Hse challenge classification

`detect28HseChallenge` remains a pure HTML classifier, but its evidence changes from generic text keywords to strong signals.

Strong challenge evidence includes:

- an empty or textless response;
- Cloudflare challenge markup such as `cf-chl-`, `challenge-platform`, or the challenge platform path;
- a page title or primary heading that explicitly says `Just a moment`, `Access denied`, `Attention required`, or `Verify you are human`;
- an actual CAPTCHA or verification form/iframe that gates the document;
- a primary login form or login-gate page when agent identity and listing content are absent.

The following are not challenge evidence on their own:

- global navigation links containing `login`, `sign in`, `會員登入`, or `登入`;
- ordinary footer/help text mentioning CAPTCHA or Cloudflare;
- the word `challenge` inside scripts or unrelated content without a challenge structure.

Challenge detection stays conservative: known challenge fixtures must remain blocked, but a populated agent page with valid identity and listings must not be rejected for generic navigation copy.

### 3. 28Hse agent-index parser

`parse28HseAgentIndex` will use a minimal, sanitized fixture shaped like the current server-rendered page. It will not store the full live response in the repository.

The parser must establish all of the following before returning inventory:

- the page is not a strong challenge;
- the company identity resolves uniquely to Earnest Property;
- the company licence resolves uniquely to `C-018613`;
- the advertised sale or rent count is present and is a bounded non-negative integer;
- listing links use the expected 28Hse origin and match the selected deal type;
- each property URL yields a numeric external ID;
- duplicate IDs are identical, while contradictory duplicates fail closed;
- the requested agent page remains on the expected route with a bounded page number.

The parser will prefer stable semantic evidence over generated class names:

- company headings and labelled licence text;
- advertised-count text for the selected deal type;
- anchors whose paths match the existing strict property URL contract;
- the existing strict agent-page URL contract supplied by the adapter.

The returned contract remains unchanged: company name, fixed company licence, advertised count, deal type, unique sorted links, and a deterministic page fingerprint. The source adapter continues sequential pagination using the advertised count, page fingerprint, newly discovered IDs, and the existing `maxPages` ceiling; the parser does not invent a second pagination protocol.

If identity, count, URL, or pagination evidence is missing or contradictory, the page is unhealthy. The implementation must not silently return zero inventory from a changed template.

### 4. Diagnostic propagation

The adapters already return bounded diagnostic records. `runDualSourceSync` will snapshot those records after both source collections settle and attach them to every outcome that can reach artifact reporting.

The outcome-level `diagnostics` array will contain only adapter-produced bounded records. It will not contain raw exceptions, response bodies, headers, credentials, tokens, or arbitrary nested values.

The existing `diagnosticsFor` reporting boundary remains responsible for:

- allowlisting diagnostic keys;
- URL sanitization;
- JSON-safe projection;
- secret redaction;
- rendering `diagnostics.json`.

Blocked source-health outcomes must retain the existing `source_health_blocked` failure code and bounded failure summary. Diagnostic propagation extends that metadata; it does not replace it.

### 5. Data flow

The repaired offline/runtime flow is:

1. Each source adapter checks robots and access policy.
2. The 28Hse adapter classifies the page using strong challenge evidence.
3. The agent-index parser validates identity, count, property links, and the requested page URL; the adapter retains bounded sequential pagination.
4. Both adapters return observations, coverage, failures, and bounded diagnostics.
5. The orchestrator evaluates source health and the run gate exactly as today.
6. The orchestrator attaches a snapshot of adapter diagnostics to the terminal outcome.
7. Reporting redacts and writes `report.json`, CSV artifacts, and a non-empty `diagnostics.json` when failures occurred.
8. The existing CLI maps a blocked source-health run to its current terminal status and exit behavior.

No data-flow edge may bypass source-health evaluation or enable publication.

## Error Handling

- Robots failures remain source-health failures, never warnings that allow crawling.
- Strong 28Hse challenges remain terminal for that source collection.
- A normal page with an unexpected template is classified as a parser/template failure, not as a challenge.
- Wrong company or licence identity fails closed before listing links are accepted.
- Contradictory property links or unsafe pagination fail closed.
- Diagnostic projection must tolerate malformed adapter diagnostic values by reducing them to the existing safe reporting representation.
- If both sources remain unhealthy, the run remains blocked and produces evidence; it never publishes or advances inactivity.

## Test Strategy

Implementation will use strict RED/GREEN slices. Production code is changed only after the corresponding failing regression is observed.

### Slice A: old-site robots behavior

- A redirected or HTML robots response remains `robots_malformed` and disallowed.
- A valid robots fixture remains allowed according to its parsed rules.
- No test introduces an override or cached permission path.

### Slice B: 28Hse challenge evidence

- A sanitized normal agent page containing global login text is not a challenge.
- Empty, Cloudflare challenge, access-denied, CAPTCHA-gate, and primary login-gate fixtures remain challenges.
- Generic mentions in non-gating content do not trigger the detector.

### Slice C: current 28Hse index structure

- A current-page-shaped fixture validates Earnest Property and `C-018613`.
- It extracts sale/rent property links, external IDs, and the advertised count while the adapter proves bounded sequential pagination.
- Wrong licence, wrong agent, missing count, mismatched deal type, contradictory duplicates, unsafe page URLs, pagination loops, stalls, and ceilings fail closed.
- Caller input and returned data remain deterministic and mutation-safe according to existing parser conventions.

### Slice D: evidence diagnostics

- A blocked dual-source run carries both adapters' bounded diagnostics into `diagnostics.json`.
- Diagnostic URLs and unsafe values are redacted by the existing reporting projector.
- `source_health_blocked` terminal metadata remains intact.
- Healthy and failed artifact contracts remain unchanged apart from the newly populated diagnostics array.

### Verification gates

- Focused parser, adapter, orchestrator, reporting, and sync tests.
- Full offline MLS test suite.
- Node syntax checks for changed JavaScript modules.
- Scoped Prettier and ESLint checks.
- Scoped `git diff --check` and explicit-path scope audit.
- Independent code review before any provider or live action.

## Rollout and Operational Gate

Implementation and verification stop before deployment. A later live retry requires separate approval and all of these conditions:

- the legacy robots endpoint passes the documented read-only check;
- the legacy seed/detail path proves independent inventory or the old-site source is formally redesigned in a new approved spec;
- focused and full offline gates pass;
- the Cloudflare Worker remains unscheduled;
- `MLS_SCHEDULED_MODE` remains `shadow`;
- `MLS_PUBLISH_ENABLED` remains `false`;
- `MLS_MEDIA_RIGHTS_CONFIRMED` remains `false`;
- reviewed code is deployed under a verified commit/deployment identity;
- a new manual shadow attempt uses a new suffix and is reviewed through Workflow, Neon, R2, and verifier evidence.

## Acceptance Criteria

The implementation is ready for a separate deployment decision when:

1. A normal current-page-shaped 28Hse fixture with generic login navigation is parsed successfully.
2. Strong challenge and identity-mismatch fixtures still fail closed.
3. Current semantic result links are extracted and sequential pagination remains bounded by the advertised count, progress checks, fingerprints, and `maxPages`.
4. Redirected HTML at the old-site robots endpoint is explicitly tested and remains disallowed.
5. A blocked dual-source fixture produces non-empty, redacted `diagnostics.json` with both source failures.
6. Existing terminal, publication, inactivity, and evidence-integrity contracts remain green.
7. Only explicitly authorized source, test, fixture, runbook, and design/plan files are changed; unrelated worktree changes remain untouched.
