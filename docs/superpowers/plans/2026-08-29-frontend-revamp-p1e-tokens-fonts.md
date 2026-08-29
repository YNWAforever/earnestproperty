# P1e — Design Tokens, Font Preload, and Headline Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three additive design tokens (`--surface-warm`, `--ink-charcoal`,
`--brand-accent-bronze`), preload the Google Fonts stylesheet, and fix the homepage
headline's forced line break — the three remaining, independent P1 work items that
don't depend on `format.ts`, the layout primitives, or `AppImage`.

**Architecture:** Pure CSS-token and markup changes; no new components, no new logic.
Each of the three pieces gets a small `node --test` source-scan test, mirroring the
pattern already established at `src/content/estate-conversion.test.mjs` (assert
against the raw file text, not rendered output) — this repo has no visual-regression
or contrast-checking tooling, so "the token exists with the computed value" and "the
markup no longer contains the old broken pattern" are the real, honest tests available.

**Tech Stack:** CSS custom properties (Tailwind v4 `@theme inline`), `node --test`.

**Prerequisite:** None — independent of P1a/b/c/d.

**Important scope note on the new colors:** the master instruction document that
specified "warm white, charcoal, gold/bronze" (referenced in the master plan's header
as `EarnestProperty_ChatGPT_Sites_Frontend_Revamp_Claude_Integration_Master_Instruction.md`)
was never committed to this repo — confirmed absent by a repo-wide search. The three
hex values below are therefore a **draft**, not a client-approved palette the way
`--brand-primary`'s `#1F7A4D` is (that one has an explicit "client-approved" note in
`styles.css`'s own header comment). Every contrast ratio in this plan was **computed**
with the same sRGB relative-luminance formula `styles.css`'s existing comments use (the
computation script's output for `--brand-primary` on white reproduced the file's own
stated `5.32:1` exactly, confirming the method), not estimated — but the *color choice
itself* needs real client/design sign-off before treating it as final. Flag this
explicitly in the PR description.

**Also explicitly deferred (do not do in this plan):** retiring `--coral`/`text-coral`.
The master plan's P1 §3 lists this under P1, phrased "now that eyebrows are being
rewritten" — but the eyebrow rewrites are DR-8, scheduled in P2, and `--coral` is still
a live, working alias for several current consumers (`estate-reviews.tsx`,
`CorridorInventory.tsx`, `MortgageCalculator.tsx`, `transactions.tsx`'s own icon/heading
color). Removing the token now, before those consumers are rewritten, would break their
visible styling — `bg-coral`/`text-coral` would resolve to nothing. This exact same
judgment call was already made and documented in
`docs/superpowers/plans/2026-08-29-frontend-revamp-p1b-format-callsites.md`'s header;
repeated here for anyone reading this plan in isolation. Retire `--coral` in P2,
immediately after DR-8's eyebrow-label rewrites land in the same phase.

---

## File Structure

- **Modify:** `src/styles.css` — three new tokens in `:root` and their `@theme inline`
  Tailwind color mappings.
- **Modify:** `src/routes/__root.tsx` — one new `rel="preload"` link for the Google
  Fonts stylesheet.
- **Modify:** `src/routes/index.tsx:219-223` — the hero `<h1>`, replacing the hard
  `<br />` with `text-balance` and a non-breaking span.
- **Create:** `src/styles.test.mjs` — `node --test` source-scan tests for all three
  changes above.
- **Modify:** `package.json` — add `"test:styles": "node --test src/styles.test.mjs"`.

---

## Task 1: Add the three design tokens

**Files:**
- Modify: `src/styles.css`
- Test: `src/styles.test.mjs` (new file — this task writes its first block)

- [ ] **Step 1: Write the failing test**

Create `src/styles.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("styles.css defines the three P1 additive tokens with their computed oklch values", () => {
  const source = read("src/styles.css");
  assert.match(source, /--surface-warm:\s*oklch\(0\.975 0\.009 78\.3\);/);
  assert.match(source, /--ink-charcoal:\s*oklch\(0\.272 0\.009 67\.4\);/);
  assert.match(source, /--brand-accent-bronze:\s*oklch\(0\.456 0\.087 59\.5\);/);
});

test("styles.css exposes the three new tokens as Tailwind color utilities", () => {
  const source = read("src/styles.css");
  assert.match(source, /--color-surface-warm:\s*var\(--surface-warm\);/);
  assert.match(source, /--color-ink-charcoal:\s*var\(--ink-charcoal\);/);
  assert.match(source, /--color-brand-accent-bronze:\s*var\(--brand-accent-bronze\);/);
});

test("styles.css still keeps --coral as a working alias (not retired in P1 -- see this plan's header)", () => {
  const source = read("src/styles.css");
  assert.match(source, /--coral:\s*var\(--brand-primary\);/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/styles.test.mjs`
Expected: FAIL — the two token-existence assertions fail (`--surface-warm` etc. don't
exist yet); the third (`--coral` still present) already passes since nothing has
touched it yet.

- [ ] **Step 3: Add the tokens**

In `src/styles.css`, the current `:root` block has this section:

