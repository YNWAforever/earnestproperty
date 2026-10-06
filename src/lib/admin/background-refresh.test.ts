import { describe, expect, test } from "bun:test";

import { ServerFnResponseError } from "@/lib/neon/server-fn-response";

import {
  BACKGROUND_READ_ROLES,
  canApplyBackgroundRead,
  createBackgroundReadGate,
  errorAfterBackgroundListSuccess,
  isAuthorizationRefusal,
  rowForOpenPanel,
} from "./background-refresh";

describe("canApplyBackgroundRead", () => {
  const started = { requestId: 4, cursor: null };

  test("applies when no user read started or is running since the poll began", () => {
    expect(canApplyBackgroundRead(started, { ...started, userReadInFlight: false })).toBe(true);
    const onOlderPage = { requestId: 4, cursor: "older" };
    expect(canApplyBackgroundRead(onOlderPage, { ...onOlderPage, userReadInFlight: false })).toBe(
      true,
    );
  });

  test("drops the answer once a user read (重新整理) has started since", () => {
    // The user read took the next request id; the poll never bumps it, so the user read keeps
    // ownership of the loading flag and its own answer.
    expect(
      canApplyBackgroundRead(started, { requestId: 5, cursor: null, userReadInFlight: true }),
    ).toBe(false);
    // ...and still drops it after that user read has finished: its answer is newer.
    expect(
      canApplyBackgroundRead(started, { requestId: 5, cursor: null, userReadInFlight: false }),
    ).toBe(false);
  });

  test("drops the answer while a user read is in flight", () => {
    expect(canApplyBackgroundRead(started, { ...started, userReadInFlight: true })).toBe(false);
  });

  test("drops the answer for a page the user has left", () => {
    expect(
      canApplyBackgroundRead(started, { requestId: 4, cursor: "older", userReadInFlight: false }),
    ).toBe(false);
    expect(
      canApplyBackgroundRead(
        { requestId: 4, cursor: "older" },
        { requestId: 4, cursor: null, userReadInFlight: false },
      ),
    ).toBe(false);
  });
});

describe("rowForOpenPanel", () => {
  type Row = { lead_id: string; summary: string };
  const idOf = (row: Row) => row.lead_id;
  const a = { lead_id: "a", summary: "未分析" };
  const b = { lead_id: "b", summary: "合成摘要乙" };

  test("shows nothing when no row is selected", () => {
    expect(rowForOpenPanel([a, b], null, a, idOf)).toBeNull();
  });

  test("always shows the fresh row while it is in the data", () => {
    // A reanalysis refreshes the data; the panel must show the new row, not the one it opened on.
    const reanalysed = { lead_id: "a", summary: "合成新摘要" };
    expect(rowForOpenPanel([reanalysed, b], "a", a, idOf)).toEqual({
      row: reanalysed,
      offBoard: false,
    });
    expect(rowForOpenPanel([reanalysed, b], "a", a, idOf)?.row).toBe(reanalysed);
  });

  test("keeps the last shown row, marked off-board, when a refresh drops the selected one", () => {
    // Off-board: the panel may be stale and its 重新 AI 分析 could not show the result.
    expect(rowForOpenPanel([b], "a", a, idOf)).toEqual({ row: a, offBoard: true });
    expect(rowForOpenPanel(null, "a", a, idOf)).toEqual({ row: a, offBoard: true });
  });

  test("never shows a remembered row for a different selection", () => {
    expect(rowForOpenPanel([b], "a", b, idOf)).toBeNull();
    expect(rowForOpenPanel([a], "b", null, idOf)).toBeNull();
  });
});

describe("errorAfterBackgroundListSuccess", () => {
  test("clears the banner a failed list read put up", () => {
    expect(
      errorAfterBackgroundListSuccess("合成對話列表讀取失敗", "合成對話列表讀取失敗"),
    ).toBeNull();
  });

  test("after a user list read succeeds, a later banner with the same text is not the list's", () => {
    // The route forgets the list's failure (listErrorRef = null) once a user list read succeeds,
    // so a poll keeps a later banner from another read even when its text is byte-identical.
    expect(errorAfterBackgroundListSuccess("合成對話列表讀取失敗", null)).toBe(
      "合成對話列表讀取失敗",
    );
  });

  test("keeps a banner from any other read on the page", () => {
    expect(errorAfterBackgroundListSuccess("合成同事名單讀取失敗", null)).toBe(
      "合成同事名單讀取失敗",
    );
    expect(errorAfterBackgroundListSuccess("合成同事名單讀取失敗", "合成對話列表讀取失敗")).toBe(
      "合成同事名單讀取失敗",
    );
    expect(errorAfterBackgroundListSuccess(null, "合成對話列表讀取失敗")).toBeNull();
  });
});

