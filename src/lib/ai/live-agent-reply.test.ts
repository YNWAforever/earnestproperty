import { describe, expect, test } from "bun:test";
import {
  LIVE_AGENT_REPLY_COPY,
  isInternalCardHref,
  replyOffersHandoff,
  replyTranscriptText,
} from "./live-agent-reply.ts";
import { gradeReply, isEvalInternalHref, simplifiedCharacters } from "./live-agent-eval-graders.js";

describe("LIVE_AGENT_REPLY_COPY", () => {
  test("fixed reply copy contains no digits", () => {
    for (const value of Object.values(LIVE_AGENT_REPLY_COPY)) {
      expect(value).not.toMatch(/[0-9０-９]/);
    }
  });

  test("fixed reply copy has no Simplified-only characters", () => {
    for (const value of Object.values(LIVE_AGENT_REPLY_COPY)) {
      expect(simplifiedCharacters(value)).toEqual([]);
    }
  });

  test("fixed reply copy never claims a listing is available", () => {
    // Estate cards and no-listings replies reuse this copy, so it must never say 有盤 or 仲有.
    for (const [key, value] of Object.entries(LIVE_AGENT_REPLY_COPY)) {
      const grade = gradeReply({
        reply: { kind: "no_listings", text: value, cards: [] },
        facts: [],
        activeListingNos: [],
      });
      expect({ key, failures: grade.failures }).toEqual({ key, failures: [] });
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

describe("isInternalCardHref and the eval grader agree", () => {
  test("every sample gets the same verdict from both", () => {
    for (const href of [
      null,
      "/property/EP11001",
      "/estate/bellagio",
      "/listings?deal=all&bedrooms=2&district=sham-tseng",
      "https://evil.test/x",
      "//evil.test",
      "/property/%2e%2e",
      "/property/..",
      "/estate/a%2Fb",
      "/property/EP1?x=1",
      "/admin/leads",
    ]) {
      expect(isEvalInternalHref(href)).toBe(isInternalCardHref(href));
    }
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

describe("replyOffersHandoff", () => {
  const listing = {
    type: "listing" as const,
    title: "盤",
    lines: ["售 $1M"],
    href: "/property/EP11001",
  };
  const more = {
    type: "more" as const,
    title: LIVE_AGENT_REPLY_COPY.more_link,
    lines: [],
    href: "/listings?deal=all&estate=lido-garden",
  };

  test("no-answer kinds always offer the handoff", () => {
    for (const kind of [
      "handoff",
      "no_listings",
      "listing_unavailable",
      "no_match",
      "error",
    ] as const) {
      expect(replyOffersHandoff({ kind, cards: [] }, false)).toBe(true);
    }
  });

  test("a listings reply with only the more link offers the handoff", () => {
    expect(replyOffersHandoff({ kind: "listings", cards: [more] }, false)).toBe(true);
    expect(replyOffersHandoff({ kind: "listings", cards: [] }, false)).toBe(true);
  });

  test("a listings reply with a real listing card does not, unless the visitor asked", () => {
    expect(replyOffersHandoff({ kind: "listings", cards: [listing, more] }, false)).toBe(false);
    expect(replyOffersHandoff({ kind: "listings", cards: [listing] }, true)).toBe(true);
    expect(replyOffersHandoff({ kind: "faq", cards: [] }, false)).toBe(false);
    expect(replyOffersHandoff({ kind: "estates", cards: [] }, false)).toBe(false);
  });
});
