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
        "buyerListingAsk",
        "deal",
        "districtSlug",
        "estateBrowse",
        "estateSlugs",
        "handoffRequested",
        "listingNo",
        "listingQuestion",
        "sellIntent",
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

describe("review fixes", () => {
  test("a phone number is never a listing number", () => {
    for (const phone of [
      "tel91234567",
      "WA-91234567",
      "whatsapp 91234567",
      "ph:91234567",
      "tel 9123 4567",
      "wa-9123-4567",
      "tel+852 91234567",
      "wa85291234567",
      "852-6123 4567",
    ]) {
      expect(parseLiveAgentIntent(phone).listingNo).toBeNull();
    }
    expect(parseLiveAgentIntent("EP11001 同 tel91234567").listingNo).toBe("EP11001");
  });

  test("English keywords need word boundaries", () => {
    expect(parseLiveAgentIntent("please show 3 bed at Bellagio").deal).toBeNull();
    for (const w of ["different", "current", "present", "agency"]) {
      expect(parseLiveAgentIntent(`${w} Bellagio 3 bed`).deal).toBeNull();
    }
    for (const w of ["specifically Bellagio 3 bed", "recall Bellagio", "my agency"]) {
      expect(parseLiveAgentIntent(w).handoffRequested).toBe(false);
    }
    expect(parseLiveAgentIntent("please buy").deal).toBe("sale");
    expect(parseLiveAgentIntent("to rent").deal).toBe("rent");
    expect(parseLiveAgentIntent("call me").handoffRequested).toBe(true);
    expect(parseLiveAgentIntent("an agent please").handoffRequested).toBe(true);
    expect(parseLiveAgentIntent("embedded").listingQuestion).toBe(false);
  });

  test("Simplified Chinese keywords, districts and estates", () => {
    expect(parseLiveAgentIntent("我想买碧堤半岛两房").deal).toBe("sale");
    expect(parseLiveAgentIntent("有冇盘").listingQuestion).toBe(true);
    expect(parseLiveAgentIntent("请联络我").handoffRequested).toBe(true);
    expect(parseLiveAgentIntent("找经纪").handoffRequested).toBe(true);
    expect(parseLiveAgentIntent("找职员").handoffRequested).toBe(true);
    expect(parseLiveAgentIntent("估价").valuation).toBe(true);
    expect(parseLiveAgentIntent("我是业主").sellIntent).toBe(true);
    expect(parseLiveAgentIntent("我想卖楼").sellIntent).toBe(true);
    expect(parseLiveAgentIntent("放盘估价").valuation).toBe(true);
    expect(parseLiveAgentIntent("荃湾").districtSlug).toBe("tsuen-wan");
    expect(parseLiveAgentIntent("青龙头").districtSlug).toBe("tsing-lung-tau");
    expect(parseLiveAgentIntent("开放式").bedrooms).toBe(0);
    expect(parseLiveAgentIntent("问屋苑").estateBrowse).toBe(true);
    expect(parseLiveAgentIntent("豪景花园几钱").estateSlugs).toEqual(["hong-kong-garden"]);
  });

  test("more bedroom forms", () => {
    expect(parseLiveAgentIntent("2br").bedrooms).toBe(2);
    expect(parseLiveAgentIntent("3 rooms").bedrooms).toBe(3);
    expect(parseLiveAgentIntent("三間房").bedrooms).toBe(3);
    expect(parseLiveAgentIntent("三睡房").bedrooms).toBe(3);
  });
});

describe("residual R1: contact prefixes", () => {
  test("a token glued to tel/ph/wa/whatsapp is never a listing number, whatever its digit count", () => {
    for (const text of [
      "tel912345678",
      "TEL912345678",
      "ph1234567",
      "PH-1234567",
      "wa-1234567",
      "wa123",
      "tel-1234567890",
      "whatsapp1234567",
      "我嘅電話 tel912345678",
    ]) {
      expect(parseLiveAgentIntent(text).listingNo).toBeNull();
    }
  });

  test("real listing numbers still parse, also next to a rejected prefix", () => {
    expect(parseLiveAgentIntent("EP001").listingNo).toBe("EP001");
    expect(parseLiveAgentIntent("EP-1201 仲有冇").listingNo).toBe("EP-1201");
    expect(parseLiveAgentIntent("ep11001").listingNo).toBe("EP11001");
    expect(parseLiveAgentIntent("A000001").listingNo).toBe("A000001");
    expect(parseLiveAgentIntent("tel912345678 EP11001").listingNo).toBe("EP11001");
    expect(parseLiveAgentIntent("wa-1234567 同 ep-1201").listingNo).toBe("EP-1201");
  });
});