```css
  /* Reusable brand aliases (see redesign brief) */
  --brand-primary: oklch(0.515 0.11 156.8);
  --brand-primary-dark: oklch(0.422 0.09 156.9);
  --brand-primary-deep: oklch(0.322 0.065 157.8);
  --brand-primary-light: oklch(0.957 0.015 164.7);
  /* On-dark step of the same scale. --brand-primary measures ~1.4:1 over the
     hero scrim and the dark footer, so those surfaces need a light green rather
     than the primary. Replaces the retired --brand-lime and --brand-accent. */
  --brand-primary-bright: oklch(0.85 0.14 157);
  --surface: oklch(0.985 0.003 157);
  --text-primary: oklch(0.27 0 0);
  --text-secondary: oklch(0.535 0.017 157);
```

Add the new tokens immediately after `--text-secondary`, before the blank line and
`--background: var(--surface);`:

```css
  /* Reusable brand aliases (see redesign brief) */
  --brand-primary: oklch(0.515 0.11 156.8);
  --brand-primary-dark: oklch(0.422 0.09 156.9);
  --brand-primary-deep: oklch(0.322 0.065 157.8);
  --brand-primary-light: oklch(0.957 0.015 164.7);
  /* On-dark step of the same scale. --brand-primary measures ~1.4:1 over the
     hero scrim and the dark footer, so those surfaces need a light green rather
     than the primary. Replaces the retired --brand-lime and --brand-accent. */
  --brand-primary-bright: oklch(0.85 0.14 157);
  --surface: oklch(0.985 0.003 157);
  --text-primary: oklch(0.27 0 0);
  --text-secondary: oklch(0.535 0.017 157);

  /* P1 additive surface + accent tokens (frontend-revamp plan §0.2 D3 -- these
     are ADDITIVE alongside the forest-green brand, not a palette replacement).
     DRAFT, pending client/design sign-off: the master instruction document that
     specified "warm white, charcoal, gold/bronze" was never committed to this
     repo, so unlike --brand-primary these hex values are not yet client-approved.
     Every ratio below is computed (sRGB relative-luminance formula, same method
     that reproduces this file's --brand-primary 5.32:1 exactly) -- re-verify with
     a live contrast checker once the client confirms the actual palette.
     #FAF6F0 warm ivory surface                                -> oklch(0.975 0.009 78.3)
     #2A2622 warm-toned charcoal ink (13.94:1 on surface-warm,
              15.01:1 on white)                                -> oklch(0.272 0.009 67.4)
     #7A4A1F bronze accent (7.43:1 on white, 6.90:1 on
              surface-warm)                                    -> oklch(0.456 0.087 59.5) */
  --surface-warm: oklch(0.975 0.009 78.3);
  --ink-charcoal: oklch(0.272 0.009 67.4);
  --brand-accent-bronze: oklch(0.456 0.087 59.5);
```

Then, in the `@theme inline` block near the top of the file, the current block has:

```css
  --color-coral: var(--coral);
  --color-coral-foreground: var(--coral-foreground);
  --color-destructive: var(--destructive);
```

Add the three new mappings after `--color-coral-foreground`:

```css
  --color-coral: var(--coral);
  --color-coral-foreground: var(--coral-foreground);
  --color-surface-warm: var(--surface-warm);
  --color-ink-charcoal: var(--ink-charcoal);
  --color-brand-accent-bronze: var(--brand-accent-bronze);
  --color-destructive: var(--destructive);
```

This makes `bg-surface-warm`, `text-ink-charcoal`, `text-brand-accent-bronze` (and
their `border-`/`bg-` equivalents) available as Tailwind utility classes, the same way
every other semantic token in this file already is.

**Scope note:** no `.dark` block override is added for these three tokens. This site
has no active dark-mode toggle in the public UI (the `.dark` class selectors in this
file are unused shadcn scaffolding) — adding dark variants for a mode nothing switches
into would be speculative. If dark mode is ever activated, add `.dark` overrides for
these three tokens at that time.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/styles.test.mjs`
Expected: PASS — 3 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/styles.test.mjs
git commit -m "feat(styles): add surface-warm, ink-charcoal, brand-accent-bronze tokens

Draft values pending client design sign-off (see this plan's header
and the file's new token comment) -- computed WCAG ratios, not
estimated. --coral is deliberately NOT retired here; see the deferral
note in this plan and in p1b-format-callsites.md."
```

---

## Task 2: Preload the Google Fonts stylesheet

**Files:**
- Modify: `src/routes/__root.tsx`
- Test: `src/styles.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/styles.test.mjs`:

```js
test("__root.tsx preloads the Google Fonts stylesheet ahead of the blocking stylesheet link", () => {
  const source = read("src/routes/__root.tsx");
  assert.match(
    source,
    /rel:\s*"preload",\s*\n\s*as:\s*"style",\s*\n\s*href:\s*"https:\/\/fonts\.googleapis\.com\/css2\?family=Inter/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/styles.test.mjs`
Expected: FAIL — the preload link doesn't exist yet.

- [ ] **Step 3: Add the preload link**

In `src/routes/__root.tsx`, the current `links` array is:

