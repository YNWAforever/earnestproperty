import { describe, expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The module under test only needs `Link`; the real router never renders in a
// static-markup test, so the href is rebuilt from `to`/`params`/`search`.
mock.module("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    hash,
    className,
    ...rest
  }: {
    children?: ReactNode;
    to?: string;
    params?: { slug?: string };
    search?: Record<string, unknown>;
    hash?: string;
    className?: string;
    [key: string]: unknown;
  }) => {
    const path = (to ?? "").replace("$slug", String(params?.slug ?? ""));
    const query = Object.entries(search ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("&");
    return createElement(
      "a",
      {
        href: `${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`,
        className,
        "aria-current": rest["aria-current"],
      },
      children,
    );
  },
}));

const { EstateMarketRegistrations } = await import("./EstateMarketRegistrations");

type Row = {
  yearFilter: number;
  ref: string;
  registrationDate: string | null;
  instrumentDate: string | null;
  registrationNo: string | null;
  nature: string | null;
  phase: string | null;
  tower: string | null;
  houseId: string | null;
  floor: string | null;
  unit: string | null;
  address: string | null;
  district: string | null;
  considerationMillion: number | null;
  grossAreaSqft: number | null;
  pricePerSqft: number | null;
  psfBasis: "建築" | "實用" | null;
  completionYear: number | null;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  yearFilter: 2026,
  ref: "TEST0001",
  registrationDate: "2026-03-02",
  // Two different dates on purpose: the table must never print one as if it
  // were the other.
  instrumentDate: "2026-02-11",
  registrationNo: "26030200001X1X",
  nature: "買賣合約",
  phase: null,
  tower: "第03座",
  houseId: null,
  floor: "12",
  unit: "B",
  address: "測試路 1 號",
  district: "測試區",
  considerationMillion: 6.5,
  grossAreaSqft: 900,
  pricePerSqft: 7222,
  psfBasis: "建築",
  completionYear: 2001,
  ...overrides,
});

const estate = (overrides: Record<string, unknown> = {}) => ({
  slug: "demo-estate",
  nameZh: "示範屋苑",
  sourcePackage: "estates-61" as const,
  asOf: "2026-11-23T01:51:39+08:00",
  registrationThrough: "2026-03-02",
  rowCount: 2,
  status: "covered" as const,
  note: null,
  listSourceUrl: null,
  pairedRowCount: 0,
  dedupedDealCount: 2,
  mixedSameUnitCount: 0,
  ...overrides,
});

const market = (overrides: Record<string, unknown> = {}) => ({
  estate: estate(),
  rows: [row(), row({ ref: "TEST0002", considerationMillion: null })],
  total: 2,
  page: 1,
  pageCount: 1,
  pageSize: 20,
  facets: {
    years: [
      { value: 2026, count: 2 },
      { value: 2025, count: 0 },
    ],
    natures: [
      { value: "買賣合約", count: 2 },
      { value: "臨時合約", count: 0 },
    ],
    phases: [],
  },
  activeFilters: { year: null, nature: null, phase: null },
  ...overrides,
});

const render = (props: {
  market: Record<string, unknown>;
  chart?: readonly Record<string, unknown>[];
}) =>
  load(
    renderToStaticMarkup(
      createElement(EstateMarketRegistrations, {
        market: props.market as never,
        chart: (props.chart ?? []) as never,
      }),
    ),
  );

