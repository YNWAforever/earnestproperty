# Route Function Parity

A living log of content deliberately shortened, consolidated, or removed from a
route as part of the frontend revamp (`docs/superpowers/plans/2026-08-28-frontend-revamp.md`
and its phase plans). Each entry exists so a future reader can tell "this
content is gone because it was redundant" from "this content is missing by
accident" — every row names what was there before, what replaced it, and why,
so a later phase does not silently re-add the same repetition.

This file is intended to be **appended to**, not rewritten, by every phase
(P4 onward) that trims or consolidates route content. Add a row per section
touched; do not delete prior rows even if a later phase further edits the same
section — add a new row instead so the history stays intact.

## Format

| Phase | Route | Section | Before | After | Why |
| ----- | ----- | ------- | ------ | ----- | --- |

- **Phase** — the plan/task that made the change (e.g. `P3 Task 8`).
- **Route** — the file under `src/routes/` (or component) that changed.
- **Section** — the JSX section/comment-block name in that file.
- **Before** — one-line description of what was there (not a full copy-paste).
- **After** — one-line description of what replaced it.
- **Why** — the reason, usually "duplicated trust/credibility copy also stated
  in section X" or similar.

## Log

| Phase | Route | Section | Before | After | Why |
| ----- | ----- | ------- | ------ | ----- | --- |
| P3 Task 8 | `src/routes/index.tsx` | ABOUT PREVIEW | H2 headline ("深井、青山公路物業專家，全部真盤、即時回覆、持牌可靠") restating the licensed/real-listings/fast-response claims, plus a 2-sentence paragraph repeating the same local-expertise/first-hand-knowledge claim already made in the hero subhead and WHY US tiles. | One-line teaser H2 ("想知多啲晉誠點解咁熟深井、青山公路？") that invites a click through to `/about` instead of restating the claims; paragraph removed entirely. CTA button to `/about` unchanged. | This was 1 of 5 repeats (hero subhead, WHY US tiles, agent-team-preview tagline, about-preview paragraph, Organization JSON-LD) of the same "local expertise / licensed / real listings / fast response" claims identified in the P3 plan's ground-truth research. `/about` already exists as the full page for this detail, so the homepage preview only needs to earn the click, not restate the pitch. |
| P3 Task 8 | `src/routes/index.tsx` | AGENT TEAM PREVIEW | `SectionHeader`'s `desc` prop carried a tagline sentence ("熟悉深井、青山公路及汀九市場，直接 WhatsApp 查詢。") restating the local-expertise and instant-WhatsApp claims. | `desc` prop removed; section now shows only the eyebrow + title + the existing "查看全部代理" CTA + the agent card grid. | Same repeated-claims issue as above — this was the 3rd of 5 identified repeats. The agent cards themselves (real photos, names, job titles) already demonstrate "real, licensed people," so the prose restating it added nothing the cards don't already show. |
| P3 Task 8 | `src/routes/index.tsx` | FEATURED LISTINGS (empty state) | Ad-hoc `<p>` text ("暫時未有精選放盤，請稍後再試。") with no action for the visitor to take. | Shared `EmptyState` component (`src/components/layout/EmptyState.tsx`, P1) with an icon, title, description, and a WhatsApp-inquiry action button. | P1 shipped a shared `EmptyState` component that had zero production call sites anywhere in the app; this section's ad-hoc text was a direct candidate to swap in. Adding an action also gives the visitor a next step instead of a dead end, consistent with the master plan's "zero-results always offers a next action" principle applied elsewhere (P3 Task 5's `/listings` notify-me form). |

### Not changed (checked, no action needed)

| Route | Section | Note |
| ----- | ------- | ---- |
| `src/routes/index.tsx` | FEATURED VIDEOS (empty state) | Section is hidden entirely (`homeVideos.length > 0 ? … : null`) when there is nothing to show — no ad-hoc placeholder text exists to swap for `EmptyState`. Matches this repo's established "hide, don't show an empty label" convention (see `CoreEstateGrid`'s handling of estates with no detail page). |
| `src/routes/index.tsx` | `CoreEstateGrid` KPI cards | Already correctly renders an em-dash (`—`) rather than `0` when `avg_saleable_psf` or the estate's listing count is missing. No code change; a regression test (`src/routes/homepage-copy.contract.test.mjs`) was added to lock this in per the P3 plan's acceptance criterion. |
| `src/routes/index.tsx` | WHY US tiles | Kept as-is — most information-dense single block of the 5 repeat spots; the plan explicitly calls out keeping this one. |
| `src/routes/index.tsx` | Hero subhead | Kept as-is — sets first-impression context; the plan explicitly calls out keeping this one. |
| `src/routes/index.tsx` | Organization JSON-LD | Kept as-is — structured data, not visible copy, explicitly out of scope for the length cut. |
| `src/routes/index.tsx` | Hero CTAs (`認識代理團隊` → `/agents`, `睇最新市場資訊` → `/blog`) | Two buttons in one section, plus a search form already demoted to "a small optional entry point" (see the `HERO` comment at `index.tsx:202`) by the earlier `2026-08-16-nav-copy-hero-density-design.md` pass, which the master plan explicitly protects as an "already implemented baseline — don't redo it" (`2026-08-28-frontend-revamp.md:363`) — so the hero itself was out of scope here. Separately, `/agents` is also reached from the AGENT TEAM PREVIEW section's own CTA; kept both on the judgment that they're genuinely different entry points (hero: "meet the team" as a general trust signal reached in one click from the top of the page; agent-team-preview: "here are the actual people" reached after the visitor has already seen listings/estates/why-us content) rather than true duplication. |
