import { describe, expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children?: ReactNode;
    to?: string;
    params?: { slug?: string };
    search?: Record<string, unknown>;
    className?: string;
  }) => {
    const path = (to ?? "").replace("$slug", String(params?.slug ?? ""));
    const query = Object.entries(search ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("&");
    return createElement("a", { href: query ? `${path}?${query}` : path, className }, children);
  },
}));

const { ListingEstateMarketSummary } = await import("./ListingEstateMarketSummary");

type Row = {
  yearFilter: number;
  ref: string;
  registrationDate: string | null;
  instrumentDate: string | null;
  nature: string | null;
  phase: string | null;
  tower: string | null;
  houseId: string | null;
  floor: string | null;
  unit: string | null;
  considerationMillion: number | null;
  grossAreaSqft: number | null;
  pricePerSqft: number | null;
  psfBasis: "建築" | "實用" | null;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  yearFilter: 2026,
  ref: "TEST0001",
  registrationDate: "2026-03-02",
  instrumentDate: "2026-02-11",
  nature: "買賣合約",
  phase: "滿庭",
  tower: "第03座",
  houseId: null,
  floor: "12",
  unit: "B",
  considerationMillion: 6.5,
  grossAreaSqft: null,
  pricePerSqft: null,
  psfBasis: null,
  ...overrides,
});

const market = (overrides: Record<string, unknown> = {}) => ({
  estate: {
    slug: "demo-estate",
    nameZh: "示範屋苑",
    sourcePackage: "estates-61" as const,
    asOf: "2026-11-23T01:51:39+08:00",
    registrationThrough: "2026-03-02",
    rowCount: 5,
    status: "covered" as const,
    note: null,
    listSourceUrl: null,
    pairedRowCount: 0,
    dedupedDealCount: 5,
    mixedSameUnitCount: 0,
  },
  rows: [row(), row({ ref: "TEST0002" }), row({ ref: "TEST0003" }), row({ ref: "TEST0004" })],
  total: 5,
  page: 1,
  pageCount: 1,
  pageSize: 20,
  facets: { years: [], natures: [], phases: [] },
  activeFilters: { year: null, nature: null, phase: null },
  ...overrides,
});

const render = (props: Record<string, unknown>) =>
  load(
    renderToStaticMarkup(
      createElement(ListingEstateMarketSummary, {
        market: (props.market ?? market()) as never,
        estateNameZh: (props.estateNameZh ?? "示範屋苑") as string,
      }),
    ),
  );

describe("ListingEstateMarketSummary", () => {
  test("shows at most three estate-level registrations and links to the estate page", () => {
    const $ = render({});
    const section = $("section[aria-labelledby='listing-estate-market-heading']");
    expect(section.find("h2").text()).toBe("示範屋苑 市場註冊成交");
    expect(section.find("tbody tr")).toHaveLength(3);
    expect(section.text()).toContain("5 筆來源紀錄");
    expect(section.text()).toContain("更新於 2026-11-23");
    expect(section.find("a").attr("href")).toBe("/estate/demo-estate?mtPage=1");
    expect(section.text()).toContain("查看 示範屋苑 全部市場註冊成交");
  });

  test("a source row with no area or 呎價 stays blank, never zero or an estate average", () => {
    const $ = render({});
    const cells = $("tbody tr")
      .first()
      .find("td")
      .map((_, cell) => $(cell).text())
      .get();
    expect(cells[3]).toBe("—");
    expect($("section").text()).not.toContain("$0");
  });

  test("filtered-empty estates say so honestly instead of implying no sales", () => {
    const $ = render({
      market: market({
        rows: [],
        total: 0,
        estate: {
          slug: "demo-estate",
          nameZh: "示範屋苑",
          sourcePackage: "estates-61",
          asOf: "2026-11-23T01:51:39+08:00",
          registrationThrough: null,
          rowCount: 0,
          status: "filtered-empty",
          note: null,
          listSourceUrl: null,
          pairedRowCount: 0,
          dedupedDealCount: 0,
          mixedSameUnitCount: 0,
        },
      }),
    });
    const text = $("section").text();
    expect(text).toContain("此公開來源的 2021–2026 列表未有此屋苑紀錄");
    expect(text).toContain("不代表此屋苑沒有成交");
    expect($("tbody tr")).toHaveLength(0);
    expect($("section").text()).not.toContain("本行成交");
  });
});
