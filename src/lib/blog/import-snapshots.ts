import type { BlogArticleMeta } from "../../content/blog-articles";
import { convertRegistryArticle } from "./registry-content";
import { decodeArticle } from "./article-codec";
import { candidate, fingerprint, inventoryArticle } from "./reconcile";
import type { DatabaseSnapshot, Inventory, InventoryArticle } from "./reconcile";
import type { BlogCategory, BlogSettings } from "./types";

type Row = Record<string, unknown>;
const nullable = (v: unknown) => (v == null ? null : String(v));
export function databaseInventory(snapshot: DatabaseSnapshot, origin: string) {
  const articles: InventoryArticle[] = [],
    unresolved: string[] = [];
  for (const table of [
    "articles",
    "cms_content_revisions",
    "blog_categories",
    "blog_settings",
    "blog_featured_articles",
    "blog_legacy_category_map",
    "app_migrations",
  ])
    if (!Array.isArray(snapshot.tables[table])) unresolved.push("database:missing-table:" + table);
  const rows = snapshot.tables.articles ?? [],
    revisions = snapshot.tables.cms_content_revisions ?? [];
  const categories = snapshot.tables.blog_categories ?? [];
  const add = (row: Row, revision?: Row) => {
    const id = String(revision?.resource_id ?? row.id);
    const p = revision ? { ...(revision.payload as Row) } : { ...row };
    if (p.content == null || typeof p.title !== "string" || typeof p.slug !== "string") {
      unresolved.push("database:missing-body:" + id);
      return;
    }
    if (p.category_id == null && p.category != null)
      p.category_id = categories.find((c) => c.key === p.category)?.id ?? null;
    if (p.category != null && p.category_id == null) unresolved.push("database:category:" + id);
    const pub = revisions.find((r) => r.resource_id === id && r.state === "published");
    try {
      const article = decodeArticle({
        id,
        payload: p,
        published: revision ? false : row.published,
        published_at: revision
          ? Object.hasOwn(p, "published_at")
            ? p.published_at
            : revision.published_at
          : row.published_at,
        created_at: revision?.created_at ?? row.created_at,
        version: row.version ?? revision?.version_number,
        slug_locked: revision ? true : row.slug_locked,
        editState: {
          resourceId: id,
          draftRevisionId: revision?.state === "draft" ? revision.id : null,
          draftVersion: revision?.state === "draft" ? revision.version_number : null,
          draftEditVersion: revision?.state === "draft" ? revision.draft_edit_version : null,
          currentPublishedVersion: pub?.version_number ?? null,
          basePublishedVersion: revision?.base_published_version ?? pub?.version_number ?? null,
          restoredFromRevisionId: revision?.restored_from_revision_id ?? null,
        },
      });
      articles.push(inventoryArticle("database", article, origin + "/blog/" + article.slug));
    } catch {
      unresolved.push("database:invalid-content:" + id);
    }
  };
  for (const row of rows) {
    add(row);
    if (!revisions.some((r) => r.resource_id === row.id))
      unresolved.push("database:missing-history:" + String(row.id));
  }
  for (const r of revisions) {
    // Include every author's active draft, and orphan history identities. No staff-filtered UI list.
    if (
      (r.state === "draft" && r.draft_retired_at == null) ||
      !rows.some((a) => a.id === r.resource_id)
    )
      add({}, r);
  }
  return { articles, unresolved };
}
export type SourceBundle = {
  sourceRevision: string;
  registry: readonly BlogArticleMeta[];
  sitemap: {
    httpStatus: number;
    articleCount: number;
    urls: string[];
    observedAtUtc: string;
    source: string;
  };
  presentation: {
    observedAtUtc: string;
    navigationCategoryKeys: string[];
    pages: {
      categoryKey: string | null;
      url: string;
      status: number;
      heading: string;
      paragraphCandidates: string[];
      title: string;
      description: string;
      canonical: string;
    }[];
  };
};
function copy(row: Row) {
  return {
    heading: String(row.heading),
    introduction: String(row.introduction),
    seoTitle: nullable(row.seo_title),
    seoDescription: nullable(row.seo_description),
  };
}
/** Source files only. A missing DB snapshot stays explicitly unresolved. */
export function inventoryFromSnapshots(
  bundle: SourceBundle,
  targetIdentity: string,
  database?: DatabaseSnapshot,
): Inventory {
  const unresolved: string[] = [],
    completeSources = ["registry"],
    articles: InventoryArticle[] = [];
  const origin = new URL(bundle.sitemap.source).origin;
  const categories: BlogCategory[] = [],
    settings: BlogSettings[] = [];
  const dbCategories = database?.tables.blog_categories ?? [],
    dbSettings = database?.tables.blog_settings ?? [];
  const features = database?.tables.blog_featured_articles ?? [];
  const featuredIdsForScope = (scopeId: unknown) =>
    features
      .filter((feature) => feature.scope_id === scopeId)
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((feature) => String(feature.article_id));
  if (database) {
    if (
      database.targetIdentity !== targetIdentity ||
      fingerprint({
        targetIdentity: database.targetIdentity,
        systemIdentifier: database.systemIdentifier,
        tables: database.tables,
      }) !== database.fingerprint
    )
      unresolved.push("database:snapshot-identity-or-digest");
    const db = databaseInventory(database, origin);
    articles.push(...db.articles);
    unresolved.push(...db.unresolved);
    completeSources.push("database");
  }
  const keys = bundle.presentation.navigationCategoryKeys;
  if (new Set(keys).size !== keys.length) unresolved.push("presentation:duplicate-category");
  for (const [index, key] of keys.entries()) {
    const row = dbCategories.find((c) => c.key === key),
      id = String(row?.id ?? "category:" + key);
    const page = bundle.presentation.pages.find((p) => p.categoryKey === key);
    if (!page || typeof page.paragraphCandidates[1] !== "string") {
      unresolved.push("presentation:missing:" + key);
      continue;
    }
    const old = dbSettings.find((s) => s.category_id === id);
    const placeholder =
      old &&
      old.version === 1 &&
      old.heading === key &&
      old.introduction === "" &&
      old.seo_title === null &&
      old.seo_description === null &&
      !features.some((f) => f.scope_id === old.id);
    const pageCopy =
      old && !placeholder
        ? copy(old)
        : {
            heading: page.heading,
            introduction: page.paragraphCandidates[1],
            seoTitle: page.title,
            seoDescription: page.description,
          };
    categories.push({
      id,
      key,
      name: String(row?.name ?? key),
      navigationOrder:
        row && (!placeholder || row.version !== 1) ? Number(row.navigation_order) : index,
      hidden: row?.hidden === true,
      version: Number(row?.version ?? 0),
      settingsVersion: Number(old?.version ?? 0),
      ...pageCopy,
    });
    settings.push({
      scope: { kind: "category", categoryId: id },
      version: Number(old?.version ?? 0),
      featuredIds: featuredIdsForScope(old?.id),
      ...pageCopy,
    });
  }
  // Preserve DB-only categories/settings. Their copy remains authoritative.
  for (const row of dbCategories.filter((r) => !keys.includes(String(r.key)))) {
    const old = dbSettings.find((s) => s.category_id === row.id);
    if (!old) {
      unresolved.push("database:missing-settings:" + String(row.id));
      continue;
    }
    categories.push({
      id: String(row.id),
      key: String(row.key),
      name: String(row.name),
      navigationOrder: Number(row.navigation_order),
      hidden: row.hidden === true,
      version: Number(row.version),
      settingsVersion: Number(old.version),
      ...copy(old),
    });
    settings.push({
      scope: { kind: "category", categoryId: String(row.id) },
      version: Number(old.version),
      featuredIds: featuredIdsForScope(old.id),
      ...copy(old),
    });
  }
  for (const source of bundle.registry) {
    try {
      const { categoryKey, ...content } = convertRegistryArticle(source);
      const category = categories.find((c) => c.key === categoryKey);
      if (!category) {
        unresolved.push("registry:category:" + source.slug);
        continue;
      }
      const record = candidate(
        {
          ...content,
          categoryId: category.id,
          published: true,
          coverImage: null,
          coverAlt: null,
          seoTitle: null,
          seoDescription: null,
        },
        "registry",
      );
      articles.push(inventoryArticle("registry", record, origin + "/blog/" + source.slug));
    } catch {
      unresolved.push("registry:invalid:" + source.slug);
    }
  }
  const excludedUrls = bundle.sitemap.urls.filter(
    (url) => url === origin + "/blog/editorial-standards",
  );
  const seen = new Set<string>();
  for (const url of bundle.sitemap.urls) {
    if (seen.has(url)) unresolved.push("public:duplicate-url");
    seen.add(url);
    if (excludedUrls.includes(url)) continue;
    const source = articles.find((a) => a.source === "registry" && a.url === url);
    if (source) articles.push(inventoryArticle("public", structuredClone(source.article), url));
    else unresolved.push("public:unresolved-body-metadata:" + new URL(url).pathname);
  }
  if (
    bundle.sitemap.httpStatus === 200 &&
    bundle.sitemap.articleCount === bundle.sitemap.urls.length
  )
    completeSources.push("public");
  else unresolved.push("public:incomplete-sitemap");
  for (const p of bundle.presentation.pages) {
    if (
      p.status !== 200 ||
      !p.heading ||
      typeof p.paragraphCandidates[1] !== "string" ||
      p.paragraphCandidates[0] !== "市場分析 Blog" ||
      p.canonical !== origin + "/blog" ||
      p.url !==
        origin +
          "/blog" +
          (p.categoryKey === null ? "" : "?category=" + encodeURIComponent(p.categoryKey))
    )
      unresolved.push("presentation:unresolved-copy-or-url");
  }
  if (
    bundle.presentation.pages.length === keys.length + 1 &&
    bundle.presentation.pages.some((p) => p.categoryKey === null)
  )
    completeSources.push("presentation");
  const main = bundle.presentation.pages.find((p) => p.categoryKey === null),
    oldMain = dbSettings.find((s) => s.scope_kind === "main");
  if (main && typeof main.paragraphCandidates[1] === "string") {
    const placeholder =
      oldMain &&
      oldMain.version === 1 &&
      oldMain.heading === "樓市資訊" &&
      oldMain.introduction === "" &&
      oldMain.seo_title === null &&
      oldMain.seo_description === null &&
      !features.some((f) => f.scope_id === oldMain.id);
    const mainCopy =
      oldMain && !placeholder
        ? copy(oldMain)
        : {
            heading: main.heading,
            introduction: main.paragraphCandidates[1],
            seoTitle: main.title,
            seoDescription: main.description,
          };
    let featuredIds = featuredIdsForScope(oldMain?.id);
    if (!oldMain || placeholder) {
      const primary =
        articles.find(
          (a) => a.source === "database" && a.article.slug === "sham-tseng-buying-guide-2026",
        ) ??
        articles.find(
          (a) => a.source === "registry" && a.article.slug === "sham-tseng-buying-guide-2026",
        );
      if (
        primary?.article.published &&
        (primary.article.publishedAt === null ||
          Date.parse(primary.article.publishedAt) <= Date.parse(bundle.sitemap.observedAtUtc))
      )
        featuredIds = [primary.article.id];
    }
    settings.push({
      scope: { kind: "main" },
      version: Number(oldMain?.version ?? 0),
      featuredIds,
      ...mainCopy,
    });
  }
  return {
    articles,
    categories,
    settings,
    completeSources,
    unresolvedSources: unresolved,
    sourceRevision: bundle.sourceRevision,
    targetIdentity,
    ...(database ? { database } : {}),
    sourceDigest: fingerprint(bundle),
    publicUrls: bundle.sitemap.urls,
    excludedUrls,
    observedAt: bundle.sitemap.observedAtUtc,
  };
}
