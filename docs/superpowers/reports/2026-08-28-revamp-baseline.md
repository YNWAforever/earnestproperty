# Frontend revamp — P0 baseline

Recorded on branch `feat/frontend-revamp-p0-baseline` (off `feat/frontend-revamp`, off
`main` at `0592fd799d9d533f47721293a5ddeb5716461f4b`), 2026-08-29.

Local toolchain: Node `v25.8.2`, npm `11.11.1`, Bun `1.3.12`.

This is the "green" this repo actually has today, not the green the plan assumed.
Two figures in the plan's own text turned out stale once measured fresh — see §1 and
§2 — which is exactly why this report exists: so P1 onward can tell pre-existing
breakage from breakage it causes, instead of inheriting an unverified number.

## 0. Commands run

```
npx tsc --noEmit
npm run lint
npm run build
npm run test:corridor
npm run test:seo
npm run test:blog
npm run test:videos
npm run test:homepage
npm run test:mls
npm run test:listing-search
npm run test:cron
npm run test:contact
npm run test:estate-conversion
npm run test:neon-auth
npm run test:command-center
npm run test:woztell
npm run test:operations
npm run test:control-plane
npm run test:team
npm run test:property-experience
npm run test:content-copilot
npm run test:cms
npm run test:youtube-sync
npm run test:migration
npm run test:mls:cloudflare
```

Intentionally **not** run (need a live database): `test:mls:db`, `test:control-plane:db`,
`test:youtube-sync:db`.

## 1. `npx tsc --noEmit` — 0 errors (CHANGELOG's "56" is stale)

Ran twice, independently, both clean: exit 0, zero output, `grep -c "error TS"` → 0.

CHANGELOG.md lines 8 and 167 record "`tsc --noEmit` reports 56 errors. All pre-existing
(TanStack server-fn generics, Bun test...)" from an earlier point in the repo's history.
Something between that entry and `0592fd7` fixed all 56 — the CHANGELOG note was never
updated. **The real, current typecheck baseline is 0, not 56.** `.github/workflows/ci.yml`'s
ratchet uses `TSC_BASELINE: 0`.

## 2. `npm run lint` — 6,185 problems (6,182 are formatting drift, not rule violations)

Exit 1. `✖ 6185 problems (6185 errors, 0 warnings)`, spread across 350 distinct files.

- **6,182** are `prettier/prettier` — Prettier disagreeing with the committed formatting.
  Confirmed independently with a plain `npx prettier --check src/routes/videos.tsx`
  (fails outside ESLint entirely), so this isn't an ESLint-integration artifact.
- **3** are real: `@typescript-eslint/no-explicit-any` in
  `workers/mls-container/src/run-contract.test.ts:191,208,209`.

**Likely cause:** `package.json` pins `"prettier": "^3.7.3"`; the resolved version in
`package-lock.json` (unchanged by anything in this session — verified via `git diff` and
`git show HEAD:package-lock.json`) is `3.8.2`. Prettier has a history of changing default
formatting output across minor versions. `git log` shows a `898e46c chore(lint): make
prettier --check pass and cut the lint warning noise` commit in this repo's history — the
drift most likely happened after that commit, via an ordinary `npm install`/lockfile
update, with nobody re-running `npm run format` afterward.

**Not fixed here.** Reformatting 350 files is a large, mechanical, unrelated diff — out of
scope for a phase whose own rule is "ships no behaviour change." `ci.yml` ratchets lint
against this baseline (`ESLINT_BASELINE: 6185`, summed `errorCount + warningCount` from
`eslint --format json`) the same way it ratchets typecheck, so a PR that adds new problems
still fails CI, but the 350-file reformat is left for a dedicated follow-up.

`src/routeTree.gen.ts` correctly does not appear (generated file, excluded). Vendored
shadcn primitives in `src/components/ui/` do appear (37 hits) — expected, since upstream
shadcn output doesn't target this repo's Prettier config.

## 3. `npm run build` — passes

Exit 0, ~46s. No live DB or secrets required: `scripts/check-required-env.mjs` only
enforces the WhatsApp contact vars when `VERCEL_ENV` is `production`/`preview`, so a
plain `npm run build` (and CI, which never sets `VERCEL_ENV`) is unaffected.

## 4. Test matrix — 14 of 21 scripts fully pass, 7 have pre-existing failures

| Script | Runner | Pass | Fail | Notes |
| --- | --- | --- | --- | --- |
| `test:corridor` | node | 18 | 0 | |
| `test:seo` | node+bun | 17+6 | 0 | |
| `test:blog` | node | 1 | **1** | see below |
| `test:videos` | node | 20 | 0 | |
| `test:homepage` | node | 6 | 0 | |
| `test:mls` | node | 576 | 0 | |
| `test:listing-search` | node | 16 | 0 | |
| `test:cron` | node | 5 | 0 | |
| `test:contact` | node | 42 | **2** | see below |
| `test:estate-conversion` | node | 17 | **1** | see below |
| `test:neon-auth` | node | 6 | 0 | |
| `test:command-center` | node | 52 | 0 | |
| `test:woztell` | node+bun | 102+6 | 0 | |
| `test:operations` | node+bun | 19+8 | 0 | |
| `test:control-plane` | node | 51 | **1** | see below |
| `test:team` | node+bun | 52 | **1** | see below |
| `test:property-experience` | node+bun | 89+105 | **2** | see below (same root cause as `test:contact`) |
| `test:content-copilot` | node+bun | 62 | **1** | see below |
| `test:cms` | node | 10 | 0 | |
| `test:youtube-sync` | node+bun | 10+50 | 0 | |
| `test:migration` | node | 10 | 0 | |
| `test:mls:cloudflare` | node+bun | 75+45 | 0 | |

