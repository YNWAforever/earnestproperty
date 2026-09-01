import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./index.tsx", import.meta.url), "utf8");

test("homepage uses Chinese-only large headings for the requested sections", () => {
  for (const title of ["精選筍盤", "精選樓盤影片", "深井核心屋苑", "為何選晉誠"]) {
    assert.match(source, new RegExp(`title=\\"${title}\\"`));
  }

  for (const title of [
    "Featured Listings",
    "Featured Property Videos",
    "Sham Tseng Signature Estates",
    "Why Earnest Property",
  ]) {
    assert.doesNotMatch(source, new RegExp(`title=\\"${title}\\"`));
  }
});

test("homepage keeps the featured video section in the requested order", () => {
  assert.match(source, /FEATURED LISTINGS[\s\S]*精選樓盤影片/);
});

test("section headers only render an eyebrow when one is supplied", () => {
  assert.match(source, /eyebrow\?: string/);
  assert.match(source, /eyebrow \? \(/);
});

test("the future 青山公路／汀九屋苑 block is not added by this slice", () => {
  assert.doesNotMatch(source, /青山公路及汀九屋苑/);
});

// P3 Task 8 -- the homepage used to repeat its core trust/credibility claims
// (local expertise, licensed, real listings, fast response) across five
// separate spots: hero subhead, WHY US tiles, agent-team-preview tagline,
// about-preview paragraph, and Organization JSON-LD. Only the last two prose
// repeats (agent-team-preview tagline, about-preview paragraph) were cut --
// hero subhead, WHY US tiles, and the JSON-LD were deliberately kept. See
// docs/ROUTE_FUNCTION_PARITY.md for the full before/after/why log.
test("ABOUT PREVIEW no longer restates the local-expertise paragraph", () => {
  assert.doesNotMatch(source, /我哋係一間以深井、青山公路為核心的本地地產代理/);
  assert.doesNotMatch(source, /對每個屋苑座向、樓層景觀、車位、會所和近期叫價都有第一手理解/);
  // The section still has a teaser line and its existing /about CTA -- this
  // is a consolidation, not a deletion of the whole section.
  assert.match(source, /ABOUT PREVIEW/);
  assert.match(source, /<Link to="\/about">/);
});

test("AGENT TEAM PREVIEW no longer restates the local-market/instant-WhatsApp tagline", () => {
  assert.doesNotMatch(source, /熟悉深井、青山公路及汀九市場，直接 WhatsApp 查詢。/);
  // The section still has its own CTA and renders the agent cards.
  const agentPreview = source.slice(
    source.indexOf("{/* AGENT TEAM PREVIEW */}"),
    source.indexOf("{/* MARKET INFO */}"),
  );
  assert.match(agentPreview, /查看全部代理/);
  assert.match(agentPreview, /agents\.map/);
});

test("featured-listings PropertyCard shows a FreshnessStamp", () => {
  assert.match(source, /import \{ FreshnessStamp \} from "@\/components\/layout\/FreshnessStamp";/);
  const propertyCard = source.slice(source.indexOf("function PropertyCard("));
  assert.match(propertyCard, /<FreshnessStamp updatedAt=\{property\.last_seen_at\}/);
});

test("featured-listings empty state uses the shared EmptyState component", () => {
  assert.match(source, /import \{ EmptyState \} from "@\/components\/layout\/EmptyState";/);
  const featuredSection = source.slice(
    source.indexOf("{/* FEATURED LISTINGS"),
    source.indexOf("{/* FEATURED VIDEOS"),
  );
  assert.match(featuredSection, /<EmptyState/);
});

// P3 plan acceptance criterion: CoreEstateGrid already correctly renders an
// em-dash for missing avg PSF / listing-count data, never "0" -- this is a
// regression guard, not new behavior (nothing above this test changes
// CoreEstateGrid).
test("CoreEstateGrid renders an em-dash, never 0, for missing avg PSF or listing count", () => {
  const gridSource = source.slice(
    source.indexOf("function CoreEstateGrid("),
    source.indexOf("function SectionHeader("),
  );
  assert.match(
    gridSource,
    /psf === null \|\| psf === undefined \|\| !Number\.isFinite\(psf\)\s*\?\s*"—"/,
  );
  assert.match(gridSource, /listingCount === null \|\| listingCount === undefined\s*\?\s*"—"/);
});

// 2026-09-01 17-estate expansion: estate-registry.ts's hasPage:true no longer
// implies published -- 17 of the 22 registry entries have hasPage:true while
// staying published=false in Neon until a human clears each one. A card must
// only link (and only count toward the grid at all) once its live DB row
// actually exists in `estates`, or the grid ships a link to a page that
// 404s. This is a real regression this repo shipped and fixed once already
// (see design/estate-expansion-17's final review) -- guarding it here so it
// can't silently return.
test("CoreEstateGrid gates both grid membership and card linking on a live DB row, not hasPage alone", () => {
  const gridSource = source.slice(
    source.indexOf("function CoreEstateGrid("),
    source.indexOf("function SectionHeader("),
  );
  assert.match(
    gridSource,
    /staticEstates\.filter\(\s*\(estate\) => estate\.hasPage && live\.has\(estate\.slug\)/,
    "linkableEstates must require both hasPage and a live DB row, not hasPage alone",
  );
  assert.doesNotMatch(
    gridSource,
    /staticEstates\.filter\(\(estate\) => estate\.hasPage\)/,
    "must not regress to gating the grid on hasPage alone",
  );
  assert.match(
    gridSource,
    /return dbRow \? \(/,
    "the card's <Link> wrapper must be gated on dbRow, not estate.hasPage",
  );
});
