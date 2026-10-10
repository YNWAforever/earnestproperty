// FX-13 Task 2 (L-04): the old site's search URLs looked like
// /property/b<estate name>$. They now land on /property/$listingNo, which
// only tries them after the listing lookup misses (see
// property.listing-detail.contract.test.mjs). Pure module, loaded directly
// under Node's native type stripping.
import assert from "node:assert/strict";
import test from "node:test";

import { estateRegistry } from "../content/estate-registry.ts";
import { resolveOldSearchCode } from "./old-search-code.ts";

const BELLAGIO = { href: "/estate/bellagio", status: 301 };

test("old search code b<name>$ maps a registry estate to its page", () => {
  assert.deepEqual(resolveOldSearchCode("b碧堤半島$"), BELLAGIO);
  assert.deepEqual(resolveOldSearchCode("b碧堤$"), BELLAGIO, "alias");
  assert.deepEqual(resolveOldSearchCode("bBellagio$"), BELLAGIO, "English name");
  assert.deepEqual(resolveOldSearchCode("bbellagio$"), BELLAGIO, "case-insensitive");
  assert.deepEqual(resolveOldSearchCode("b 浪翠園 $"), {
    href: "/estate/sea-crest-villa",
    status: 301,
  });
});

test("unknown estate name goes to a keyword search", () => {
  assert.deepEqual(resolveOldSearchCode("b某某花園$"), {
    href: "/listings?keyword=%E6%9F%90%E6%9F%90%E8%8A%B1%E5%9C%92",
    status: 302,
  });
});

test("real listing numbers are never treated as an old search code", () => {
  for (const listingNo of [
    "A056377",
    "B054645",
    "B050052",
    "b054645",
    "C-018613",
    "C 018613",
    "T029514",
    "EP11001",
    "EP-1201",
    "A056377-R",
    "B054645$",
  ]) {
    assert.equal(resolveOldSearchCode(listingNo), null, listingNo);
  }
});

test("only the trailing-$ shape matches", () => {
  assert.equal(resolveOldSearchCode("b碧堤半島"), null);
  assert.equal(resolveOldSearchCode("b$"), null);
  assert.equal(resolveOldSearchCode("b   $"), null);
  assert.equal(resolveOldSearchCode("x碧堤$"), null);
  assert.equal(resolveOldSearchCode(`b${"花".repeat(41)}$`), null, "41-character name");
  assert.notEqual(resolveOldSearchCode(`b${"花".repeat(40)}$`), null, "40 characters still match");
});

test("every estate target has a page", () => {
  const withPage = estateRegistry.filter((entry) => entry.hasPage);
  assert.ok(withPage.length > 0);
  for (const entry of withPage) {
    assert.equal(
      resolveOldSearchCode(`b${entry.nameZh}$`)?.href,
      `/estate/${entry.slug}`,
      entry.nameZh,
    );
  }
});
