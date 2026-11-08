import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

import {
  TRACKING_CODE_PATTERN,
  planWebsiteLinks,
  websiteLinkCode,
  websitePlacementKey,
} from "./website-link-codes.mjs";

const root = process.cwd();
const dataUrl = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
// A data: module cannot resolve bare specifiers, so the one package import in
// link-batch-policy.ts is rewritten to its resolved file URL.
const zodUrl = pathToFileURL(createRequire(import.meta.url).resolve("zod")).href;

const listing = (publicListingNo, deal_type, candidate_count = 0, id = `id-${publicListingNo}`) => ({
  property_id: id,
  public_listing_no: publicListingNo,
  deal_type,
  candidate_count,
});

test("a readable code names the listing and the deal type", () => {
  assert.equal(websiteLinkCode("R037767", "sale"), "web-R037767-sale");
  assert.equal(websiteLinkCode("R037767", "rent"), "web-R037767-rent");
});

// The database check and trackedRedirect both enforce this pattern. Producing a
// code that fails it would create a link nobody can reach.
test("every generated code satisfies the pattern the database and redirect enforce", () => {
  for (const no of ["A034788", "T025711", "R037767", "B063697"]) {
    for (const deal of ["sale", "rent"]) {
      const code = websiteLinkCode(no, deal);
      assert.match(code, TRACKING_CODE_PATTERN);
      assert.ok(code.length >= 16, `${code} must be at least 16 characters`);
      assert.ok(code.length <= 64);
    }
  }
});

// A silently-truncated or mangled listing number would produce a code that looks
// fine but points at nothing, so both inputs are validated rather than trusted.
test("invalid listing numbers and deal types fail loudly", () => {
  assert.throws(() => websiteLinkCode("R037 767", "sale"), /WA_LINK_LISTING_NO_INVALID/);
  assert.throws(() => websiteLinkCode("", "sale"), /WA_LINK_LISTING_NO_INVALID/);
  assert.throws(() => websiteLinkCode(undefined, "sale"), /WA_LINK_LISTING_NO_INVALID/);
  assert.throws(() => websiteLinkCode("R037767", "lease"), /WA_LINK_DEAL_TYPE_INVALID/);
});

test("a listing number short enough to break the 16-character floor is rejected", () => {
  // "web-" + 4 + "-sale" = 13 characters, below the database minimum. The batch
  // importer would accept the row, so this floor has to be enforced here.
  assert.throws(() => websiteLinkCode("ABCD", "sale"), /WA_LINK_CODE_INVALID/);
});

// The batch importer reserves placements by this exact key. If the two formulas
// drifted, provisioning here would create a second placement for a listing the
// importer already considers reserved.
test("the placement key is byte-identical to what canonicalBatchRow produces", async () => {
  const policySource = transpile(
    readFileSync(join(root, "src/lib/whatsapp-enquiries/link-batch-policy.ts"), "utf8"),
  ).replace('from "zod"', `from "${zodUrl}"`);
  const { canonicalBatchRow } = await import(dataUrl(policySource));

  const channelId = "6a740a3869244a10a91325c1";
  const publicListingNo = "R037767";
  const dealType = "sale";
  const batch = canonicalBatchRow(
    {
      rowKey: "00000000-0000-4000-8000-000000000001",
      placementId: "website:primary",
      input: {
        placementSource: "website",
        entryPointType: "sales",
        // A sales placement must carry its offer context; the placement key
        // itself is derived from the listing number, not the property id.
        propertyId: "00000000-0000-4000-8000-000000000002",
        publicListingNo,
        dealType,
        enabled: true,
      },
    },
    channelId,
  );

  assert.equal(
    websitePlacementKey({ channelId, publicListingNo, dealType }),
    batch.placementKey,
  );
});

test("the placement key changes with every part of the identity", () => {
  const base = { channelId: "chan", publicListingNo: "R037767", dealType: "sale" };
  const key = websitePlacementKey(base);

  assert.match(key, /^[0-9a-f]{64}$/, "the column is a fixed 64-character key");
  assert.notEqual(websitePlacementKey({ ...base, channelId: "other" }), key);
  assert.notEqual(websitePlacementKey({ ...base, publicListingNo: "R037768" }), key);
  assert.notEqual(websitePlacementKey({ ...base, dealType: "rent" }), key);
  assert.throws(() => websitePlacementKey({ ...base, channelId: "" }), /WA_LINK_CHANNEL_REQUIRED/);
});

test("planning provisions only the listings that have no usable link", () => {
  const plan = planWebsiteLinks({
    channelId: "chan",
    listings: [
      listing("R037767", "sale", 0),
      listing("R037767", "rent", 0),
      listing("T025711", "sale", 1),
      listing("A034788", "rent", 2),
    ],
  });

  assert.equal(plan.create.length, 2);
  assert.deepEqual(
    plan.create.map((row) => row.code),
    ["web-R037767-sale", "web-R037767-rent"],
  );
  assert.equal(plan.skip, 1, "already covered");
  assert.equal(plan.ambiguous, 1, "more than one link is a human decision, not a bulk insert");
});

// Re-running must not create a second link for the same listing: after a run the
// coverage query reports 1 for that listing, so the next plan skips it.
test("planning is idempotent against its own output", () => {
  const first = planWebsiteLinks({
    channelId: "chan",
    listings: [listing("R037767", "sale", 0)],
  });
  assert.equal(first.create.length, 1);

  const second = planWebsiteLinks({
    channelId: "chan",
    listings: [listing("R037767", "sale", 1)],
  });
  assert.equal(second.create.length, 0);
  assert.equal(second.skip, 1);
});

test("a listing that would produce the same code twice fails instead of silently colliding", () => {
  assert.throws(
    () =>
      planWebsiteLinks({
        channelId: "chan",
        listings: [listing("R037767", "sale", 0), listing("R037767", "sale", 0, "other-id")],
      }),
    /WA_LINK_DUPLICATE_CODE/,
  );
});

test("candidate counts arriving as strings from pg are handled", () => {
  const plan = planWebsiteLinks({
    channelId: "chan",
    listings: [
      { property_id: "a", public_listing_no: "R037767", deal_type: "sale", candidate_count: "0" },
      { property_id: "b", public_listing_no: "R037768", deal_type: "sale", candidate_count: "1" },
    ],
  });
  assert.equal(plan.create.length, 1);
  assert.equal(plan.skip, 1);
});

// Keeps the module honest about the file it is used from.
test("the code module has no database or request dependency", () => {
  const source = readFileSync(join(root, "scripts/whatsapp/website-link-codes.mjs"), "utf8");
  assert.doesNotMatch(source, /from "pg"/);
  assert.doesNotMatch(source, /process\.env/);
});

// pathToFileURL is imported so the transpiled module URL helper above stays a
// single implementation; reference it once to keep the import meaningful.
assert.ok(typeof pathToFileURL === "function");
