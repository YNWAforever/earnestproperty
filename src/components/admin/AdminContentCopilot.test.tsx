import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AdminContentCopilot } from "./AdminContentCopilot";
import {
  buildContentCopilotPartialUpdate,
  decideAndApplyContentCopilotProposal,
  contentCopilotCharacterCount,
  getContentCopilotPatchSelection,
} from "./content-copilot-ui";

describe("AdminContentCopilot", () => {
  test("renders a disabled save-first state for an unsaved record", () => {
    const html = renderToStaticMarkup(
      createElement(AdminContentCopilot, {
        resourceType: "listing",
        resourceId: null,
        values: { title_zh: "", description: "" },
        onApply: () => undefined,
      }),
    );

    expect(html).toContain("data-content-copilot");
    expect(html).toContain("data-content-copilot-disabled");
    expect(html).toContain("請先儲存一次");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*產生建議/);
    expect(html).toContain('aria-label="內容動作"');
    expect(html).toContain('aria-label="語氣"');
    expect(html).toContain('aria-label="目標語言"');
    expect(html).toContain('aria-label="研究來源"');
  });
});

describe("content copilot UI helpers", () => {
  const supportedPatch = {
    field: "title_zh",
    before: "舊標題",
    after: "新標題",
    reason: "更清晰",
    confidence: "high" as const,
    evidenceIds: [],
    unsupportedClaims: [],
    claimType: "subjective" as const,
  };

  test("unsupported patches remain unchecked and disabled", () => {
    expect(
      getContentCopilotPatchSelection(
        { ...supportedPatch, unsupportedClaims: ["未獲證實的交通時間"] },
        true,
      ),
    ).toEqual({
      checked: false,
      disabled: true,
    });
  });

  test("selected supported patches become a partial local update", () => {
    expect(
      buildContentCopilotPartialUpdate(
        [
          supportedPatch,
          {
            ...supportedPatch,
            field: "description",
            after: "不應套用",
            unsupportedClaims: ["未獲證實的聲稱"],
          },
        ],
        ["title_zh", "description"],
      ),
    ).toEqual({ title_zh: "新標題" });
  });

  test("character counts are stable for null, strings, and arrays", () => {
    expect(contentCopilotCharacterCount(null)).toBe(0);
    expect(contentCopilotCharacterCount("海景單位")).toBe(4);
    expect(contentCopilotCharacterCount(["海景", "三房"])).toBe(5);
  });
});
