import { describe, expect, test } from "bun:test";

import {
  canApplyBackgroundRead,
  errorAfterBackgroundListSuccess,
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
