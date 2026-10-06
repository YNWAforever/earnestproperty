import { expect, test } from "bun:test";
import {
  stageOptions,
  stageFilterOptions,
  stageLabels,
  quickLeadFilter,
  labeledFilterOptions,
  aiScoreLabel,
} from "./crm-presentation";

test("all server stages use the approved shared display labels", () => {
  expect(Object.fromEntries(stageOptions.map(({ value, label }) => [value, label]))).toEqual({
    new: "新查詢",
    contacted: "已聯絡",
    viewing: "已約睇樓",
    negotiating: "商議中",
    closed_won: "已成交",
    closed_lost: "已結束（未成交）",
  });
});
test("the stage filter offers 開放（未完成） for stage=open, but stage edits never can", () => {
  expect(stageFilterOptions[0]).toEqual({ value: "open", label: "開放（未完成）" });
  expect(stageFilterOptions.slice(1)).toEqual(stageOptions);
  expect(stageOptions.some(({ value }) => (value as string) === "open")).toBe(false);
  expect(stageLabels.open).toBe("開放（未完成）");
});
test("quick filters use server enums and restart paging while retaining other filters and detail", () => {
  const current = {
    stage: "viewing",
    agent_id: "agent-1",
    cursor: "page-2",
    source: "legacy-source",
    lead: "lead-1",
  };
  expect(quickLeadFilter(current, "new")).toEqual({
    stage: "new",
    agent_id: "agent-1",
    source: "legacy-source",
    lead: "lead-1",
  });
  expect(quickLeadFilter(current, "unassigned")).toEqual({
    stage: "viewing",
    agent_id: "unassigned",
    source: "legacy-source",
    lead: "lead-1",
  });
  expect(current.cursor).toBe("page-2");
});
test("filters translate known values and retain unknown selected values outside the loaded page", () => {
  expect(
    labeledFilterOptions({ buyer: "買樓" }, ["buyer", "legacy", "legacy"], "imported"),
  ).toEqual([
    { value: "buyer", label: "買樓" },
    { value: "legacy", label: "legacy" },
    { value: "imported", label: "imported" },
  ]);
});
test("missing AI scores are unknown while zero remains a measured score", () => {
  expect(aiScoreLabel(null)).toBe("未知（未分析）");
  expect(aiScoreLabel(undefined)).toBe("未知（未分析）");
  expect(aiScoreLabel(0)).toBe("0");
});
