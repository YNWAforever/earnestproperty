import { describe, expect, test } from "bun:test";

import { parseAdminFaqImport } from "./faq-import";

describe("parseAdminFaqImport", () => {
  test("keeps each question in the scope that was in effect when it was read", () => {
    const rows = parseAdminFaqImport(
      [
        "scope: general",
        "Q: 點樣聯絡晉誠地產？",
        "A: WhatsApp 或致電分行。",
        "scope: estate:bellagio",
        "Q: 碧堤半島有幾多個單位？",
        "A: 約 3,345 個單位。",
      ].join("\n"),
    );

    // Regression: switching scope used to reassign `scope` without flushing the
    // pending pair, so every question was filed under the *following* scope.
    expect(rows).toEqual([
      { scope: "general", question: "點樣聯絡晉誠地產？", answer: "WhatsApp 或致電分行。" },
      {
        scope: "estate:bellagio",
        question: "碧堤半島有幾多個單位？",
        answer: "約 3,345 個單位。",
      },
    ]);
  });

  test("applies the fallback scope until the first scope line", () => {
    const rows = parseAdminFaqImport(
      ["Q: 一", "A: 甲", "scope: owner", "Q: 二", "A: 乙"].join("\n"),
      "general",
    );

    expect(rows.map((row) => row.scope)).toEqual(["general", "owner"]);
  });

  test("carries one scope across several consecutive pairs", () => {
    const rows = parseAdminFaqImport(
      ["scope: owner", "Q: 一", "A: 甲", "Q: 二", "A: 乙", "Q: 三", "A: 丙"].join("\n"),
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.scope === "owner")).toBe(true);
  });

  test("keeps multi-line answers with their own question", () => {
    const rows = parseAdminFaqImport(
      ["scope: general", "Q: 一", "A: 第一行", "第二行", "scope: owner", "Q: 二", "A: 乙"].join(
        "\n",
      ),
    );

    expect(rows[0]).toEqual({ scope: "general", question: "一", answer: "第一行\n第二行" });
    expect(rows[1]?.scope).toBe("owner");
  });

  test("drops a question with no answer instead of merging it into the next pair", () => {
    const rows = parseAdminFaqImport(
      ["scope: general", "Q: 無答案", "scope: owner", "Q: 二", "A: 乙"].join("\n"),
    );

    expect(rows).toEqual([{ scope: "owner", question: "二", answer: "乙" }]);
  });

  test("returns nothing for empty input", () => {
    expect(parseAdminFaqImport("")).toEqual([]);
    expect(parseAdminFaqImport("   \n  ")).toEqual([]);
  });
});
