import { describe, expect, test } from "bun:test";

import { unwrapStaffAccessResponse } from "./admin-data";

// Proves the fix for the framework bug the coordinator found: TanStack Start
// does not surface a thrown Response from a server function handler as a
// rejected promise on the client -- it resolves with the Response object
// (see the doc comment on unwrapStaffAccessResponse in admin-data.ts for the
// exact trace through @tanstack/start-server-core / start-client-core).
//
// This is a unit test against the wrapper with a stubbed raw Response, not an
// end-to-end drive of the installed serverFnFetcher: createServerFn's
// client/server split -- and therefore the exact resolve-not-reject behaviour
// being tested here -- only exists after Vite's build-time macro transform
// splits `.handler(fn)` into an extractedFn/serverFn pair. Calling the
// `*Server` stubs this file exports directly, outside that build, collapses
// extractedFn and serverFn back into the same function and would just run the
// handler in-process -- which does NOT reproduce the bug (a thrown Response
// propagates as a normal rejection when called that way), so it would not be
// a meaningful test of this fix even though it looks more "end-to-end". The
// value in this test is entirely in the conversion logic, exercised directly
// against exactly the kind of value the real framework hands back.
describe("unwrapStaffAccessResponse", () => {
  test("converts a resolved raw Response carrying a known decision reason into a thrown Error with the mapped zh-HK message", async () => {
    const resolved = Promise.resolve(new Response("last-admin", { status: 400 }));
    await expect(unwrapStaffAccessResponse(resolved)).rejects.toThrow(/唯一的管理員/);
  });

  test("maps every decideStaffRoleChange / decideStaffDeactivation reason and requireStaffAccess status", async () => {
    const cases: Array<[string, RegExp]> = [
      ["not-admin", /管理員可以進行此操作/],
      ["self-admin-removal", /請由另一位管理員代為處理/],
      ["self", /請由另一位管理員代為處理/],
      ["last-admin", /唯一的管理員/],
      ["protected-account", /ADMIN_BOOTSTRAP_EMAILS/],
      ["successor-required", /先選擇接手人/],
      ["successor-is-target", /接手人不能是同一位同事/],
      ["Unauthorized", /重新登入/],
      ["Forbidden", /沒有權限/],
    ];

    for (const [reason, expected] of cases) {
      const resolved = Promise.resolve(new Response(reason, { status: 400 }));
      let caught: unknown;
      try {
        await unwrapStaffAccessResponse(resolved);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(expected);
    }
  });

  // The critical regression this whole fix exists to prevent: a rejected
  // mutation must never resolve successfully and be reported to the caller
  // as one.
  test("never resolves for a rejected mutation, even though the framework hands back a 2xx-shaped Promise.resolve", async () => {
    const resolved = Promise.resolve(new Response("last-admin", { status: 400 }));
    await expect(unwrapStaffAccessResponse(resolved)).rejects.toBeInstanceOf(Error);
  });

  test("does not swallow an unmapped body -- surfaces it verbatim rather than a generic message", async () => {
    const resolved = Promise.resolve(new Response("Staff member not found.", { status: 404 }));
    await expect(unwrapStaffAccessResponse(resolved)).rejects.toThrow("Staff member not found.");
  });

  test("falls back to a status-carrying message when the body is empty", async () => {
    const resolved = Promise.resolve(new Response("", { status: 409 }));
    await expect(unwrapStaffAccessResponse(resolved)).rejects.toThrow(/409/);
  });

  test("passes a normal resolved value straight through unchanged", async () => {
    const value = { ok: true as const, roles: ["admin"] as const };
    await expect(unwrapStaffAccessResponse(Promise.resolve(value))).resolves.toBe(value);
  });

  test("a genuine rejection (a real network/thrown Error, not a resolved Response) still propagates", async () => {
    const rejected = Promise.reject(new Error("network down"));
    await expect(unwrapStaffAccessResponse(rejected)).rejects.toThrow("network down");
  });
});
