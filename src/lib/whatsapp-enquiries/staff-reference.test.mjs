import test from "node:test";
import assert from "node:assert/strict";
import { resolveStaffReference, hasUntrustedStaffOverride } from "./staff-reference.ts";
const at = "2026-09-12T10:00:00Z";
const maps = [
  {
    id: "m1",
    namespace: "28hse/account540",
    externalReference: "001-A",
    staffId: "A",
    version: 1,
    validFrom: "2026-09-01T00:00:00Z",
    validUntil: null,
    verified: true,
  },
  {
    id: "m2",
    namespace: "other/account",
    externalReference: "001-A",
    staffId: "B",
    version: 1,
    validFrom: "2026-09-01T00:00:00Z",
    validUntil: null,
    verified: true,
  },
];
test("NT-01 saved requested A wins over property owner B", () =>
  assert.equal(
    resolveStaffReference({ requestedStaffId: "A", propertyOwnerId: "B" }, maps, at).staffId,
    "A",
  ));
test("NT-02 exact account namespace and significant zeros", () => {
  assert.equal(
    resolveStaffReference({ namespace: "28hse/account540", externalReference: "001-A" }, maps, at)
      .staffId,
    "A",
  );
  assert.equal(
    resolveStaffReference({ namespace: "other/account", externalReference: "001-A" }, maps, at)
      .staffId,
    "B",
  );
  assert.equal(resolveStaffReference({ externalReference: "001-A" }, maps, at).status, "review");
  assert.equal(
    resolveStaffReference({ namespace: "28hse/account540", externalReference: "1-A" }, maps, at)
      .status,
    "review",
  );
});
test("NT-03 conflicting saved identities and customer hints never override", () => {
  assert.equal(
    resolveStaffReference(
      { requestedStaffId: "B", namespace: "28hse/account540", externalReference: "001-A" },
      maps,
      at,
    ).status,
    "review",
  );
  assert.equal(hasUntrustedStaffOverride("staff_ref=B"), true);
  assert.equal(hasUntrustedStaffOverride("hello"), false);
});
test("NT-22 historical validity and overlap ambiguity fail closed", () => {
  assert.equal(
    resolveStaffReference(
      { namespace: maps[0].namespace, externalReference: "001-A" },
      [{ ...maps[0], validUntil: at }],
      at,
    ).status,
    "review",
  );
  assert.equal(
    resolveStaffReference(
      { namespace: maps[0].namespace, externalReference: "001-A" },
      [maps[0], { ...maps[0], id: "x", staffId: "B" }],
      at,
    ).status,
    "review",
  );
});