describe("isAuthorizationRefusal", () => {
  test("is true for a 401 or 403 the caller was refused with", () => {
    expect(isAuthorizationRefusal(new ServerFnResponseError("Forbidden", 403))).toBe(true);
    expect(isAuthorizationRefusal(new ServerFnResponseError("Unauthorized", 401))).toBe(true);
    // The same shapes isStaffAuthorizationError (admin-data.ts) classifies: any error with status.
    expect(isAuthorizationRefusal(Object.assign(new Error("HTTPError"), { status: 403 }))).toBe(
      true,
    );
    expect(isAuthorizationRefusal({ status: "401" })).toBe(true);
  });

  test("is false for anything else", () => {
    expect(isAuthorizationRefusal(new ServerFnResponseError("Not found", 404))).toBe(false);
    expect(isAuthorizationRefusal(Object.assign(new Error("HTTPError"), { status: 500 }))).toBe(
      false,
    );
    const timeout = new Error("合成逾時");
    timeout.name = "TimeoutError";
    expect(isAuthorizationRefusal(timeout)).toBe(false);
    expect(isAuthorizationRefusal(new Error("合成失敗"))).toBe(false);
    expect(isAuthorizationRefusal(null)).toBe(false);
    expect(isAuthorizationRefusal("403")).toBe(false);
    expect(isAuthorizationRefusal({ status: "forbidden" })).toBe(false);
  });
});

describe("createBackgroundReadGate", () => {
  test("names the roles each polled read accepts, as its server function does", () => {
    expect([...BACKGROUND_READ_ROLES.inboxList]).toEqual(["admin", "manager", "agent"]);
    expect([...BACKGROUND_READ_ROLES.commandCenter]).toEqual(["admin", "manager"]);
  });

  test("the inbox list polls for admin, manager and agent, never for a viewer", () => {
    const gate = createBackgroundReadGate(BACKGROUND_READ_ROLES.inboxList);
    for (const roles of [["admin"], ["manager"], ["agent"], ["viewer", "agent"]])
      expect(gate.allows(roles)).toBe(true);
    for (const roles of [["viewer"], []]) expect(gate.allows(roles)).toBe(false);
    // Roles not known yet (staff lookup pending, failed or denied): no poll.
    expect(gate.allows(null)).toBe(false);
    expect(gate.allows(undefined)).toBe(false);
  });

  test("the command center polls for admin and manager, never for an agent or a viewer", () => {
    const gate = createBackgroundReadGate(BACKGROUND_READ_ROLES.commandCenter);
    for (const roles of [["admin"], ["manager"], ["agent", "manager"]])
      expect(gate.allows(roles)).toBe(true);
    for (const roles of [["agent"], ["viewer"], ["agent", "viewer"], []])
      expect(gate.allows(roles)).toBe(false);
    expect(gate.allows(null)).toBe(false);
  });

  for (const [name, accepted, roles] of [
    ["inbox list", BACKGROUND_READ_ROLES.inboxList, ["agent"]],
    ["command center", BACKGROUND_READ_ROLES.commandCenter, ["manager"]],
  ] as const) {
    test(`${name}: a refused background read stops the poll until a user read succeeds`, () => {
      const gate = createBackgroundReadGate(accepted);
      expect(gate.allows(roles)).toBe(true);

      gate.backgroundFailed(new ServerFnResponseError("Forbidden", 403));
      expect(gate.allows(roles)).toBe(false);
      expect(gate.allows(["admin"])).toBe(false);
      // Another refusal, or any other failure, keeps it stopped.
      gate.backgroundFailed(new Error("合成失敗"));
      expect(gate.allows(roles)).toBe(false);

      gate.foregroundSucceeded();
      expect(gate.allows(roles)).toBe(true);

      gate.backgroundFailed(new ServerFnResponseError("Unauthorized", 401));
      expect(gate.allows(roles)).toBe(false);
      gate.foregroundSucceeded();
      expect(gate.allows(roles)).toBe(true);
    });

    test(`${name}: a failure that is not a refusal keeps the poll going`, () => {
      const gate = createBackgroundReadGate(accepted);
      gate.backgroundFailed(new ServerFnResponseError("Server error", 500));
      gate.backgroundFailed(new Error("合成失敗"));
      const timeout = new Error("合成逾時");
      timeout.name = "TimeoutError";
      gate.backgroundFailed(timeout);
      expect(gate.allows(roles)).toBe(true);
    });
  }

  test("each page has its own gate", () => {
    const inbox = createBackgroundReadGate(BACKGROUND_READ_ROLES.inboxList);
    const board = createBackgroundReadGate(BACKGROUND_READ_ROLES.commandCenter);
    inbox.backgroundFailed(new ServerFnResponseError("Forbidden", 403));
    expect(inbox.allows(["manager"])).toBe(false);
    expect(board.allows(["manager"])).toBe(true);
  });
});
