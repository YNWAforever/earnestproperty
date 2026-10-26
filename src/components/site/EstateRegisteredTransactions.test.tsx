import { expect, test } from "bun:test";
import { load } from "cheerio";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildEprcSnapshot, getEprcEstateTransactions } from "../../content/eprc-transactions";
import { EstateRegisteredTransactions } from "./EstateRegisteredTransactions";

const csv = readFileSync(
  new URL("../../content/fixtures/eprc-transactions-22-estates-20261027.csv", import.meta.url),
  "utf8",
);
const snapshot = buildEprcSnapshot(csv);
const render = (slug: string) =>
  load(
    renderToStaticMarkup(
      createElement(EstateRegisteredTransactions, {
        market: getEprcEstateTransactions(snapshot, slug),
      }),
    ),
  );

test("renders an independent labelled EPRC section with dates, location, price, both area/psf bases and nature", () => {
  const $ = render("bellagio");
  const section = $("section[aria-labelledby='market-registered-transactions-heading']");
  expect(section.find("h2").text()).toBe("市場註冊成交");
  expect(section.text()).toContain("EPRC 註冊成交");
  expect(section.text()).toContain("2026-10-27");
  expect(section.text()).toContain("13 筆");
  expect(section.text()).toContain("8 筆");
  expect(section.find("tbody tr")).toHaveLength(8);
  const first = section.find("tbody tr").first();
  expect(first.find("time").attr("datetime")).toBe("2026-10-09");
  for (const text of [
    "09/10/2026",
    "BELLAGIO TWR 05",
    "49 樓",
    "G 室",
    "6.680",
    "670 呎",
    "527 呎",
    "$9,970",
    "$12,676",
    "ASP",
  ]) {
    expect(first.text()).toContain(text);
  }
  expect(section.find("th").text()).toContain("售價（$M）");
  expect(section.find("th").text()).toContain("建築");
  expect(section.find("th").text()).toContain("實用");
  expect(section.text()).not.toContain("晉誠本行成交");
});

test("missing gross figures render as unavailable, never as zero; floors and nature are preserved", () => {
  const $ = render("oma-oma");
  const first = $("tbody tr").first();
  expect(first.text()).toContain("01 樓");
  expect(first.find("td").eq(4).text()).toBe("—");
  expect(first.text()).toContain("736 呎");
  expect(first.text()).toContain("$7,880");
  expect($("tbody tr").last().text()).toContain("P-ASP");
});

test("known empty estates still display the market section and source; uncovered estates render nothing", () => {
  const empty = Object.entries(snapshot.byEstate).filter(([, rows]) => rows.length === 0);
  expect(empty).toHaveLength(6);
  for (const [slug] of empty) {
    const $ = render(slug);
    expect($("h2").text()).toBe("市場註冊成交");
    expect($("section").text()).toContain("本次資料未有此屋苑的市場註冊成交紀錄");
    expect($("section").text()).toContain("EPRC 註冊成交");
    expect($("tbody tr")).toHaveLength(0);
  }
  expect(renderToStaticMarkup(createElement(EstateRegisteredTransactions, { market: null }))).toBe(
    "",
  );
});

test("a missing floor/unit/price or area does not create a fabricated value", () => {
  const market = getEprcEstateTransactions(snapshot, "bellagio")!;
  const row = {
    ...market.rows[0],
    floor: null,
    unit: null,
    priceMillions: null,
    grossArea: null,
    grossPsf: null,
    saleableArea: null,
    saleablePsf: null,
    nature: null,
  };
  const $ = load(
    renderToStaticMarkup(
      createElement(EstateRegisteredTransactions, { market: { rows: [row], total: 1 } }),
    ),
  );
  expect($("tbody td").eq(2).text()).toBe("—");
  expect($("tbody td").eq(3).text()).toBe("—");
  expect($("tbody td").eq(4).text()).toBe("—");
  expect($("tbody td").eq(5).text()).toBe("—");
  expect($("tbody td").eq(6).text()).toBe("—");
});
