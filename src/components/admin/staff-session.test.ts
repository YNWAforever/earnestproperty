import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  confirmFirstLoginChecklistFor,
  createStaffSessionStore,
  navRolesForStaffSession,
  staffSessionDenialCopy,
} from "./staff-session";
import type { StaffSession } from "@/lib/neon/admin-data.types";

const adminSession: StaffSession = {
  status: "ok",
  staffId: "11111111-1111-4111-8111-111111111111",
  email: "owner@example.test",
  name: "Owner",
  roles: ["admin"],
};

describe("staff session store", () => {
  test("a page that renders the shell can still read the session, with no provider around it", async () => {
    // Regression: the first version exposed the session through a React
    // context whose Provider sat INSIDE AdminShell. /admin/team reads the
    // session in the component that RENDERS AdminShell -- above the Provider
    // -- so it always got null, canManage was false for every admin, and
    // 連結帳戶 / 邀請成員 / 變更角色 disappeared from production.
    const store = createStaffSessionStore(async () => adminSession);
    await store.refresh("user-1");

    function Page() {
      const { session } = store.useStaffSession("user-1");
      const canManage = session?.status === "ok" && session.roles.includes("admin");
      return createElement("p", null, canManage ? "can-manage" : "read-only");
    }

    expect(renderToStaticMarkup(createElement(Page))).toContain("can-manage");
  });

  test("shares one in-flight lookup per user and drops a result for a user who signed out", async () => {
    let calls = 0;
    let resolveFetch: (value: StaffSession) => void = () => undefined;
    const store = createStaffSessionStore(() => {
      calls += 1;
      return new Promise<StaffSession>((resolve) => {
        resolveFetch = resolve;
      });
    });

    const first = store.refresh("user-1");
    const second = store.refresh("user-1");
    expect(calls).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ userId: "user-1", session: null, loading: true });

    store.reset();
    resolveFetch(adminSession);
    await Promise.all([first, second]);

    expect(store.getSnapshot()).toMatchObject({ userId: null, session: null, loading: false });
  });

  test("an older same-user lookup cannot replace the result of a new sign-in", async () => {
    const resolvers: Array<(value: StaffSession) => void> = [];
    const store = createStaffSessionStore(
      () => new Promise<StaffSession>((resolve) => resolvers.push(resolve)),
    );

    const oldLookup = store.refresh("user-1");
    store.reset();
    const newLookup = store.refresh("user-1");

    resolvers[1]!(adminSession);
    await newLookup;
    resolvers[0]!({ status: "denied", reason: "forbidden" });
    await oldLookup;

    expect(store.getSnapshot()).toMatchObject({
      userId: "user-1",
      session: adminSession,
      loading: false,
    });
  });

  test("a failed lookup leaves the session unknown rather than denied", async () => {
    const store = createStaffSessionStore(async () => {
      throw new Error("network");
    });

    expect(await store.refresh("user-1")).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ userId: "user-1", session: null, loading: false });
  });

  test("a re-check keeps the previous answer on screen until the new one arrives", async () => {
    let next: StaffSession = { status: "denied", reason: "staff-email-unverified" };
    const store = createStaffSessionStore(async () => next);
    await store.refresh("user-1");

    next = adminSession;
    const pending = store.refresh("user-1");
    expect(store.getSnapshot()).toMatchObject({ loading: true, session: { status: "denied" } });
    await pending;
    expect(store.getSnapshot().session).toEqual(adminSession);
  });
});

// A signed-in Neon Auth user who is not (yet) a bound staff member used to see
// the full admin shell with every page failing "你的帳戶沒有權限查看這項資料".
// The shell now names the actual reason so the member and the admin know what
// to do next.
describe("staffSessionDenialCopy", () => {
  test("unverified email asks for verification before staff binding", () => {
    const copy = staffSessionDenialCopy("staff-email-unverified");
    expect(copy.title).toContain("尚未連結");
    expect(copy.description).toContain("驗證");
    expect(copy.description).toContain("管理員");
    expect(copy.description).toContain("完成驗證後");
  });

  test("forbidden explains the account is not a staff record", () => {
    const copy = staffSessionDenialCopy("forbidden");
    expect(copy.title).toContain("職員");
    expect(copy.description).toContain("管理員");
  });

  test("unauthorized asks for a fresh sign-in", () => {
    const copy = staffSessionDenialCopy("unauthorized");
    expect(copy.description).toContain("重新登入");
  });
});

describe("navRolesForStaffSession", () => {
  test("a lookup still loading lists no links", () => {
    expect(navRolesForStaffSession(null, false)).toEqual([]);
  });

  test("a lookup that finished and failed keeps every link (the server still enforces)", () => {
    expect(navRolesForStaffSession(null, true)).toBeNull();
  });

  test("a denial lists no links and a resolved session lists its roles", () => {
    expect(navRolesForStaffSession({ status: "denied", reason: "forbidden" }, true)).toEqual([]);
    expect(navRolesForStaffSession(adminSession, true)).toEqual(["admin"]);
  });

  test("the hook reports a lookup as settled only once it has answered for this user", async () => {
    const store = createStaffSessionStore(async () => {
      throw new Error("down");
    });
    const seen: Array<{ settled: boolean }> = [];
    function Probe() {
      const { settled } = store.useStaffSession("user-1");
      seen.push({ settled });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(seen[0]?.settled).toBe(false);
    await store.refresh("user-1");
    renderToStaticMarkup(createElement(Probe));
    expect(seen[1]?.settled).toBe(true);
  });
});

describe("confirmFirstLoginChecklistFor", () => {
  function setup(current: { id: string | null }, confirm: () => Promise<void>) {
    const writes: string[] = [];
    const hides: number[] = [];
    return {
      writes,
      hides,
      run: (staffId: string) =>
        confirmFirstLoginChecklistFor({
          staffId,
          currentStaffId: () => current.id,
          confirm,
          cacheDone: (id) => writes.push(id),
          hidePanel: () => hides.push(1),
        }),
    };
  }

  test("caches and hides when the account is unchanged", async () => {
    const current = { id: "a" };
    const t = setup(current, async () => {});
    await t.run("a");
    expect(t.writes).toEqual(["a"]);
    expect(t.hides).toHaveLength(1);
  });

  test("an account switch during the save caches only under the captured id and keeps the new panel", async () => {
    const current = { id: "a" };
    const t = setup(current, async () => {
      current.id = "b";
    });
    await t.run("a");
    expect(t.writes).toEqual(["a"]);
    expect(t.hides).toHaveLength(0);
  });

  test("a failed save writes nothing and reports the error", async () => {
    const current = { id: "a" };
    const t = setup(current, async () => {
      throw new Error("x");
    });
    expect(await t.run("a")).toBe(false);
    expect(t.writes).toEqual([]);
    expect(t.hides).toHaveLength(0);
  });
});
