import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./site-branches.js", import.meta.url);

test("estate mapping wins over the district default", async () => {
  assert.equal(existsSync(moduleUrl), true, "site branch resolver must exist");
  const { SITE_BRANCHES, resolveBranchContact } = await import(moduleUrl);
  const fallback = { id: "general" };

  const contact = resolveBranchContact({
    branches: SITE_BRANCHES,
    fallback,
    estateSlug: "rhine-garden",
    districtSlug: "sham-tseng",
  });

  assert.equal(contact.id, "rhine");
});

test("estate and district mappings resolve every approved branch", async () => {
  assert.equal(existsSync(moduleUrl), true, "site branch resolver must exist");
  const { SITE_BRANCHES, resolveBranchContact } = await import(moduleUrl);
  const fallback = { id: "general" };

  for (const estateSlug of ["bellagio", "sea-crest-villa", "lido-garden"]) {
    assert.equal(
      resolveBranchContact({ branches: SITE_BRANCHES, fallback, estateSlug }).id,
      "lido",
    );
  }
  for (const estateSlug of ["rhine-garden", "sea-pearl-garden"]) {
    assert.equal(
      resolveBranchContact({ branches: SITE_BRANCHES, fallback, estateSlug }).id,
      "rhine",
    );
  }
  assert.equal(
    resolveBranchContact({
      branches: SITE_BRANCHES,
      fallback,
      estateSlug: "hong-kong-garden",
    }).id,
    "hong-kong-garden",
  );
  assert.equal(
    resolveBranchContact({ branches: SITE_BRANCHES, fallback, districtSlug: "sham-tseng" }).id,
    "lido",
  );
  assert.equal(
    resolveBranchContact({ branches: SITE_BRANCHES, fallback, districtSlug: "ting-kau" }).id,
    "hong-kong-garden",
  );
});

test("unknown and empty locations use the general contact fallback", async () => {
  assert.equal(existsSync(moduleUrl), true, "site branch resolver must exist");
  const { SITE_BRANCHES, resolveBranchContact } = await import(moduleUrl);
  const fallback = { id: "general", phone: "general-phone" };

  assert.equal(
    resolveBranchContact({
      branches: SITE_BRANCHES,
      fallback,
      estateSlug: "unknown-estate",
      districtSlug: "unknown-district",
    }),
    fallback,
  );
  assert.equal(resolveBranchContact({ branches: SITE_BRANCHES, fallback }), fallback);
});
