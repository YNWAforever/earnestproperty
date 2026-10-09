import { describe, expect, test } from "bun:test";

import { displayWidth, DESCRIPTION_MAX_UNITS, TITLE_MAX_UNITS } from "@/content/seo-budget.js";
import {
  listingSearchSeo,
  listingSeo,
  listingSeoDescription,
  listingSeoTitle,
} from "./listing-seo";
import type { ListingSeoInput } from "./listing-seo";

const richUnit: ListingSeoInput = {
  listing_no: "SW-1201",
  public_listing_no: "EP-1201",
  title_zh: "碧堤半島 3房海景",
  estates: { name_zh: "碧堤半島", district_slug: "sham-tseng" },
  // Deliberately the wrong value: inferDistrictSlug defaults to "tsuen-wan",
  // and the verified estates value must win. See the precedence test below.
  district_slug: "tsuen-wan",
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
  district_slug: "tsuen-wan",
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
    // title_zh "深井放盤" already says 深井; the district segment must not be
    // appended a second time. With estates null there is no verified district
    // either, so the head is the cleaned source title on its own.
    const title = listingSeoTitle({ ...bareUnit, estates: null, district_slug: null });
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

describe("listingSeoTitle source-title tag", () => {
  const rest = "9座極高層樓皇橋海!附設靚裝修!有匙即看!";
  const titleFor = (title_zh: string) => listingSeoTitle({ listing_no: "Z-1", title_zh });
  const plain = titleFor(rest);
  for (const tagged of [
    `(晉誠地產筍盤推介) ${rest}`,
    `（晉誠地產筍盤推介）${rest}`,
    `（晉誠地產獨家)${rest}`,
    `  (晉誠地產筍盤推介)${rest}`,
  ]) {
    test(`loses only the leading tag: ${tagged.slice(0, 12)}`, () => {
      expect(titleFor(tagged)).toBe(plain);
    });
  }
  test("a tag in the middle is kept", () => {
    const mid = "碧堤半島(晉誠地產推介)高層海景";
    expect(titleFor(mid)).toContain("(晉誠地產推介)");
  });
  test("a tag after leading 【筍盤】 is removed, the 【筍盤】 itself is not", () => {
    expect(titleFor(`【筍盤】(晉誠地產推介) ${rest}`)).toBe(titleFor(`【筍盤】 ${rest}`));
  });
});

describe("listingSeoDescription", () => {
  test("composes the unit's own facts, the price and a call to action", () => {
    const description = listingSeoDescription(richUnit);
    expect(description).toBe(
      "深井碧堤半島 高層 3 房單位。實用 968 呎，向南，2 廁。售 $1,180萬，呎價 $12,190。連車位、無敵海景。WhatsApp 即時預約睇樓或免費估價。晉誠地產 C-018613。",
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

  test("T027001's description equals the approved text", () => {
    const description = listingSeoDescription({
      listing_no: "T027001",
      title_zh: "碧堤半島 高層 4房",
      estates: { name_zh: "碧堤半島", district_slug: "sham-tseng" },
      deal_type: "sale",
      price: 12_680_000,
      saleable_area: 901,
      bedrooms: 4,
      bathrooms: 3,
      floor: "高層",
      orientation: "南",
      description: "碧堤半島，高層，實用面積。",
    });
    expect(description).toBe(
      "深井碧堤半島 高層 4 房單位。實用 901 呎，南，3 廁。售 $1,268萬，呎價 $14,073。WhatsApp 即時預約睇樓或免費估價。晉誠地產 C-018613。",
    );
  });

  describe("generated 實用面積 filler in the body", () => {
    const unit = {
      listing_no: "T027001",
      title_zh: "碧堤半島 高層 4房",
      estates: { name_zh: "碧堤半島", district_slug: "sham-tseng" },
      deal_type: "sale" as const,
      price: 12_680_000,
      saleable_area: 901,
      bedrooms: 4,
      bathrooms: 3,
      floor: "高層",
      orientation: "南",
    };
    const facts = "深井碧堤半島 高層 4 房單位。實用 901 呎，南，3 廁。售 $1,268萬，呎價 $14,073。";
    const cta = "WhatsApp 即時預約睇樓或免費估價。晉誠地產 C-018613。";

    const cases: Array<[string, string, string]> = [
      ["the generated filler alone is removed", "碧堤半島，高層，實用面積。", `${facts}${cta}`],
      ["the filler without its full stop is removed", "碧堤半島，高層，實用面積", `${facts}${cta}`],
      [
        "digit commas and ！ in a body stay byte-identical",
        "建築 1,100 呎！即睇即議",
        `${facts}建築 1,100 呎！即睇即議。${cta}`,
      ],
      ["a short informative clause is kept", "南向，海", `${facts}南向，海。${cta}`],
      [
        "the filler is cut out of a longer body and the rest is kept",
        "碧堤半島，高層，實用面積，業主自住",
        `${facts}業主自住。${cta}`,
      ],
      ["a body without the filler is unchanged", "業主誠意放售", `${facts}業主誠意放售。${cta}`],
    ];
    for (const [name, body, expected] of cases) {
      test(name, () => {
        expect(listingSeoDescription({ ...unit, description: body })).toBe(expected);
      });
    }
  });

  test("keeps the call to action even when the body copy is long", () => {
    // The bug this pins: appending sentences until the budget ran out dropped
    // the CTA, because it was appended last.
    const description = listingSeoDescription({
      ...bareUnit,
      description:
        "豪景花園位於青山公路青龍頭段 100 號，由華懋集團發展，1986 至 1991 年分三期落成，共 28 座、約 2,830 個單位，背山面海，生活配套齊備。",
    });
    expect(description).toContain("WhatsApp 即時預約睇樓或免費估價。晉誠地產 C-018613。");
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

describe("facts the generator must not get wrong", () => {
  test("prefers the estate's district over the listing's inferred one", () => {
    // properties.district_slug is inferred from free text and inferDistrictSlug
    // (src/lib/mls/normalize-old-site.mjs) ends `return "tsuen-wan"`, so every
    // unrecognised place became 荃灣. richUnit carries that wrong value.
    expect(listingSeoTitle(richUnit)).toContain("深井");
    expect(listingSeoTitle(richUnit)).not.toContain("荃灣");
    expect(listingSeoDescription(richUnit).startsWith("深井")).toBe(true);
  });

  test("labels 青龍頭 and 油柑頭, the slugs /listings' four-entry map omits", () => {
    for (const [slug, label] of [
      ["tsing-lung-tau", "青龍頭"],
      ["yau-kom-tau", "油柑頭"],
    ] as const) {
      const title = listingSeoTitle({
        ...richUnit,
        estates: { name_zh: "豪景花園", district_slug: slug },
      });
      expect(title).toContain(label);
    }
  });

  test("prints no district at all for a slug it does not recognise", () => {
    // parse-28hse.mjs assigns the raw address to district_slug for
    // template-parsed rows, so an unknown value must be dropped, not printed.
    const title = listingSeoTitle({
      ...richUnit,
      estates: { name_zh: "碧堤半島", district_slug: "青山公路深井段 33 號" },
      district_slug: null,
    });
    expect(title).toBe("碧堤半島｜高層 3 房｜售 $1,180萬｜實用 968 呎｜晉誠地產");
  });

  test("strips the deal marker and internal listing number out of a scraped title", () => {
    // titleFor in normalize-old-site.mjs builds `${building} 售盤 #${no}`.
    const seo = listingSeo({
      listing_no: "OLD-1-S",
      title_zh: "浪翠園 售盤 #OLD-1",
      district_slug: "sham-tseng",
      deal_type: "sale",
      price: 6_280_000,
    });
    expect(seo.title).not.toContain("售盤 #OLD-1");
    expect(seo.description).not.toContain("#OLD-1");
    expect(seo.description).toContain("深井浪翠園");
  });

  test("strips the ` - 晉誠地產` suffix a source title can carry", () => {
    const seo = listingSeo({
      listing_no: "X-2",
      title_zh: "西半山單位 - 晉誠地產",
      deal_type: "sale",
      price: 9_000_000,
    });
    expect(seo.title.match(/晉誠地產/g)).toHaveLength(1);
  });

  test("says 已售出 / 已租出 on a gone listing, in both strings", () => {
    // The page is noindexed, but og:title/og:description still render wherever
    // the URL was already shared, so the copy must not present it as available.
    const sold = listingSeo({ ...richUnit, status: "sold" });
    expect(sold.title).toContain("已售出");
    expect(sold.description).toContain("（已售出）");
    expect(sold.description).not.toContain("即時預約睇樓");

    const rented = listingSeo({
      ...richUnit,
      deal_type: "rent",
      price: null,
      rent: 32_000,
      status: "rented",
    });
    expect(rented.title).toContain("已租出");
    expect(rented.description).toContain("（已租出）");
  });

  test("never prints a zero asking price", () => {
    // formatManDisplay divides by 10,000, so a nonsense sub-$5,000 price
    // rounded to "$0萬".
    for (const price of [1, 500, 9_999]) {
      expect(listingSeoTitle({ ...richUnit, price })).not.toContain("$0萬");
    }
  });

  test("caps the description subject so a long source title cannot starve the facts", () => {
    const description = listingSeoDescription({
      listing_no: "L-1",
      title_zh: "青山公路深井段臨海豪宅特色單位連天台花園及雙車位全屋豪華裝修即買即住 售盤 #L-1",
      district_slug: "sham-tseng",
      deal_type: "sale",
      price: 42_000_000,
      bedrooms: 4,
      saleable_area: 2100,
      floor: "高層",
    });
    // The facts that qualify a searcher survive the long headline.
    expect(description).toContain("實用 2,100 呎");
    expect(description).toContain("售 $4,200萬");
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
  });

  test("does not prepend a district the subject already names", () => {
    const description = listingSeoDescription({
      listing_no: "P-9",
      title_zh: "青山公路住宅 租盤 #P-9",
      district_slug: "castle-peak-road",
      deal_type: "rent",
      rent: 21_000,
    });
    expect(description).not.toContain("青山公路青山公路");
  });

  test("reserves the leading segment so a long head cannot drop the price", () => {
    const title = listingSeoTitle({
      listing_no: "L-2",
      title_zh: "青山公路深井段臨海豪宅特色單位連天台花園及雙車位全屋豪華裝修即買即住",
      district_slug: "sham-tseng",
      deal_type: "sale",
      price: 42_000_000,
      bedrooms: 4,
      floor: "高層",
    });
    expect(title).toContain("高層 4 房");
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
  });

  test("trims an over-budget authored title as a backstop", () => {
    // PropertyForm caps the field at 200 characters and admin.cms.tsx at none.
    // The admin width counter is the real fix; this stops a 400-unit <title>.
    const title = listingSeoTitle({
      ...richUnit,
      seo_title: "碧堤半島深井臨海三房海景單位業主親自放售即買即住全屋新裝修連車位歡迎預約睇樓",
    });
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
    expect(title.endsWith("｜晉誠地產")).toBe(true);
  });

  test("tops a bare ingested row up to the snippet floor with what the page renders", () => {
    // 28hse rows have no `description`, so the body-copy filler never fires and
    // the commonest listing shape shipped under the 90-unit floor.
    const description = listingSeoDescription(bareUnit);
    expect(displayWidth(description)).toBeGreaterThanOrEqual(90);
    expect(description).toContain("浪翠園");
  });

  test("a leading (晉誠地產…) tag in the source title never reaches the description", () => {
    const description = listingSeoDescription({
      listing_no: "Z-1",
      title_zh: "(晉誠地產筍盤推介) 9座極高層樓皇橋海!附設靚裝修!有匙即看!",
    });
    expect(description).not.toContain("晉誠地產筍盤推介");
  });

  test("the context sentence makes no 成交紀錄 claim", () => {
    const description = listingSeoDescription(bareUnit);
    expect(description).toContain("一頁睇齊浪翠園同屋苑其他放盤同交通配套。");
    expect(description).not.toContain("成交紀錄");
  });

  test("does not repeat 同屋苑成交紀錄 in both the context line and the CTA", () => {
    const description = listingSeoDescription(bareUnit);
    expect(description.match(/成交紀錄/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("listingSearchSeo", () => {
  test("the unfiltered first page reads as the whole-corridor search", () => {
    const { title, description } = listingSearchSeo({ deal: "all", page: 1, total: 320 });
    expect(title).toBe("深井 青山公路 汀九放盤｜320 個真盤｜晉誠地產");
    expect(description).toContain("共 320 個");
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
    expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
  });

  test("every filter dimension changes both strings", () => {
    // /listings validates ten search params and served one title and one
    // description for the entire space; only `page` touched the title.
    const base = { deal: "all" as const, page: 1, total: 40 };
    const heads = [
      listingSearchSeo(base),
      listingSearchSeo({ ...base, deal: "sale" }),
      listingSearchSeo({ ...base, deal: "rent" }),
      listingSearchSeo({ ...base, districtSlug: "sham-tseng" }),
      listingSearchSeo({ ...base, estateName: "碧堤半島" }),
      listingSearchSeo({ ...base, bedrooms: 3 }),
      listingSearchSeo({ ...base, page: 2 }),
      listingSearchSeo({ ...base, total: 41 }),
    ];
    expect(new Set(heads.map((h) => h.title)).size).toBe(heads.length);
    expect(new Set(heads.map((h) => h.description)).size).toBe(heads.length);
    for (const { title, description } of heads) {
      expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
      expect(displayWidth(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_UNITS);
    }
  });

  test("a zero-result page stops promising listings it does not have", () => {
    const { title, description } = listingSearchSeo({
      deal: "rent",
      districtSlug: "sham-tseng",
      bedrooms: 4,
      page: 1,
      total: 0,
    });
    expect(title).toContain("暫無符合條件放盤");
    expect(title).not.toContain("個真盤");
    expect(description).toContain("暫時未有深井 4 房以上租盤");
    expect(displayWidth(title)).toBeLessThanOrEqual(TITLE_MAX_UNITS);
  });

  test("the 4-bedroom filter means four or more, and says so", () => {
    // The chip in listings.tsx reads 「4 房或以上」; a title promising exactly
    // four bedrooms would misdescribe the result set.
    expect(listingSearchSeo({ deal: "all", bedrooms: 4, page: 1, total: 9 }).title).toContain(
      "4 房以上",
    );
    expect(listingSearchSeo({ deal: "all", bedrooms: 0, page: 1, total: 9 }).title).toContain(
      "開放式",
    );
  });

  test("names the estate over the district when both are filtered", () => {
    const { title } = listingSearchSeo({
      deal: "sale",
      districtSlug: "sham-tseng",
      estateName: "浪翠園",
      page: 1,
      total: 12,
    });
    expect(title).toContain("浪翠園");
  });

  test("never prints a district slug it does not recognise", () => {
    const { title } = listingSearchSeo({
      deal: "all",
      districtSlug: "大欖涌, 屯門",
      page: 1,
      total: 5,
    });
    expect(title).not.toContain("屯門");
    expect(title).toContain("深井 青山公路 汀九");
  });

  test("a paginated page differs from page one in both strings", () => {
    const one = listingSearchSeo({ deal: "all", page: 1, total: 46 });
    const two = listingSearchSeo({ deal: "all", page: 2, total: 46 });
    expect(two.title).not.toBe(one.title);
    // Paginated pages self-canonicalise, so they are indexed independently and
    // must not serve page one's description verbatim.
    expect(two.description).not.toBe(one.description);
    expect(two.description).toContain("第 2 頁");
  });
});

test("SEO and shared title agree on VR claims only with a supported tour", () => {
  const withoutTour = {
    ...bareUnit,
    title_zh: "星堤 VR實景 3房",
    seo_title: "星堤 VR 實景放盤",
    seo_description: "星堤 VR實景，歡迎預約",
    video_url: "https://youtu.be/abcdefghijk",
  };
  expect(listingSeoTitle(withoutTour)).not.toContain("VR");
  expect(listingSeoDescription(withoutTour)).not.toContain("VR");
  const tour = { ...withoutTour, video_url: "https://my.matterport.com/show/?m=abc123" };
  expect(listingSeoTitle(tour)).toContain("VR");
  expect(listingSeoDescription(tour)).toContain("VR");
});
