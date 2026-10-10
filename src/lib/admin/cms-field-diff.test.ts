import { expect, test } from "bun:test";
import { CMS_FIELD_LABELS, cmsFieldDiff } from "./cms-field-diff";

test("reports every labelled field that differs, including arrays, numbers and blanks, and counts unlabelled ones", () => {
  const base = {
    id: "estate-1",
    slug: "sea-view",
    name_zh: "海景花園",
    name_en: "Sea View",
    facilities: ["會所", "泳池"],
    area_min: 500,
    developer: "發展商甲",
    description: "",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    created_by: "staff-a",
    updated_by: "staff-a",
    aliases: ["舊名"],
    address: "舊地址",
  };
  const next = {
    ...base,
    id: "estate-2",
    name_zh: "海景花園二期",
    name_en: null,
    facilities: ["會所"],
    area_min: 650,
    description: "新描述",
    created_at: "2026-10-09T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
    created_by: "staff-b",
    updated_by: "staff-b",
    aliases: ["新名"],
    address: "新地址",
  };
  const { changes, otherChanged } = cmsFieldDiff("estate", base, next);
  expect(changes).toEqual([
    { key: "name_zh", label: "中文名", before: "海景花園", after: "海景花園二期" },
    { key: "name_en", label: "英文名", before: "Sea View", after: "（空白）" },
    { key: "area_min", label: "面積下限（平方呎）", before: "500", after: "650" },
    { key: "facilities", label: "設施", before: "會所、泳池", after: "會所" },
    { key: "description", label: "描述", before: "（空白）", after: "新描述" },
  ]);
  // aliases and address differ but are not labelled; id and the audit columns are ignored.
  expect(otherChanged).toBe(2);
});

test("a null base (never published) lists every non-blank field", () => {
  const { changes, otherChanged } = cmsFieldDiff("article", null, {
    id: "article-1",
    slug: "buying-guide",
    title: "置業指南",
    excerpt: "",
    content: null,
    reading_minutes: 6,
    published: false,
    seo_title: "置業指南 SEO",
    created_at: "2026-10-09T00:00:00Z",
  });
  expect(changes.map((change) => change.label)).toEqual([
    "網址代稱（Slug）",
    "標題",
    "閱讀分鐘",
    "公開狀態",
    "SEO 標題",
  ]);
  expect(changes.every((change) => change.before === "（空白）")).toBe(true);
  expect(changes.find((change) => change.key === "published")?.after).toBe("草稿");
  expect(otherChanged).toBe(0);
});

test("identical payloads give no changes", () => {
  expect(
    cmsFieldDiff(
      "estate",
      { slug: "a", facilities: ["會所"], area_min: 500, name_en: null, developer: "" },
      { slug: "a", facilities: ["會所"], area_min: "500", name_en: "", developer: undefined },
    ),
  ).toEqual({ changes: [], otherChanged: 0 });
});

test("labels are the form's own labels for every editable payload key", () => {
  expect(Object.keys(CMS_FIELD_LABELS.estate)).toEqual([
    "slug",
    "name_zh",
    "name_en",
    "district_slug",
    "developer",
    "year_completed",
    "phases",
    "total_units",
    "area_min",
    "area_max",
    "facilities",
    "description",
    "hero_image",
    "seo_title",
    "seo_description",
  ]);
  expect(Object.values(CMS_FIELD_LABELS.article)).toEqual([
    "網址代稱（Slug）",
    "標題",
    "分類",
    "閱讀分鐘",
    "摘要",
    "內容",
    "封面圖片",
    "公開狀態",
    "發布日期",
    "SEO 標題",
    "SEO 描述",
  ]);
});

test("a caller can label extra keys its own form shows, so they are not counted as system fields", () => {
  const { changes, otherChanged } = cmsFieldDiff(
    "estate",
    { slug: "a", address: "舊地址", verified_at: null },
    { slug: "a", address: "新地址", verified_at: null },
    { ...CMS_FIELD_LABELS.estate, address: "地址" },
  );
  expect(changes).toEqual([{ key: "address", label: "地址", before: "舊地址", after: "新地址" }]);
  expect(otherChanged).toBe(0);
});

test("numeric strings compare by value however they are written", () => {
  expect(
    cmsFieldDiff(
      "estate",
      { area_min: 500, area_max: "1.50", year_completed: "2001" },
      { area_min: "500.0", area_max: 1.5, year_completed: 2001 },
    ),
  ).toEqual({ changes: [], otherChanged: 0 });
  expect(cmsFieldDiff("estate", { area_min: 500 }, { area_min: "550" }).changes).toEqual([
    { key: "area_min", label: "面積下限（平方呎）", before: "500", after: "550" },
  ]);
});

test("nested objects compare with a stable key order and arrays of objects read as key: value", () => {
  const labels = { meta: "Meta", rooms: "Rooms" };
  expect(
    cmsFieldDiff(
      "estate",
      { meta: { a: 1, b: { c: 2, d: 3 } } },
      { meta: { b: { d: 3, c: 2 }, a: 1 } },
      labels,
    ),
  ).toEqual({ changes: [], otherChanged: 0 });
  expect(
    cmsFieldDiff("estate", { geo: { x: 1, y: 2 } }, { geo: { y: 2, x: 1 } }).otherChanged,
  ).toBe(0);
  const { changes } = cmsFieldDiff(
    "estate",
    { rooms: [{ name: "會所", floor: 1 }] },
    { rooms: [{ name: "會所", floor: 2 }, { name: "泳池" }] },
    labels,
  );
  expect(changes).toEqual([
    {
      key: "rooms",
      label: "Rooms",
      before: "floor: 1、name: 會所",
      after: "floor: 2、name: 會所；name: 泳池",
    },
  ]);
  expect(JSON.stringify(changes)).not.toContain("[object Object]");
});

test("dates show in Hong Kong time and compare by instant", () => {
  expect(
    cmsFieldDiff(
      "article",
      { published_at: "2026-10-01T02:30:00.000Z" },
      { published_at: "2026-10-01T10:30:00+08:00" },
    ),
  ).toEqual({ changes: [], otherChanged: 0 });
  expect(
    cmsFieldDiff("article", { published_at: null }, { published_at: "2026-10-01T02:30:00.000Z" })
      .changes,
  ).toEqual([
    { key: "published_at", label: "發布日期", before: "（空白）", after: "01/10/2026 10:30" },
  ]);
  const verified = cmsFieldDiff(
    "estate",
    { verified_at: "2026-10-08T09:15:00.000Z" },
    { verified_at: null },
    { verified_at: "核實狀態" },
  ).changes[0];
  expect(verified.before).toBe("08/10/2026 17:15");
});