```tsx
links: [
  { rel: "stylesheet", href: appCss },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap",
  },
],
```

Add a `preload` entry for the same URL immediately before the `stylesheet` entry:

```tsx
links: [
  { rel: "stylesheet", href: appCss },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "preload",
    as: "style",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap",
  },
],
```

This preloads the CSS resource itself at high priority (the `preconnect` entries above
it only warm up the connection, they don't fetch anything). Full self-hosting of the
two font families was considered — see this plan's header — but needs real font-file
assets this plan doesn't have; `preload` is the achievable improvement today.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/styles.test.mjs`
Expected: PASS — 4 tests total, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/routes/__root.tsx src/styles.test.mjs
git commit -m "perf(fonts): preload the Google Fonts stylesheet

Full self-hosting needs real font-file assets this plan doesn't have
-- preload is the achievable step today, fetching the fonts CSS at
high priority instead of waiting for the render-blocking stylesheet
link to be reached."
```

---

## Task 3: Fix the homepage headline's forced line break

**Files:**
- Modify: `src/routes/index.tsx:219-223`
- Test: `src/styles.test.mjs` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/styles.test.mjs`:

```js
test("the homepage hero headline uses text-balance and a non-breaking brand span, not a hard <br>", () => {
  const source = read("src/routes/index.tsx");
  const headingMatch = source.match(/<h1[^>]*>[\s\S]*?<\/h1>/);
  assert.ok(headingMatch, "expected to find the hero <h1> in index.tsx");
  const heading = headingMatch[0];
  assert.match(heading, /text-balance/, "hero <h1> should use the text-balance utility");
  assert.doesNotMatch(heading, /<br\s*\/?>/, "hero <h1> should not force a line break");
  assert.match(
    heading,
    /whitespace-nowrap[^>]*>晉誠地產/,
    "晉誠地產 should not be allowed to break mid-word",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/styles.test.mjs`
Expected: FAIL — the current `<h1>` has a `<br />` and no `text-balance`/`whitespace-nowrap`.

- [ ] **Step 3: Replace the hard break**

Current code, `src/routes/index.tsx:219-223`:

```tsx
            <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              深井 青山公路 汀九買樓租樓
              <br />
              <span className="text-brand-bright">晉誠地產</span> ‧ 全部真盤
            </h1>
```

Replace with:

```tsx
            <h1 className="mt-5 text-balance text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
              深井 青山公路 汀九買樓租樓{" "}
              <span className="whitespace-nowrap text-brand-bright">晉誠地產</span> ‧ 全部真盤
            </h1>
```

`text-balance` (Tailwind's `text-wrap: balance` utility) lets the browser choose where
to break across the available width instead of always breaking at the same fixed
point regardless of viewport size. `whitespace-nowrap` on the brand name keeps
"晉誠地產" from ever splitting mid-word if the balanced wrap lands between those
characters.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/styles.test.mjs`
Expected: PASS — 5 tests total, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx src/styles.test.mjs
git commit -m "fix(homepage): replace the hero headline's hard <br> with text-balance

text-wrap: balance lets the browser pick the break point per viewport
instead of always breaking at the same fixed spot; 晉誠地產 gets
whitespace-nowrap so it never splits mid-word."
```

---

## Task 4: Wire up `test:styles`

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the npm script**

```json
    "test:format": "bun test src/lib/format.test.ts",
    "test:layout": "bun test src/components/layout/layout.test.tsx",
    "test:media": "bun test src/components/media/AppImage.test.tsx",
    "test:styles": "node --test src/styles.test.mjs",
```

- [ ] **Step 2: Run the new script**

Run: `npm run test:styles`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 3: Confirm this plan didn't move the P0 ratchets**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx eslint src/styles.test.mjs src/routes/__root.tsx src/routes/index.tsx`
Expected: no new problems from this plan's edits.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(styles): wire up npm run test:styles"
```

---

## Verification (end to end)

1. `npm run test:styles` — 5 tests pass.
2. `npm run test:homepage` — still passes at the P0-baseline result (this plan touches
   `index.tsx`'s hero markup, not the homepage-copy contract tests' assertions — if
   `SiteHeader.contract.test.mjs` or `homepage-copy.contract.test.mjs` assert on the
   exact hero heading markup, re-check them specifically; they were not found to do so
   during this plan's research, but confirm before merging).
3. `npx tsc --noEmit` — still 0 errors.
4. `npx eslint .` — no new problems.
5. `npm run build` — still passes.
6. Manually load `/` at 375px, 768px, and 1440px widths and confirm: the hero headline
   wraps sensibly at every width (no orphaned single word, "晉誠地產" never splits),
   and the fonts still render correctly (open the Network tab and confirm the fonts
   CSS request now shows `Priority: Highest` / starts loading earlier than before this
   plan — compare against a checkout without this plan if unsure).
7. `git diff --stat` against the branch this was built on shows only `src/styles.css`,
   `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/styles.test.mjs`, and
   `package.json`.

**Remember before merging:** flag the draft bronze/warm-white/charcoal hex values for
client/design sign-off in the PR description — they are functional and WCAG-verified,
but not yet confirmed as the client's actual intended palette.
