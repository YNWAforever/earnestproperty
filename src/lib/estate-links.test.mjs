// FX-13 L-05: production logs show hits on /estate/null. Every estate link on
// the listing page and the estate directory now goes through estatePath, which
// refuses an empty slug. Pure module, loaded under Node's native type stripping.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { estateRegistry } from "../content/estate-registry.ts";
import { estatePath } from "./estate-links.ts";

// Whitespace is collapsed to single spaces so that a Prettier reflow does not
// break the source guards below; only the tokens and their order matter.
const flatten = (source) => source.replace(/\s+/g, " ");
const listingSource = flatten(
  await readFile(new URL("../routes/property.$listingNo.tsx", import.meta.url), "utf8"),
);
const directorySource = flatten(
  await readFile(new URL("../components/site/EstateDirectory.tsx", import.meta.url), "utf8"),
);

test("estatePath refuses an empty or null slug", () => {
  for (const slug of [null, undefined, "", "  ", "null", "undefined"]) {
    assert.equal(estatePath(slug), null, JSON.stringify(slug));
  }
  assert.equal(estatePath("bellagio"), "/estate/bellagio");
});

test("estatePath refuses a padded slug, so the guard and the raw-slug link agree", () => {
  // Callers link with the raw estate.slug (Link params, encodeURIComponent).
  // A padded slug would pass a trimming guard and then link somewhere else.
  for (const slug of [" bellagio ", " bellagio", "bellagio ", "\tbellagio\n", " null "]) {
    assert.equal(estatePath(slug), null, JSON.stringify(slug));
  }
});

test("estatePath keeps every real registry slug's href unchanged", () => {
  // The breadcrumb and JSON-LD crumb used `/estate/${estate.slug}` before;
  // for a real slug the guarded href must be byte-identical.
  for (const { slug } of estateRegistry) {
    assert.equal(estatePath(slug), `/estate/${slug}`, slug);
  }
});

test("the listing page builds estate links only through estatePath", () => {
  assert.ok(!listingSource.includes("`/estate/${estate.slug}`"));
  assert.ok(!listingSource.includes("`${SITE_URL}/estate/${estate.slug}`"));

  // The 「查看屋苑詳情 →」 link sits inside a block that tests estatePath(, and
  // keeps its route, params and text.
  const linkAt = listingSource.indexOf('to="/estate/$slug"');
  assert.ok(linkAt > 0, "listing page still links to the estate page");
  const guardAt = listingSource.lastIndexOf("estatePath(", linkAt);
  assert.ok(guardAt > 0, "estate link is guarded by estatePath");
  assert.equal(
    listingSource.slice(guardAt, linkAt),
    'estatePath(estate.slug) && ( <div className="mt-4"> <Link ',
  );
  assert.match(
    listingSource.slice(linkAt, linkAt + 200),
    /^to="\/estate\/\$slug" params=\{\{ slug: estate\.slug \}\} [^>]*> 查看屋苑詳情 → <\/Link>/,
  );

  // Visible breadcrumb and JSON-LD crumb: present only with an estate href,
  // with the same label and href as before for a real slug.
  for (const snippet of [
    "const estateHref = estatePath(estate?.slug);",
    "...(estate && estateHref ? [{ label: estate.name_zh, href: estateHref }] : [])",
    "item: `${SITE_URL}${estateHref}`",
    "position: estateHref ? 4 : 3",
  ]) {
    assert.ok(listingSource.includes(snippet), snippet);
  }
});

test("the estate directory links an estate card only through estatePath", () => {
  const hrefAt = directorySource.indexOf("href={`/estate/");
  assert.ok(hrefAt > 0, "directory still links estate cards");
  assert.equal(directorySource.indexOf("href={`/estate/", hrefAt + 1), -1, "one estate href");
  const guardAt = directorySource.lastIndexOf("estatePath(estate.slug) ? (", hrefAt);
  assert.ok(guardAt > 0, "the estate card link is guarded by estatePath");
  assert.equal(directorySource.slice(guardAt, hrefAt), "estatePath(estate.slug) ? ( <SiteLink ");
});
