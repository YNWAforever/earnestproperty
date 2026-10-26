import { describe, expect, mock, test } from "bun:test";
import { load } from "cheerio";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children?: ReactNode;
    params?: { slug?: string };
    className?: string;
  }) => createElement("a", { href: `/estate/${params?.slug ?? ""}`, className }, children),
}));

const { PropertyDetailCopy } = await import("./PropertyDetailCopy");

const taiTouWaan = {
  name_zh: "帝濤灣",
  slug: "tai-tou-waan",
  developer: "新鴻基地產",
  year_completed: 1999,
  total_units: 856,
};

function render(props: Parameters<typeof PropertyDetailCopy>[0]) {
  return load(renderToStaticMarkup(createElement(PropertyDetailCopy, props)));
}

describe("PropertyDetailCopy", () => {
  test("a linked estate shows the short description and 屋苑資料, not feature chips", () => {
    const $ = render({
      description: "帝濤灣 海琴軒，中層，實用面積 670 平方呎，3 房，1 浴室。",
      features: ["有露台", "望海景", "中冶"],
      estate: taiTouWaan,
    });

    expect($("h2").eq(0).text()).toBe("物業描述");
    expect($("p").text()).toContain("帝濤灣 海琴軒，中層，實用面積 670 平方呎，3 房，1 浴室。");
    expect($("h2").text()).not.toContain("物業特點");
    const card = $("[data-property-estate-card]");
    expect(card.find("h2").text()).toBe("屋苑資料");
    expect(card.text()).toContain("屋苑");
    expect(card.text()).toContain("帝濤灣");
    expect(card.text()).toContain("發展商");
    expect(card.text()).toContain("新鴻基地產");
    expect(card.text()).toContain("入伙年份");
    expect(card.text()).toContain("1999");
    expect(card.text()).toContain("總單位");
    expect(card.text()).toContain("856");
    expect(card.find("a").text()).toBe("查看屋苑詳情 →");
    expect(card.find("a").attr("href")).toBe("/estate/tai-tou-waan");
    const descriptionAt = $.html().indexOf("物業描述");
    const estateAt = $.html().indexOf("屋苑資料");
    expect(descriptionAt).toBeGreaterThan(-1);
    expect(estateAt).toBeGreaterThan(descriptionAt);
  });

  test("missing estate fields stay blank marks and do not invent copy", () => {
    const $ = render({
      description: null,
      features: ["有露台"],
      estate: { name_zh: "帝濤灣", slug: "tai-tou-waan", developer: null },
    });
    const card = $("[data-property-estate-card]");
    expect($("p").text()).toContain("暫無詳細描述");
    expect($("h2").text()).not.toContain("物業特點");
    expect(card.text()).toContain("發展商");
    expect(card.text()).toContain("—");
    expect(card.text()).not.toContain("有露台");
  });

  test("without an estate row, feature chips remain and 屋苑資料 is absent", () => {
    const $ = render({
      description: "單位近海",
      features: ["有露台", "望海景"],
      estate: null,
    });
    expect($("[data-property-estate-card]")).toHaveLength(0);
    expect($("h2").text()).toContain("物業特點");
    const chips = $("h2")
      .filter((_, el) => $(el).text() === "物業特點")
      .next()
      .text();
    expect(chips).toContain("有露台");
    expect(chips).toContain("望海景");
  });
});
