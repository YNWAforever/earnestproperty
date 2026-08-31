import { describe, expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { EstateComparisonRow } from "./BlogEstateComparisonTable";

// BlogEstateComparisonTable renders @tanstack/react-router's <Link>, which
// throws outside a <RouterProvider>. renderToStaticMarkup here only needs a
// plain <a>, so this mock avoids standing up a full router just to test
// markup -- same tradeoff AppImage.test.tsx makes by testing the component in
// isolation rather than inside its real app tree. Must run before the
// component (and its static `Link` import) is loaded, hence the dynamic
// import below instead of a static one.
mock.module("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
    className?: string;
  }) => {
    const href = params
      ? Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
      : to;
    return createElement("a", { href, className }, children);
  },
}));

const { BlogEstateComparisonTable } = await import("./BlogEstateComparisonTable");

function render(node: ReturnType<typeof createElement>) {
  return load(renderToStaticMarkup(node));
}

const bellagio: EstateComparisonRow = {
  slug: "bellagio",
  nameZh: "碧堤半島",
  hasPage: true,
  avgPsf: 15000,
  totalUnits: 2000,
  yearCompleted: 2003,
  developer: "新鴻基地產",
};

const seaCrestVilla: EstateComparisonRow = {
  slug: "sea-crest-villa",
  nameZh: "浪翠園",
  hasPage: true,
  avgPsf: null,
  totalUnits: 3164,
  yearCompleted: null,
  developer: null,
};

describe("BlogEstateComparisonTable", () => {
  test("renders one column per estate and one row per comparison fact", () => {
    const $ = render(
      createElement(BlogEstateComparisonTable, { estates: [bellagio, seaCrestVilla] }),
    );
    expect($("thead th")).toHaveLength(3); // label column + 2 estates
    expect($("tbody tr")).toHaveLength(4); // avgPsf, totalUnits, yearCompleted, developer
  });

  test("links an estate's column header to /estate/$slug when hasPage is true", () => {
    const $ = render(createElement(BlogEstateComparisonTable, { estates: [bellagio] }));
    const link = $("thead a");
    expect(link).toHaveLength(1);
    expect(link.attr("href")).toBe("/estate/bellagio");
    expect(link.text()).toBe("碧堤半島");
  });

  test("does not link an estate's column header when hasPage is false", () => {
    const unpublished: EstateComparisonRow = { ...bellagio, slug: "hoi-wan-toi", hasPage: false };
    const $ = render(createElement(BlogEstateComparisonTable, { estates: [unpublished] }));
    expect($("thead a")).toHaveLength(0);
    expect($("thead th").eq(1).text()).toBe("碧堤半島");
  });

  test("renders an em dash for null fields instead of a fabricated value", () => {
    const $ = render(createElement(BlogEstateComparisonTable, { estates: [seaCrestVilla] }));
    const cells = $("tbody td");
    // row order: avgPsf, totalUnits, yearCompleted, developer -- each row has
    // [label, value] cells, so the estate's value cell is index 1, 3, 5, 7
    expect(cells.eq(1).text()).toBe("—");
    expect(cells.eq(3).text()).toBe("3,164 個");
    expect(cells.eq(5).text()).toBe("— 年");
    expect(cells.eq(7).text()).toBe("—");
  });

  test("renders nothing when given zero estates", () => {
    const $ = render(createElement(BlogEstateComparisonTable, { estates: [] }));
    expect($("table")).toHaveLength(0);
    expect($("section")).toHaveLength(0);
  });
});
