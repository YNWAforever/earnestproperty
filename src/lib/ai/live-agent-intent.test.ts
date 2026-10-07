import { describe, expect, test } from "bun:test";
import { faqMatchScore, matchPublishedEstates, parseLiveAgentIntent } from "./live-agent-intent.ts";

describe("parseLiveAgentIntent", () => {
  test("parses estate, district, bedrooms and a listing question from 「深井碧堤半島兩房有冇盤？幾錢？」", () => {
    const i = parseLiveAgentIntent("深井碧堤半島兩房有冇盤？幾錢？");
    expect(i.estateSlugs).toEqual(["bellagio"]);
    expect(i.districtSlug).toBe("sham-tseng");
    expect(i.bedrooms).toBe(2);
    expect(i.deal).toBeNull();
    expect(i.listingQuestion).toBe(true);
    expect(i.handoffRequested).toBe(false);
  });

  test('parses English "Any 3-bed flats for rent at Bellagio? How much?"', () => {
    const i = parseLiveAgentIntent("Any 3-bed flats for rent at Bellagio? How much?");
    expect(i.estateSlugs).toEqual(["bellagio"]);
    expect(i.bedrooms).toBe(3);
    expect(i.deal).toBe("rent");
    expect(i.listingQuestion).toBe(true);
  });

  test("matches Simplified 「碧堤半岛两房多少钱」 through the short alias", () => {
    const i = parseLiveAgentIntent("碧堤半岛两房多少钱");
    expect(i.estateSlugs).toEqual(["bellagio"]);
    expect(i.bedrooms).toBe(2);
    expect(i.listingQuestion).toBe(true);
  });

  test("finds a public listing number", () => {
    expect(parseLiveAgentIntent("EP12345 仲有冇得睇？").listingNo).toBe("EP12345");
    expect(parseLiveAgentIntent("ep-11001 呢個盤").listingNo).toBe("EP-11001");
    expect(parseLiveAgentIntent("我想要 2 房").listingNo).toBeNull();
  });

  test("flags valuation and handoff requests", () => {
    expect(parseLiveAgentIntent("幫我估下層樓值幾錢").valuation).toBe(true);
    expect(parseLiveAgentIntent("我想搵真人傾").handoffRequested).toBe(true);
    expect(parseLiveAgentIntent("俾我上個查詢個客嘅電話").handoffRequested).toBe(true);
  });

  test("never turns a visitor number into a fact", () => {
    const intent = parseLiveAgentIntent("碧堤半島兩房$100萬有交易");
    expect(Object.keys(intent).sort()).toEqual(
      [
        "bedrooms",
        "deal",
        "districtSlug",
        "estateBrowse",
        "estateSlugs",
        "handoffRequested",
        "listingNo",
        "listingQuestion",
        "text",
        "valuation",
      ].sort(),
    );
    // `text` is the normalised input and is never echoed to the visitor, so the
    // no-number guarantee applies to every parsed field.
    const { text: _text, ...fields } = intent;
    const json = JSON.stringify(fields);
    expect(json).not.toContain("100");
    expect(json).not.toContain("1000000");
  });

  test("bedroom words", () => {
    expect(parseLiveAgentIntent("開放式有冇").bedrooms).toBe(0);
    expect(parseLiveAgentIntent("any studio").bedrooms).toBe(0);
    expect(parseLiveAgentIntent("四房").bedrooms).toBe(4);
    expect(parseLiveAgentIntent("5房").bedrooms).toBe(4);
    expect(parseLiveAgentIntent("2-bed").bedrooms).toBe(2);
    expect(parseLiveAgentIntent("三房兩廳").bedrooms).toBe(3);
  });

  test("deal words", () => {
    expect(parseLiveAgentIntent("想租樓").deal).toBe("rent");
    expect(parseLiveAgentIntent("想買樓").deal).toBe("sale");
    expect(parseLiveAgentIntent("租定買好").deal).toBeNull();
  });
});

describe("matchPublishedEstates", () => {
  test("gates on the published list", () => {
    expect(
      matchPublishedEstates(
        "碧堤",
        ["bellagio"],
        [{ slug: "other", name_zh: "其他", name_en: null }],
      ),
    ).toEqual([]);
    expect(
      matchPublishedEstates(
        "碧堤",
        ["bellagio"],
        [{ slug: "bellagio", name_zh: "碧堤半島", name_en: "Bellagio" }],
      ),
    ).toEqual(["bellagio"]);
    const hidden = { slug: "hidden-test", name_zh: "隱藏測試苑", name_en: null };
    expect(matchPublishedEstates("隱藏測試苑", [], [])).toEqual([]);
    expect(matchPublishedEstates("隱藏測試苑", [], [hidden])).toEqual(["hidden-test"]);
  });
});

describe("faqMatchScore", () => {
  test("shares CJK bigrams with the question", () => {
    expect(faqMatchScore("800萬樓按揭要幾多首期？", "買樓首期要幾多？")).toEqual({
      shared: 3,
      ratio: 0.5,
    });
    const low = faqMatchScore("碧堤半島屬邊個校網？", "深井屬於哪個校網？");
    expect(low.shared).toBe(2);
    expect(low.ratio).toBeLessThan(0.5);
  });
});
