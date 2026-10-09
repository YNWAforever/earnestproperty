/**
 * Field-by-field difference between two CMS payloads, in the labels the CMS form shows.
 *
 * One source for both the 還原 confirmation ("which unsaved fields will be replaced") and
 * the 「與已發布版本比較」 table, so the two can never disagree about what changed.
 */
import { formatHkDateTime } from "@/lib/format";

export type CmsDiffResource = "estate" | "article";

/** Keys of AdminEstateInput / AdminArticleInput, labelled as the 內容中心 form shows them. */
export const CMS_FIELD_LABELS: Record<CmsDiffResource, Record<string, string>> = {
  estate: {
    slug: "網址代稱（Slug）",
    name_zh: "中文名",
    name_en: "英文名",
    district_slug: "地區",
    developer: "發展商",
    year_completed: "落成年份",
    phases: "期數",
    total_units: "伙數",
    area_min: "面積下限（平方呎）",
    area_max: "面積上限（平方呎）",
    facilities: "設施",
    description: "描述",
    hero_image: "屋苑主圖",
    seo_title: "SEO 標題",
    seo_description: "SEO 描述",
  },
  article: {
    slug: "網址代稱（Slug）",
    title: "標題",
    category: "分類",
    reading_minutes: "閱讀分鐘",
    excerpt: "摘要",
    content: "內容",
    cover_image: "封面圖片",
    published: "公開狀態",
    published_at: "發布日期",
    seo_title: "SEO 標題",
    seo_description: "SEO 描述",
  },
};

export type CmsFieldChange = { key: string; label: string; before: string; after: string };

export const CMS_BLANK_VALUE = "（空白）";

/** Row identity and audit columns: they differ on every save and are never content. */
const IGNORED_KEYS = new Set(["id", "created_at", "updated_at", "created_by", "updated_by"]);

/** Timestamps staff read in Hong Kong time; they compare by instant, not by ISO spelling. */
const DATE_KEYS = new Set(["published_at", "verified_at"]);
// No leading zeros: "0123" stays text (a code); "500.0" reads as 500.
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Plain-language text for one nested value: keys in a stable order, never "[object Object]". */
function nested(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(nested).filter(Boolean).join("；");
  if (typeof value === "object")
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${key}: ${nested((value as Record<string, unknown>)[key])}`)
      .join("、");
  return String(value).trim();
}

/** What a value says, and the form it is compared in (an instant for dates). */
function read(key: string, value: unknown): { text: string; compare: string } {
  if (value === null || value === undefined) return { text: CMS_BLANK_VALUE, compare: "" };
  if (Array.isArray(value)) {
    const items = value.map(nested).filter(Boolean);
    const text = items.length
      ? items.join(value.some((item) => item && typeof item === "object") ? "；" : "、")
      : CMS_BLANK_VALUE;
    return { text, compare: items.length ? text : "" };
  }
  // The only boolean in these payloads is an article's 公開狀態; the CMS table words it the same.
  if (typeof value === "boolean") {
    const text = value ? "已發布" : "草稿";
    return { text, compare: text };
  }
  if (typeof value === "object") {
    const text = nested(value);
    return { text: text || CMS_BLANK_VALUE, compare: text };
  }
  const raw = String(value);
  const trimmed = raw.trim();
  if (trimmed === "") return { text: CMS_BLANK_VALUE, compare: "" };
  if (DATE_KEYS.has(key)) {
    const time = new Date(trimmed).getTime();
    const shown = formatHkDateTime(trimmed);
    if (!Number.isNaN(time) && shown) return { text: shown, compare: `@${time}` };
  }
  if (NUMERIC.test(trimmed)) {
    const number = String(Number(trimmed));
    return { text: number, compare: number };
  }
  return { text: raw, compare: raw };
}

/** Compares only labelled keys; id, created_at, updated_at, created_by, updated_by are ignored.
 *  Arrays join with "、"; null, undefined and "" read 「（空白）」; numbers compare by value.
 *  `labels` lets a form with more fields (the standalone estate editor) name its own. */
export function cmsFieldDiff(
  resource: CmsDiffResource,
  base: Record<string, unknown> | null,
  next: Record<string, unknown>,
  labels: Record<string, string> = CMS_FIELD_LABELS[resource],
): { changes: CmsFieldChange[]; otherChanged: number } {
  const before = base ?? {};
  const changes: CmsFieldChange[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const from = read(key, before[key]);
    const to = read(key, next[key]);
    if (from.compare !== to.compare)
      changes.push({ key, label, before: from.text, after: to.text });
  }
  let otherChanged = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (key in labels || IGNORED_KEYS.has(key)) continue;
    if (read(key, before[key]).compare !== read(key, next[key]).compare) otherChanged += 1;
  }
  return { changes, otherChanged };
}
