import { describe, expect, test } from "bun:test";

import { displayWidth, DESCRIPTION_MAX_UNITS, TITLE_MAX_UNITS } from "@/content/seo-budget.js";
import { listingSeo, listingSeoDescription, listingSeoTitle } from "./listing-seo";
import type { ListingSeoInput } from "./listing-seo";

const richUnit: ListingSeoInput = {
  listing_no: "SW-1201",
  public_listing_no: "EP-1201",
  title_zh: "碧堤半島 3房海景",
  estates: { name_zh: "碧堤半島", district_slug: "sham-tseng" },
  district_slug: "sham-tseng",
  deal_type: "sale",
  price: 11_800_000,
  rent: null,
  saleable_area: 968,
  bedrooms: 3,
  bathrooms: 2,
  floor: "高層",
  orientation: "向南",
  features: ["連車位", "無敵海景", "會所齊備"],
};

/** The shape the great majority of `/property/*` pages actually have: an
 * ingested row with no CMS SEO copy, no floor, no area and no features. */
const bareUnit: ListingSeoInput = {
  listing_no: "PHK-88",
  title_zh: "深井放盤",
  estates: { name_zh: "浪翠園", district_slug: "sham-tseng" },
  district_slug: "sham-tseng",
  deal_type: "sale",
  price: 6_280_000,
  rent: null,
};

describe("listingSeoTitle", () => {
  test("uses the estate, the unit spec, the price and the district", () => {
    const title = listingSeoTitle(richUnit);
    expect(title).toBe("碧堤半島｜高層 3 房｜售 $1,180萬｜深井放盤｜晉誠地產");
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
  });

  test("prefers a hand-written CMS seo_title and keeps the brand suffix", () => {
    expect(listingSeoTitle({ ...richUnit, seo_title: "碧堤半島高層三房連車位" })).toBe(
      "碧堤半島高層三房連車位｜晉誠地產",
    );
  });

  test("ignores a blank or malformed CMS seo_title instead of rendering it", () => {
    // sanitizeListingText maps "", "  ", "null" and "undefined" to null. Without
    // that, `${seo_title}｜晉誠地產` shipped a title starting with a bare bar.
    for (const seo_title of ["", "   ", "null", "undefined"]) {
      expect(listingSeoTitle({ ...richUnit, seo_title })).toBe(
        "碧堤半島｜高層 3 房｜售 $1,180萬｜深井放盤｜晉誠地產",
      );
    }
  });

  test("never restates a fact the head already carries", () => {
    // title_zh "深井放盤" already says 深井放盤; the district segment must not
    // be appended a second time.
    const title = listingSeoTitle({ ...bareUnit, estates: null });
    expect(title).toBe("深井放盤｜售 $628萬｜編號 PHK-88｜晉誠地產");
    expect(title.match(/深井放盤/g)).toHaveLength(1);
  });

  test("gives two indistinguishable units in one estate distinct titles", () => {
    const a = listingSeoTitle({ ...bareUnit, listing_no: "T-1", public_listing_no: "EP-T1" });
    const b = listingSeoTitle({ ...bareUnit, listing_no: "T-2", public_listing_no: "EP-T2" });
    expect(a).not.toBe(b);
    expect(a).toContain("EP-T1");
    expect(b).toContain("EP-T2");
  });

  test("omits the listing number once the unit has facts of its own", () => {
    expect(listingSeoTitle(richUnit)).not.toContain("編號");
  });

  test("states both sides of a group that is for sale and for rent", () => {
    const title = listingSeoTitle({
      ...richUnit,
      features: null,
      offerings: [
        { deal_type: "sale", price: 11_800_000, rent: null, status: "active" },
        { deal_type: "rent", price: null, rent: 32_000, status: "active" },
      ],
    });
    expect(title).toContain("售 $1,180萬");
    expect(title).toContain("租 $32,000");
  });

  test("stays inside the SERP budget for the longest realistic inputs", () => {
    const title = listingSeoTitle({
      ...richUnit,
      estates: { name_zh: "香港黃金海岸", district_slug: "castle-peak-road" },
      title_zh: "香港黃金海岸五期特色單位連天台及花園全屋豪華裝修即買即住",
      district_slug: "castle-peak-road",
      price: 38_800_000,
      saleable_area: 2461,
      bedrooms: 4,
      floor: "高層",
    });
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
    expect(title.endsWith("｜晉誠地產")).toBe(true);
  });

  test("always produces a non-empty title, even with nothing but a listing number", () => {
    const title = listingSeoTitle({ listing_no: "Z-9" });
    expect(title).toBe("放盤｜編號 Z-9｜晉誠地產");
  });
});

