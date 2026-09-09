import { expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Renders the real homepage estate grid against fixtures and asserts the
 * client's 2026-09-07 ordering (網頁07092026.docx p2/p3) and the 其他 control's
 * ARIA wiring on actual markup -- rather than only asserting that a source file
 * contains a name.
 *
 * Same isolation tradeoff as BlogEstateComparisonTable.test.tsx: the grid
 * renders @tanstack/react-router's <Link>, which throws outside a
 * <RouterProvider>, so the router is mocked down to a plain <a>.
 */
mock.module("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
    hidden,
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
    className?: string;
    hidden?: boolean;
  }) => {
    const href = params
      ? Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)
      : to;
    return createElement("a", { href, className, hidden }, children);
  },
}));

const { CoreEstateGrid } = await import("./EstateGroupGrid");
const { coreEstates } = await import("@/content/core-estates");
const { castlePeakRoadEstates, castlePeakRoadOtherEstates } =
  await import("@/content/castle-peak-road-estates");

/** A live, published DB row for every static entry, so nothing is filtered out. */
function liveRowsFor(estates: Array<{ slug: string }>) {
  return estates.map((estate) => ({
    slug: estate.slug,
    name_zh: estate.slug,
    district_slug: "castle-peak-road",
    total_units: 100,
    avg_saleable_psf: 10000,
    hero_image: null,
  }));
}

function renderWest({ withOther = true } = {}) {
  const other = withOther ? castlePeakRoadOtherEstates : [];
  return load(
    renderToStaticMarkup(
      createElement(CoreEstateGrid, {
        estates: liveRowsFor([...castlePeakRoadEstates, ...other]),
        counts: {},
        staticEstates: castlePeakRoadEstates,
        districtLabel: "青山公路",
        previewCount: castlePeakRoadEstates.length,
        otherEstates: other,
        otherId: "castle-peak-road-other-estates",
      }),
    ),
  );
}

const cardNames = ($: ReturnType<typeof load>, scope: string) =>
  $(`${scope} h3`)
    .toArray()
    .map((node) => $(node).text().trim());

test("the western primary cards render in the client's exact order", () => {
  const $ = renderWest();
  expect(cardNames($, "body > div:first-of-type")).toEqual([
    "帝濤灣",
    "愛琴海岸",
    "香港黃金海岸",
    "滿名山",
    "黃金海灣",
    "帝御系列",
    "星堤",
    "上源",
  ]);
});

test("the client's order is the DOM order, never produced by CSS", () => {
  const $ = renderWest();
  // Tailwind's order utilities as whole class tokens (order-1, order-first,
  // …). Matched on the token rather than a substring, since `border-*` also
  // contains "order-".
  const reordered = $("[class]")
    .toArray()
    .filter((node) =>
      ($(node).attr("class") ?? "")
        .split(/\s+/)
        .some((token) => /^(?:[a-z]+:)*-?order-/.test(token)),
    );
  expect(reordered.length).toBe(0);
});

test("no primary card is truncated by a preview limit", () => {
  const $ = renderWest();
  const cards = $("body > div:first-of-type > a");
  expect(cards.length).toBe(castlePeakRoadEstates.length);
  expect(cards.filter("[hidden]").length).toBe(0);
});

test("其他 is an accessible button wired to a real region, not a hover menu", () => {
  const $ = renderWest();
  const button = $("button[aria-controls]");
  expect(button.length).toBe(1);
  expect(button.attr("type")).toBe("button");
  expect(button.attr("aria-expanded")).toBe("false");
  const controls = button.attr("aria-controls");
  expect(controls).toBe("castle-peak-road-other-estates");
  // aria-controls must resolve to an element that actually exists.
  expect($("#castle-peak-road-other-estates").length).toBe(1);
  // Collapsed by default via the `hidden` attribute rather than a CSS-only
  // rule, so assistive tech and find-in-page agree with the visuals.
  expect($("#castle-peak-road-other-estates").attr("hidden")).toBeDefined();
  expect(button.attr("class")).toContain("focus-visible:outline");
  expect(button.text()).toContain("其他");
});

test("其他 reveals exactly the client's four resolved secondary estates, in order", () => {
  const $ = renderWest();
  // Scoped to the revealed grid, not the region: the region's own
  // "其他 4 個屋苑" heading is an <h3> too, and is not an estate card.
  expect(cardNames($, "#castle-peak-road-other-estates > div")).toEqual([
    "Oma Oma",
    "The Carmel",
    "漣山",
    "浪濤灣",
  ]);
});

test("no estate is rendered in both tiers", () => {
  const $ = renderWest();
  const hrefs = $("a[href^='/estate/']")
    .toArray()
    .map((node) => $(node).attr("href"));
  expect(new Set(hrefs).size).toBe(hrefs.length);
});

test("其他 never becomes an estate card or a detail-page link", () => {
  const $ = renderWest();
  const hrefs = $("a[href^='/estate/']")
    .toArray()
    .map((node) => $(node).attr("href"));
  expect(hrefs).not.toContain("/estate/other");
  // The control is a button; it must not be an anchor to anywhere, and it
  // carries no unit count, price or listing figure of its own.
  const button = $("button[aria-controls]");
  expect(button.text()).not.toContain("個單位");
  expect(button.text()).not.toContain("$");
});

test("a group with no secondary estates renders no 其他 control at all", () => {
  const $ = renderWest({ withOther: false });
  expect($("button[aria-controls]").length).toBe(0);
  expect($("#castle-peak-road-other-estates").length).toBe(0);
});

test("the 深井 / 青龍頭 cards render in the client's exact order, 帝華軒 included", () => {
  const $ = load(
    renderToStaticMarkup(
      createElement(CoreEstateGrid, {
        estates: liveRowsFor(coreEstates),
        counts: {},
        staticEstates: coreEstates,
        districtLabel: "深井",
        previewCount: coreEstates.length,
      }),
    ),
  );
  expect(cardNames($, "body > div:first-of-type")).toEqual([
    "豪景花園",
    "帝華軒",
    "浪翠園",
    "海雲軒",
    "麗都花園",
    "碧堤半島",
    "縉皇居",
    "海韻花園",
    "海韻台",
  ]);
});

test("an estate with no live published row is omitted, never linked to a 404", () => {
  const withoutTaiWahHin = liveRowsFor(coreEstates).filter((row) => row.slug !== "tai-wah-hin");
  const $ = load(
    renderToStaticMarkup(
      createElement(CoreEstateGrid, {
        estates: withoutTaiWahHin,
        counts: {},
        staticEstates: coreEstates,
        districtLabel: "深井",
        previewCount: coreEstates.length,
      }),
    ),
  );
  const names = cardNames($, "body > div:first-of-type");
  expect(names).not.toContain("帝華軒");
  expect($("a[href='/estate/tai-wah-hin']").length).toBe(0);
  // The rest of the client's order is preserved around the gap.
  expect(names[0]).toBe("豪景花園");
  expect(names[1]).toBe("浪翠園");
});

test("missing figures render as an em dash, never a confident zero", () => {
  const $ = load(
    renderToStaticMarkup(
      createElement(CoreEstateGrid, {
        estates: [
          {
            slug: "bellagio",
            name_zh: "碧堤半島",
            district_slug: "sham-tseng",
            total_units: null,
            avg_saleable_psf: null,
            hero_image: null,
          },
        ],
        counts: {},
        staticEstates: coreEstates.filter((estate) => estate.slug === "bellagio"),
        districtLabel: "深井",
        previewCount: 1,
      }),
    ),
  );
  expect($("body").text()).toContain("—");
  expect($("body").text()).not.toContain("$0");
});