describe("final fix wave: parser minors", () => {
  test("bedrooms / beds / bed in English", () => {
    expect(parseLiveAgentIntent("rent 3 bedrooms bellagio").bedrooms).toBe(3);
    expect(parseLiveAgentIntent("3 beds at bellagio").bedrooms).toBe(3);
    expect(parseLiveAgentIntent("3bed").bedrooms).toBe(3);
    expect(parseLiveAgentIntent("2 bedroom flat").bedrooms).toBe(2);
    expect(parseLiveAgentIntent("3-beds").bedrooms).toBe(3);
    expect(parseLiveAgentIntent("3 bedding").bedrooms).toBeNull();
  });

  test("budget, room and unit tokens are never listing numbers", () => {
    for (const text of [
      "碧堤半島兩房 budget hkd8000000",
      "預算HK8000000",
      "預算hk$8000000",
      "rm1203",
      "unit b1203",
      "flat 12a",
      "flat12a",
      "flat1203",
      "rm 1203",
      "b1203室",
    ]) {
      expect({ text, no: parseLiveAgentIntent(text).listingNo }).toEqual({ text, no: null });
    }
    expect(parseLiveAgentIntent("碧堤半島兩房 budget hkd8000000").estateSlugs).toEqual([
      "bellagio",
    ]);
  });

  test("the site's listing number formats still parse", () => {
    expect(parseLiveAgentIntent("EP001").listingNo).toBe("EP001");
    expect(parseLiveAgentIntent("EP-1201 仲有冇").listingNo).toBe("EP-1201");
    expect(parseLiveAgentIntent("ep11001").listingNo).toBe("EP11001");
    expect(parseLiveAgentIntent("A000001").listingNo).toBe("A000001");
    expect(parseLiveAgentIntent("c123456 呢個盤").listingNo).toBe("C123456");
  });

  test("放盤 without a valuation word is a sell-intent handoff, not valuation", () => {
    for (const text of ["我想放盤", "放盘"]) {
      const intent = parseLiveAgentIntent(text);
      expect({ text, valuation: intent.valuation, sell: intent.sellIntent }).toEqual({
        text,
        valuation: false,
        sell: true,
      });
    }
    for (const text of ["放盤前想估價", "放盤值幾錢", "想放盤，幫我估下", "放盘估价"]) {
      expect({ text, valuation: parseLiveAgentIntent(text).valuation }).toEqual({
        text,
        valuation: true,
      });
    }
    // 業主 is a seller cue (sell handoff), not valuation.
    expect(parseLiveAgentIntent("我是業主").sellIntent).toBe(true);
    expect(parseLiveAgentIntent("碧堤半島兩房").sellIntent).toBe(false);
  });
});

describe("follow-up N1: production listing numbers", () => {
  test("one letter and 6 digits, with an optional hyphen or single space", () => {
    for (const [text, expected] of [
      ["A056377", "A056377"],
      ["T027001 仲有冇", "T027001"],
      ["C-018613", "C-018613"],
      ["b-072966 呢個盤", "B-072966"],
      ["盤號：C-021283", "C-021283"],
      ["盤號 C 018613", "C-018613"],
      ["c018613", "C018613"],
      ["EP-1201", "EP-1201"],
    ] as const) {
      expect({ text, no: parseLiveAgentIntent(text).listingNo }).toEqual({ text, no: expected });
    }
  });

  test("budget, unit and phone tokens stay rejected", () => {
    for (const text of [
      "hkd8000000",
      "rm1203",
      "unit b1203",
      "tel91234567",
      "tel 9123 4567",
      "91234567",
      "c 91234567",
      "c-91234567",
    ]) {
      expect({ text, no: parseLiveAgentIntent(text).listingNo }).toEqual({ text, no: null });
    }
  });
});

describe("follow-up N2: 放盤 from a buyer stays on listings", () => {
  test("a seller cue, or 放盤 alone, is the sell handoff", () => {
    for (const text of ["我想放盤", "我有層樓想放盤", "放盤", "放盘！", "幫我放盤", "我要放盤"]) {
      expect({ text, sell: parseLiveAgentIntent(text).sellIntent }).toEqual({ text, sell: true });
    }
  });

  test("with a place, bedrooms or deal and no seller cue, it is a listing question", () => {
    for (const text of [
      "有冇兩房放盤",
      "沙田兩房放盤",
      "沙田有冇放盤",
      "碧堤半島兩房放盤",
      "租放盤",
    ]) {
      const intent = parseLiveAgentIntent(text);
      expect({ text, sell: intent.sellIntent, listing: intent.listingQuestion }).toEqual({
        text,
        sell: false,
        listing: true,
      });
    }
  });

  test("沙田 and 青山公路 are districts", () => {
    expect(parseLiveAgentIntent("沙田兩房放盤").districtSlug).toBe("sha-tin");
    expect(parseLiveAgentIntent("青山公路兩房").districtSlug).toBe("castle-peak-road");
  });
});

describe("follow-up N2 correction: 我想買 is a buyer", () => {
  test("a buy or rent word wins over a weak seller cue", () => {
    for (const text of [
      "我想買碧堤半島兩房放盤",
      "我想租兩房放盤",
      "我有層樓，想入市碧堤半島放盤",
    ]) {
      const intent = parseLiveAgentIntent(text);
      expect({ text, sell: intent.sellIntent, valuation: intent.valuation }).toEqual({
        text,
        sell: false,
        valuation: false,
      });
    }
  });

  test("strong seller cues, 業主 and 我有層 are the sell handoff", () => {
    for (const text of [
      "我想放盤",
      "我想賣樓",
      "我有層樓想放盤",
      "我要賣碧堤半島",
      "幫我賣層樓",
      "我是業主",
      "我層樓想放",
      "我想賣樓，順便想買細啲",
    ]) {
      const intent = parseLiveAgentIntent(text);
      expect({ text, sell: intent.sellIntent, valuation: intent.valuation }).toEqual({
        text,
        sell: true,
        valuation: false,
      });
    }
  });
});
