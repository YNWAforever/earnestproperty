import assert from "node:assert/strict";
import test from "node:test";
import { requiresDocumentIsolation } from "./route-isolation.ts";
test("private boundary uses original document classification even after history changes", () => {
  assert.equal(requiresDocumentIsolation("/mortgage", "/admin/leads"), true);
  assert.equal(requiresDocumentIsolation("/mortgage", "/auth/login"), true);
  assert.equal(requiresDocumentIsolation("/account/profile", "/contact"), true);
  assert.equal(requiresDocumentIsolation("/mortgage", "/contact"), false);
  assert.equal(requiresDocumentIsolation("/admin", "/account/profile"), false);
  assert.equal(requiresDocumentIsolation("/mortgage", "/%61dmin"), true);
  assert.equal(requiresDocumentIsolation("/mortgage", "/admin", true), false);
});