None of these 7 are caused by anything in this branch — the only changes present when
this sweep ran were doc edits (`CLAUDE.md`), a new `typecheck` script in `package.json`,
`git rm --cached .env`, and adding `eslint-plugin-jsx-a11y` as a devDependency (not yet
wired into `eslint.config.js` — see §5). None of those touch application logic, so this
is a faithful "what main actually does today" baseline.

### 4.1 `test:blog` — stale route-parity fixture
`src/routes/blog.routes.test.mjs:49` ("every route with children in the generated tree
renders an Outlet") throws `ENOENT` trying to read
`src/routes/api.youtube-sync.tsx` — the actual file has a different name/extension
(likely `.ts`, since it's an API handler, not a component). The test's file-path
derivation from the route tree is out of sync with the real route file.

### 4.2 `test:contact` / `test:property-experience` — homepage section-ordering assertions
Both scripts include `src/config/site.test.mjs`, which fails the same two assertions in
both runs:
- `:232` "homepage puts 精選筍盤 above 深井核心屋苑" — `indexOf(...)` returns `-1`
  (section marker not found) where the test expects it to be found.
- `:545` "videos page orders CMS videos above listing videos" — same `-1`/`notStrictEqual`
  shape.

Both fail identically (`actual: -1, expected: -1` via `assert.notStrictEqual`), strongly
suggesting one shared root cause — a homepage/site content array likely had a section
renamed, reordered, or removed since this test was written, so the marker the test
`indexOf()`s for no longer appears at all.

### 4.3 `test:estate-conversion` — featured-section eyebrow assertion
`src/content/estate-conversion.test.mjs:260` "homepage shows featured property videos
after featured listings" — `assert.equal(..., true)` fails with "featured listings
section should carry its eyebrow" (`actual: false`). 17/18 tests in this script pass.

### 4.4 `test:control-plane` — real migration-manifest drift
`src/lib/control-plane/migration-versions.test.mjs:20` "the manifest matches
neon/migrations exactly" fails: `MIGRATION_VERSIONS` in
`src/lib/control-plane/migration-versions.js` is missing
`20260822120000_whatsapp_audience_segment_link.sql`, which exists in
`neon/migrations/` (landed in the recent `codex/28hse-dual-source-sync` merge). This is
the exact class of bug `migration-drift.yml` exists to catch — a real, unfixed gap, not
a stale fixture. **Fix is a one-line addition to the manifest**, not a test change.

### 4.5 `test:team` — time-sensitive fixture, not a logic bug
`src/lib/neon/admin-team.contract.test.mjs:120` expects a fixture invitation
(`invitationExpiresAt: "2026-08-17T00:00:00.000Z"`) to compute as `invitationState:
"sent"`, `needsAttention: false`. Today's date is 2026-08-29 — 12 days past that
expiry — so the code correctly computes `"expired"` / `true`. The fixture's dates are
hardcoded relative to when the test was written, not relative to "now"; it will
increasingly diverge over time regardless of any code change. Needs either a relative
date (e.g. `Date.now() + N days`) or an explicit fixed "current time" injected into the
computation, not a code fix.

### 4.6 `test:content-copilot` — false-positive secret scan
`src/lib/ai/ai-contract.test.mjs:134` "AI, Neon, Woztell, and Blob secret names stay out
of browser-safe source" fails against `src/lib/mls/neon-lock.mjs`, which contains the
string `"DATABASE_URL_UNPOOLED is required"` — an error message *naming* the env var,
not leaking its value. The test's regex matches on the variable name appearing anywhere
in the file, so it can't distinguish "this file requires a secret and says so in an
error message" from "this file has the secret's value inlined." Worth narrowing the
regex (e.g. requiring `=` or a literal-looking value after the name) in a follow-up, but
there is no actual secret exposure here.

## 5. Known gap: `eslint-plugin-jsx-a11y` not yet wired into `eslint.config.js`

The plugin is installed (`package.json` devDependency, `eslint-plugin-jsx-a11y@6.10.2`),
and the `eslint.config.js` change to wire it in at `"warn"` severity is written and
ready, but this repo's global `config-protection` Claude Code hook unconditionally blocks
edits to an *existing* `eslint.config.js` (it can't distinguish an additive change from a
weakening one). Applying it needs the hook temporarily disabled outside this session, then
a retry of that one edit. Everything else in P0 does not depend on it.

## 6. What changed on this branch (P0 work)

- `package.json`: added `"typecheck": "tsc --noEmit"`.
- `package.json` / `package-lock.json`: added `eslint-plugin-jsx-a11y@6.10.2` as a
  devDependency (not yet wired into `eslint.config.js` — see §5).
- `.github/workflows/ci.yml`: new — lint (ratchet), typecheck (ratchet), build, and the
  21-script non-`:db` test matrix (7 pre-existing failures marked `continue-on-error`,
  each commented with its root cause and a pointer here). `migration-drift.yml`
  untouched.
- `.env`: `git rm --cached` — already covered by `.gitignore:38`'s `.env*`; file stays on
  disk, only stops being tracked. Confirmed fresh (not just trusted from the plan) that it
  contains only `VITE_NEON_AUTH_URL`, `NEON_AUTH_BASE_URL`, `WOZTELL_ENABLED` — no
  secrets.
- `CLAUDE.md`: corrected the server-function module list to include `admin-team.ts`.
- `docs/superpowers/plans/2026-08-28-frontend-revamp.md`: the plan copied into the
  tracked repo (it previously existed only as an untracked file in the main checkout,
  under a different filename), with the corrections from the verification pass folded
  in.

No route, component, or server-function code was touched. No behaviour changes.
