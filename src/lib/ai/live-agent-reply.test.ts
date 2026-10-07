import { describe, expect, test } from "bun:test";
import {
  LIVE_AGENT_REPLY_COPY,
  isInternalCardHref,
  replyTranscriptText,
} from "./live-agent-reply.ts";

describe("LIVE_AGENT_REPLY_COPY", () => {
  test("fixed reply copy contains no digits", () => {
    for (const value of Object.values(LIVE_AGENT_REPLY_COPY)) {
      expect(value).not.toMatch(/[0-9０-９]/);
    }
  });

  test("fixed reply copy has no Simplified-only characters", () => {
    // Task 4 swaps this local list for the shared detector.
    const simplified = /[们这说么岛两钱价楼间问电]/u;
    for (const value of Object.values(LIVE_AGENT_REPLY_COPY)) {
      expect(value).not.toMatch(simplified);
    }
  });
});

describe("isInternalCardHref", () => {
  test("accepts only property, estate and listings paths", () => {
    for (const ok of [
      "/property/EP11001",
      "/estate/bellagio",
      "/listings?deal=sale&bedrooms=2&estate=bellagio",
    ]) {
      expect(isInternalCardHref(ok)).toBe(true);
    }
    for (const bad of [
      null,
      "https://x.test/property/1",
      "//evil.test",
      "javascript:alert(1)",
      "/admin/leads",
      "/property/../admin",
      "/property/EP1?x=1",
    ]) {
      expect(isInternalCardHref(bad)).toBe(false);
    }
  });
});

describe("replyTranscriptText", () => {
  test("renders each card on its own line", () => {
    const text = replyTranscriptText({
      text: "以下是盤源：",
      cards: [
        {
          type: "listing",
          title: "碧堤半島 兩房",
          lines: ["售價 A", "實用面積 B"],
          href: "/property/EP11001",
        },
        { type: "faq", title: "問題", lines: ["答案"], href: null },
      ],
    });
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("以下是盤源：");
    expect(lines[1]).toBe("• 碧堤半島 兩房（售價 A，實用面積 B） /property/EP11001");
    expect(lines[2]).toBe("• 問題（答案）");
  });
});

describe("isInternalCardHref hardening", () => {
  test("rejects odd and encoded traversal forms", () => {
    for (const bad of [
      "/" + String.fromCharCode(92) + "evil",
      " /property/EP1",
      "/property/EP1\n",
      "/property/EP1#x",
      "/property/%2e%2e",
      "/estate/a%2Fb",
      "/estate/a%5Cb",
    ]) {
      expect(isInternalCardHref(bad)).toBe(false);
    }
  });
});
