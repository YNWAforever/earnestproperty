import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("schema.ts exports the builders the audit's structured-data gaps need", () => {
  const source = read("src/lib/schema.ts");
  assert.match(source, /export function agentPersonSchema/);
  assert.match(source, /"@type": \["Person", "RealEstateAgent"\]/);
  assert.match(source, /export function itemListSchema/);
  assert.match(source, /"@type": "ItemList"/);
  assert.match(source, /export function branchLocalBusinessSchema/);
  assert.match(source, /export function videoObjectSchema/);
  assert.match(source, /"@type": "VideoObject"/);
  assert.match(source, /export function organizationSchema/);
  assert.match(source, /identifier: "C-018613"/);
});

// P7a: Organization/RealEstateAgent JSON-LD used to be homepage-only --
// moved sitewide into __root.tsx (gated to public pages the same way
// SiteHeader/SiteFooter already are) so every crawled page carries the
// site's identity, not just "/".
test("organization JSON-LD is rendered sitewide from __root.tsx, not just the homepage", () => {
  const root = read("src/routes/__root.tsx");
  assert.match(root, /organizationSchema\(\)/);
  assert.match(root, /showSiteChrome && \(/, "should be gated to public pages, not /admin");

  const home = read("src/routes/index.tsx");
  assert.doesNotMatch(
    home,
    /"@type": "RealEstateAgent"/,
    "the inline homepage-only block should be removed now that it's sitewide",
  );
});

// Article on blog posts and listing-level Offer schema already existed before
// this audit (the audit was stale on those two) -- this only checks the gaps
// it actually named: Person/RealEstateAgent on agent pages, ItemList on
// /agents + /listings, LocalBusiness per branch on /contact, VideoObject on
// /videos.
test("every named structured-data gap is wired into its route", () => {
  const agentDetail = read("src/routes/agents_.$slug.tsx");
  assert.match(agentDetail, /agentPersonSchema\(\{/);
  assert.match(agentDetail, /"@context": "https:\/\/schema\.org", \.\.\.personSchema/);

  const agentsList = read("src/routes/agents.tsx");
  assert.match(agentsList, /itemListSchema\(\{/);

  const listings = read("src/routes/listings.tsx");
  assert.match(listings, /itemListSchema\(\{/);
  assert.match(listings, /rows\.map\(\(row\) => \(\{/);

  const contact = read("src/routes/contact.tsx");
  assert.match(contact, /branchLocalBusinessSchema\(\{/);
  assert.match(contact, /SITE_BRANCHES\.map\(\(branch\) =>/);

  const videos = read("src/routes/videos.tsx");
  assert.match(videos, /videoObjectSchema\(\{/);
  // Matches both the JSX-prop and object-property forms. The schema moved out of
  // the card and into a block rendered once for the whole catalogue, so pinning
  // the old `uploadDate={video.created_at}` spelling would fail on a refactor
  // that kept the wiring perfectly intact.
  assert.match(videos, /uploadDate[:=]\s*\{?\s*video\.created_at/);
  // DR-6: structured data for content the page doesn't render is misleading to
  // crawlers and inflates payload for no benefit, so the schema block takes the
  // same paged/filtered lists as the visible card grids -- not the raw,
  // unbounded loader data.
  assert.doesNotMatch(
    videos,
    /<AllVideoSchemas[\s\S]*?cmsVideos=\{cmsVideos\}[\s\S]*?listingVideos=\{listingVideos\}/,
    "AllVideoSchemas must not receive the raw, unbounded loader lists",
  );
  assert.match(
    videos,
    /<AllVideoSchemas[\s\S]*?cmsVideos=\{visibleCmsVideos\}[\s\S]*?listingVideos=\{matchingListingVideos\}/,
    "AllVideoSchemas must receive the rendered/filtered subset",
  );
});

// jsonLdScript's own behaviour is asserted in schema.test.ts (bun). This is the
// cross-file half: a raw JSON.stringify reintroduced in ANY route's
// dangerouslySetInnerHTML is a stored-XSS sink, and the helper only protects
// the call sites that actually use it. Scanning every route means a new page
// copy-pasting the old pattern fails here rather than shipping.
test("no route embeds dangerouslySetInnerHTML content via raw JSON.stringify", () => {
  const offenders = [];

  for (const entry of readdirSync("src/routes", { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx$/.test(entry.name)) continue;
    const source = read(`src/routes/${entry.name}`);
    if (/__html:\s*JSON\.stringify\(/.test(source)) offenders.push(entry.name);
  }

  assert.deepEqual(
    offenders,
    [],
    `Use jsonLdScript() from @/lib/schema instead of JSON.stringify inside ` +
      `dangerouslySetInnerHTML. Offending route(s): ${offenders.join(", ")}`,
  );
});
