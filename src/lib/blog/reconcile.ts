import { createHash } from "node:crypto";
import { articleInputSchema } from "./write-schemas";
import type { ArticleInput, ArticleRecord, BlogCategory, BlogSettings } from "./types";

export type InventoryArticle = {
  source: "database" | "registry" | "public";
  article: ArticleRecord;
  url: string;
  fingerprint: string;
};
export type DatabaseSnapshot = {
  targetIdentity: string;
  systemIdentifier: string;
  tables: Record<string, Record<string, unknown>[]>;
  fingerprint: string;
};
export type Inventory = {
  articles: InventoryArticle[];
  completeSources: string[];
  unresolvedSources: string[];
  settings: BlogSettings[];
  categories: BlogCategory[];
  sourceRevision: string;
  targetIdentity: string;
  database?: DatabaseSnapshot;
  /** Source bundle digest and exact public URLs (including the excluded policy route). */
  sourceDigest?: string;
  publicUrls?: string[];
  excludedUrls?: string[];
  observedAt?: string;
};
export type ImportPlan = {
  fingerprint: string;
  inventory: Inventory;
  insert: ArticleRecord[];
  conflicts: { slug: string; reason: string }[];
  unresolved: string[];
};
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("IMPORT_NON_JSON");
    return text;
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function articleInput(a: ArticleRecord): ArticleInput {
  const { id, version, slugLocked, createdAt, editState, ...input } = a;
  // Validate without adopting schema transformations: import preserves exact source strings.
  articleInputSchema.parse({
    ...input,
    categoryId: input.categoryId?.startsWith("category:")
      ? "00000000-0000-4000-8000-000000000001"
      : input.categoryId,
  });
  return input;
}
export function candidate(input: ArticleInput, source: "registry" | "public"): ArticleRecord {
  const id = source + ":" + input.slug;
  return {
    ...input,
    id,
    createdAt: "",
    version: 0,
    slugLocked: true,
    editState: {
      resourceId: id,
      draftRevisionId: null,
      draftVersion: null,
      draftEditVersion: null,
      currentPublishedVersion: null,
      basePublishedVersion: null,
      restoredFromRevisionId: null,
    },
  };
}
export function inventoryArticle(
  source: InventoryArticle["source"],
  article: ArticleRecord,
  url: string,
): InventoryArticle {
  return { source, article, url, fingerprint: fingerprint(article) };
}
export function buildImportPlan(input: Inventory): ImportPlan {
  const inventory = structuredClone(input);
  const order = <T>(items: T[]) => {
    const keyed = items.map((item) => ({ item, key: canonical(item) }));
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    items.splice(0, items.length, ...keyed.map((x) => x.item));
  };
  order(inventory.articles);
  order(inventory.categories);
  order(inventory.settings);
  inventory.completeSources.sort();
  inventory.unresolvedSources.sort();
  inventory.publicUrls?.sort();
  inventory.excludedUrls?.sort();
  const unresolved = [...inventory.unresolvedSources];
  if (inventory.categories.some((category) => category.key === "全部"))
    unresolved.push("reserved-category-key:全部");
  for (const name of ["database", "registry", "public", "presentation"])
    if (!inventory.completeSources.includes(name)) unresolved.push("source:" + name);
  if (!inventory.sourceRevision || !inventory.targetIdentity)
    unresolved.push("source-or-target-identity");
  const groups = new Map<string, InventoryArticle[]>();
  for (const item of inventory.articles) {
    const slug = item.article.slug;
    if (item.fingerprint !== fingerprint(item.article))
      unresolved.push("fingerprint:" + item.source + ":" + slug);
    try {
      articleInput(item.article);
      if (!item.url || new URL(item.url).pathname !== "/blog/" + slug) throw new Error();
    } catch {
      unresolved.push("invalid-article:" + item.source + ":" + slug);
    }
    groups.set(slug, [...(groups.get(slug) ?? []), item]);
  }
  const insert: ArticleRecord[] = [],
    conflicts: ImportPlan["conflicts"] = [];
  for (const [slug, records] of groups) {
    const database = records.filter((x) => x.source === "database"),
      sources = records.filter((x) => x.source !== "database");
    if (database.length) {
      if (
        sources.some((s) =>
          database.some(
            (d) =>
              fingerprint(articleComparable(d.article)) !==
              fingerprint(articleComparable(s.article)),
          ),
        )
      )
        conflicts.push({ slug, reason: "database-authoritative" });
      continue;
    }
    if (
      inventory.database?.tables.cms_content_revisions?.some(
        (r) => (r.payload as Record<string, unknown>)?.slug === slug,
      )
    ) {
      conflicts.push({ slug, reason: "database-history-authoritative" });
      continue;
    }
    if (new Set(sources.map((s) => s.source)).size !== sources.length) {
      conflicts.push({ slug, reason: "duplicate-source-slug" });
      continue;
    }
    if (new Set(sources.map((s) => fingerprint(articleComparable(s.article)))).size > 1) {
      conflicts.push({ slug, reason: "source-disagreement" });
      continue;
    }
    if (!unresolved.some((x) => x.endsWith(":" + slug)) && sources[0])
      insert.push(sources[0].article);
  }
  order(insert);
  order(conflicts);
  const body = { inventory, insert, conflicts, unresolved: [...new Set(unresolved)].sort() };
  return { fingerprint: fingerprint(body), ...body };
}
function articleComparable(a: ArticleRecord) {
  const { id, version, createdAt, slugLocked, editState, ...content } = a;
  return content;
}
export function sanitizedSummary(plan: ImportPlan) {
  return {
    fingerprint: plan.fingerprint,
    targetIdentity: plan.inventory.targetIdentity,
    sourceRevision: plan.inventory.sourceRevision,
    sourceDigest: plan.inventory.sourceDigest,
    counts: {
      database: plan.inventory.completeSources.includes("database")
        ? plan.inventory.articles.filter((x) => x.source === "database").length
        : null,
      liveRows: plan.inventory.database?.tables.articles?.length ?? null,
      revisionRows: plan.inventory.database?.tables.cms_content_revisions?.length ?? null,
      registry: plan.inventory.articles.filter((x) => x.source === "registry").length,
      public: plan.inventory.articles.filter((x) => x.source === "public").length,
      insert: plan.insert.length,
      categories: plan.inventory.categories.length,
      settings: plan.inventory.settings.length,
    },
    excludedUrls: plan.inventory.excludedUrls ?? [],
    conflicts: plan.conflicts,
    unresolved: plan.unresolved,
    ready: plan.conflicts.length === 0 && plan.unresolved.length === 0,
  };
}