describe("EstateMarketRegistrations", () => {
  test("renders 市場註冊成交 with registration and instrument dates in separate columns", () => {
    const $ = render({ market: market() });
    const section = $("section[aria-labelledby='market-registrations-heading']");
    expect(section.find("h2").text()).toBe("市場註冊成交");
    const headers = section.find("thead th").text();
    expect(headers).toContain("登記日期");
    expect(headers).toContain("文書日期");
    expect(section.find("tbody tr")).toHaveLength(2);
    const cells = section
      .find("tbody tr")
      .first()
      .find("td")
      .map((_, cell) => $(cell).text())
      .get();
    expect(cells[0]).not.toBe(cells[1]);
    expect(section.text()).toContain("6.500");
    expect(section.text()).toContain("900 呎");
    expect(section.text()).toContain("$7,222／呎（建築）");
  });

  test("missing price, area and 呎價 render as unavailable, never as zero", () => {
    const $ = render({
      market: market({
        rows: [
          row({
            considerationMillion: null,
            grossAreaSqft: null,
            pricePerSqft: null,
            psfBasis: null,
            floor: null,
            unit: null,
            nature: null,
          }),
        ],
        total: 1,
      }),
    });
    const cells = $("tbody tr")
      .first()
      .find("td")
      .map((_, cell) => $(cell).text())
      .get();
    expect(cells[3]).toBe("—");
    expect(cells[4]).toBe("—");
    expect(cells[5]).toBe("—");
    expect(cells[6]).toBe("—");
    expect($("section").text()).not.toContain("$0");
    expect($("section").text()).not.toContain("0 呎");
  });

  test("counts are labelled as source rows, and pairing is reported separately", () => {
    const $ = render({
      market: market({
        estate: estate({ rowCount: 4, pairedRowCount: 2, dedupedDealCount: 3 }),
        total: 4,
      }),
    });
    const text = $("section").text();
    expect(text).toContain("共 4 筆來源紀錄");
    expect(text).toContain("其中 1 組為臨時＋正式合約配對");
    expect(text).toContain("去重後 3 宗");
  });

  test("facet chips link to filtered views and keep their own counts", () => {
    const $ = render({ market: market() });
    const links = $("a").map((_, anchor) => ({
      text: $(anchor).text(),
      href: $(anchor).attr("href"),
    }));
    const values = links.get();
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "2026 2" }),
        expect.objectContaining({ text: "2025 0" }),
      ]),
    );
    expect(values.every((value) => value.href?.startsWith("/estate/demo-estate"))).toBe(true);
  });

  test("changing or clearing one facet preserves the others and resets the page", () => {
    const $ = render({
      market: market({
        activeFilters: { year: 2026, nature: "sale", phase: "A" },
        page: 2,
        pageCount: 3,
        facets: {
          years: [{ value: 2025, count: 4 }],
          natures: [{ value: "other", count: 3 }],
          phases: [
            { value: "A", count: 2 },
            { value: "B", count: 4 },
          ],
        },
      }),
    });
    const facets = $("section a[aria-current], section a")
      .toArray()
      .slice(0, 7)
      .map((el) => new URL($(el).attr("href")!, "https://example.test"));
    expect(facets.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { mtNature: "sale", mtPhase: "A", mtPage: "1" },
      { mtYear: "2025", mtNature: "sale", mtPhase: "A", mtPage: "1" },
      { mtYear: "2026", mtPhase: "A", mtPage: "1" },
      { mtYear: "2026", mtNature: "other", mtPhase: "A", mtPage: "1" },
      { mtYear: "2026", mtNature: "sale", mtPage: "1" },
      { mtYear: "2026", mtNature: "sale", mtPhase: "A", mtPage: "1" },
      { mtYear: "2026", mtNature: "sale", mtPhase: "B", mtPage: "1" },
    ]);
    expect(facets.every((url) => url.hash === "#market-registrations-heading")).toBe(true);
  });

  test("pagination exposes prev/next only when there is more than one page", () => {
    const single = render({ market: market() });
    expect(single.text()).not.toContain("下一頁");
    const many = render({
      market: market({ page: 2, pageCount: 4, total: 70, estate: estate({ rowCount: 70 }) }),
    });
    expect(many.text()).toContain("第 2 / 4 頁");
    const next = many("a")
      .filter((_, anchor) => many(anchor).text() === "下一頁")
      .attr("href");
    expect(next).toBe("/estate/demo-estate?mtPage=3#market-registrations-heading");
  });

  test("a filtered-empty source shows an honest empty state, not a demand or a zero row", () => {
    const $ = render({
      market: market({
        estate: estate({
          status: "filtered-empty",
          rowCount: 0,
          registrationThrough: null,
          dedupedDealCount: 0,
        }),
        rows: [],
        total: 0,
      }),
    });
    const text = $("section").text();
    expect(text).toContain("此公開來源於 2021–2026");
    expect(text).toContain("這不代表此屋苑沒有成交");
    expect($("tbody tr")).toHaveLength(0);
    // Facets are meaningless with no rows and must not render as filters.
    expect($("section").text()).not.toContain("年份");
  });

  test("an over-narrow filter offers a reset link instead of an empty table", () => {
    const $ = render({
      market: market({
        rows: [],
        total: 0,
        activeFilters: { year: 2025, nature: null, phase: null },
      }),
    });
    expect($("section").text()).toContain("所選條件沒有符合的紀錄");
    expect($("section").text()).toContain("清除篩選");
  });

  test("chart transcription stays separate: zero volume keeps 0 and a blank 呎價", () => {
    const $ = render({
      market: market(),
      chart: [
        {
          month: "2025-02",
          count: 0,
          avgPsf: null,
          sourceDisplayedPpsf: "$0",
          visualVerified: true,
        },
        {
          month: "2025-03",
          count: 2,
          avgPsf: 12000,
          sourceDisplayedPpsf: "$12,000",
          visualVerified: true,
        },
      ],
    });
    const details = $("details");
    expect(details.text()).toContain("來源圖表轉錄");
    const rows = details.find("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows.eq(0).find("td").eq(1).text()).toBe("0");
    expect(rows.eq(0).find("td").eq(2).text()).toBe("—");
    expect(rows.eq(1).find("td").eq(2).text()).toBe("$12,000");
    // The main table never inherits the chart's monthly rows.
    expect($("section > div > table tbody tr")).toHaveLength(2);
  });

  test("carries provenance, source period and 2026 year-to-date caveat", () => {
    const text = render({ market: market() })("section").text();
    for (const copy of ["資料來源", "2026 年為年初至今", "大部分紀錄從缺，並非零"]) {
      expect(text).toContain(copy);
    }
  });
});
