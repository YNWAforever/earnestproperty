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
  assert.match(videos, /uploadDate=\{video\.created_at\}/);
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
