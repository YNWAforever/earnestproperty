import { expect, test } from "bun:test";

import { safeAdminRedirect } from "./safe-redirect";

test("admin paths are preserved", () => {
  expect(safeAdminRedirect("/admin")).toBe("/admin");
  expect(safeAdminRedirect("/admin/whatsapp")).toBe("/admin/whatsapp");
  expect(safeAdminRedirect("/admin/leads?stage=new&lead=abc")).toBe(
    "/admin/leads?stage=new&lead=abc",
  );
  expect(safeAdminRedirect("/admin?tab=faqs")).toBe("/admin?tab=faqs");
});

test("off-site destinations are discarded, not repaired", () => {
  for (const hostile of [
    "https://evil.example/admin",
    "http://evil.example",
    // Protocol-relative: a browser treats this as absolute.
    "//evil.example/admin",
    "/\\evil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
  ]) {
    expect(safeAdminRedirect(hostile)).toBe("/admin");
  }
});

test("in-site but non-admin destinations fall back", () => {
  // The parameter exists only to return staff to the admin page they asked for.
  expect(safeAdminRedirect("/")).toBe("/admin");
  expect(safeAdminRedirect("/contact")).toBe("/admin");
  // Prefix-matching must not be fooled by a lookalike public route.
  expect(safeAdminRedirect("/administrator-secrets")).toBe("/admin");
});

test("missing or malformed input falls back", () => {
  expect(safeAdminRedirect(undefined)).toBe("/admin");
  expect(safeAdminRedirect(null)).toBe("/admin");
  expect(safeAdminRedirect(42)).toBe("/admin");
  expect(safeAdminRedirect("")).toBe("/admin");
  expect(safeAdminRedirect("   ")).toBe("/admin");
  expect(safeAdminRedirect("admin/leads")).toBe("/admin");
});