describe("listingSeoDescription", () => {
  test("composes the unit's own facts, the price and a call to action", () => {
    const description = listingSeoDescription(richUnit);
    expect(description).toBe(
      "深井碧堤半島 高層 3 房單位。實用 968 呎，向南，2 廁。售 $1,180萬，呎價 $12,190。連車位、無敵海景。WhatsApp 即時預約睇樓。晉誠地產 C-018613。",
    );
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
  });

  test("writes the per-square-foot price without doubling the 呎 measure word", () => {
    // formatPsf already returns "$12,190 呎"; labelling it 實呎約 as well
    // rendered "實呎約 $12,190 呎".
    const description = listingSeoDescription(richUnit);
    expect(description).toContain("呎價 $12,190。");
    expect(description).not.toContain("$12,190 呎");
  });

  test("prefers a hand-written CMS seo_description", () => {
    const authored = "碧堤半島高層三房連車位，實用 968 呎，坐擁青馬橋海景。";
    expect(listingSeoDescription({ ...richUnit, seo_description: authored })).toBe(authored);
  });

  test("trims an over-long CMS seo_description on a clause boundary, not mid-word", () => {
    const authored = `${"碧堤半島深井海景三房連車位，會所配套齊備，鄰近深井燒鵝美食圈，".repeat(4)}即時查詢。`;
    const description = listingSeoDescription({ ...richUnit, seo_description: authored });
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
    expect(description).not.toMatch(/[，。、]$/);
    expect(authored.startsWith(description)).toBe(true);
  });

  test("keeps the call to action even when the body copy is long", () => {
    // The bug this pins: appending sentences until the budget ran out dropped
    // the CTA, because it was appended last.
    const description = listingSeoDescription({
      ...bareUnit,
      description:
        "豪景花園位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位，背山面海，生活配套齊備。",
    });
    expect(description).toContain("WhatsApp 即時預約睇樓。晉誠地產 C-018613。");
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
  });

  test("cuts body filler on a clause boundary, never mid-numeral", () => {
    const description = listingSeoDescription({
      ...bareUnit,
      description: "豪景花園由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位。",
    });
    // "…分三期落成，共 28" was the defect: a rewind to the last space landed
    // inside "共 28 座".
    expect(description).not.toMatch(/共 \d+。/);
  });

  test("never degrades to the title repeated back, the old empty-description path", () => {
    const description = listingSeoDescription({ listing_no: "Z-9", title_zh: "深井放盤" });
    expect(description.length).toBeGreaterThan(0);
    expect(description).toContain("晉誠地產 C-018613。");
  });

  test("gives two indistinguishable units in one estate distinct descriptions", () => {
    const a = listingSeoDescription({ ...bareUnit, listing_no: "T-1", public_listing_no: "EP-T1" });
    const b = listingSeoDescription({ ...bareUnit, listing_no: "T-2", public_listing_no: "EP-T2" });
    expect(a).not.toBe(b);
  });

  test("omits the listing-number stamp once the unit has facts of its own", () => {
    expect(listingSeoDescription(richUnit)).not.toContain("盤源編號");
  });

  test("does not restate a bedroom count the source title already gives", () => {
    const description = listingSeoDescription({
      listing_no: "X-1",
      title_zh: "青山公路獨立屋 4房 連花園",
      deal_type: "sale",
      price: 32_000_000,
      bedrooms: 4,
    });
    expect(description).not.toContain("連花園 4 房單位");
    expect(description).toContain("售 $3,200萬");
  });

  test("drops a floor value it cannot read rather than guessing at one", () => {
    // Block names and stray tokens arrive in `floor` from the sources. "第 3 座"
    // is not a floor, and rendering it as one would state a fact the row does
    // not carry.
    const description = listingSeoDescription({ ...richUnit, floor: "第 3 座" });
    expect(description).not.toContain("第 3 座");
    expect(description).toContain("3 房單位");
  });
});

describe("listingSeo", () => {
  test("returns both strings, both inside budget, for every fixture", () => {
    for (const input of [richUnit, bareUnit, { listing_no: "Z-9" } as ListingSeoInput]) {
      const { title, description } = listingSeo(input);
      expect(title.trim().length).toBeGreaterThan(0);
      expect(description.trim().length).toBeGreaterThan(0);
      expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
      expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
    }
  });
});
