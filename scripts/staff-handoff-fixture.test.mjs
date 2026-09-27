import assert from "node:assert/strict";
import test from "node:test";
import {
  validateStaffHandoffFixture,
  validateStaffHandoffManifest,
} from "./staff-handoff-fixture.mjs";

const exists = () => true;
const base = new URL("https://staging.example.test");
const fixture = {
  synthetic: true,
  targetKind: "isolated-staging",
  agentAState: "a.json",
  agentBState: "b.json",
  viewerState: "viewer.json",
  url: "https://staging.example.test/admin/my-handoffs",
  staleUrl: "https://staging.example.test/admin/my-handoffs?status=all",
  firstNotificationId: "synthetic-1",
  secondNotificationId: "synthetic-2",
  staleNotificationId: "synthetic-3",
  requestedName: "Test colleague",
};
test("handoff fixture accepts only an isolated same-origin prepared-state target", () => {
  assert.equal(
    validateStaffHandoffFixture(base.href, "fixture.json", exists).base.origin,
    base.origin,
  );
  assert.equal(validateStaffHandoffManifest(fixture, base, exists).synthetic, true);
  assert.throws(
    () => validateStaffHandoffManifest({ ...fixture, synthetic: false }, base, exists),
    /isolated/,
  );
  assert.throws(
    () =>
      validateStaffHandoffManifest(
        { ...fixture, url: "https://production.example.test/admin" },
        base,
        exists,
      ),
    /origin/,
  );
  assert.throws(
    () => validateStaffHandoffManifest({ ...fixture, agentAState: "" }, base, exists),
    /storageState/,
  );
  assert.throws(
    () =>
      validateStaffHandoffManifest(
        { ...fixture, secondNotificationId: "synthetic-1" },
        base,
        exists,
      ),
    /distinct/,
  );
});
