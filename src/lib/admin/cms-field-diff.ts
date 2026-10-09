/**
 * Field-by-field difference between two CMS payloads, in the labels the CMS form shows.
 *
 * One source for both the 還原 confirmation ("which unsaved fields will be replaced") and
 * the 「與已發布版本比較」 table, so the two can never disagree about what changed.
 */
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

function display(value: unknown): string {
  if (value === null || value === undefined) return CMS_BLANK_VALUE;
  if (Array.isArray(value)) {
    const items = value.map((item) => (item == null ? "" : String(item).trim())).filter(Boolean);
    return items.length ? items.join("、") : CMS_BLANK_VALUE;
  }
  // The only boolean in these payloads is an article's 公開狀態; the CMS table words it the same.
  if (typeof value === "boolean") return value ? "已發布" : "草稿";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.trim() === "" ? CMS_BLANK_VALUE : text;
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
    const from = display(before[key]);
    const to = display(next[key]);
    if (from !== to) changes.push({ key, label, before: from, after: to });
  }
  let otherChanged = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (key in labels || IGNORED_KEYS.has(key)) continue;
    if (display(before[key]) !== display(next[key])) otherChanged += 1;
  }
  return { changes, otherChanged };
}
