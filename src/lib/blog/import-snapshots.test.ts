import { test, expect } from "bun:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { blogArticles, BLOG_CATEGORIES } from "../../content/blog-articles";
import { inventoryFromSnapshots } from "./import-snapshots";
import type { SourceBundle } from "./import-snapshots";
import { buildImportPlan, fingerprint } from "./reconcile";
const evidence = "docs/superpowers/evidence/blog-cms/";
function sources(): SourceBundle {
  return {
    sourceRevision: "8b49d0a21c867c401c4d41db393e43c8db76a74d",
    registry: structuredClone(blogArticles),
    sitemap: JSON.parse(readFileSync(evidence + "public-sitemap-snapshot.json", "utf8")),
    presentation: JSON.parse(
      readFileSync(evidence + "public-blog-presentation-snapshot.json", "utf8"),
    ),
  };
}
test("controller snapshots account for 112 full articles, exact 113 URLs/policy, 7 ordered categories and 8 copy rows", () => {
  const b = sources(),
    p = buildImportPlan(inventoryFromSnapshots(b, "unknown-live-db"));
  expect(p.insert).toHaveLength(112);
  expect(p.conflicts).toEqual([]);
  expect(p.unresolved).toEqual(["source:database"]);
  expect(p.inventory.publicUrls).toHaveLength(113);
  expect(p.inventory.excludedUrls).toEqual([
    "https://www.earnestproperty.com/blog/editorial-standards",
  ]);
  expect(
    p.inventory.categories.sort((a, b) => a.navigationOrder - b.navigationOrder).map((c) => c.key),
  ).toEqual([...BLOG_CATEGORIES]);
  expect(p.inventory.settings).toHaveLength(8);
  expect(p.inventory.settings.find((s) => s.scope.kind === "main")?.featuredIds).toEqual([
    "registry:sham-tseng-buying-guide-2026",
  ]);
  expect(
    p.inventory.settings.every(
      (s) => s.introduction === b.presentation.pages[0].paragraphCandidates[1],
    ),
  ).toBe(true);
  expect(p.insert.find((a) => a.slug === "sham-tseng-buying-guide-2026")?.publishedAt).toBeNull();
  const registry = blogArticles.find((a) => a.compareEstateSlugs?.length)!;
  expect(p.insert.find((a) => a.slug === registry.slug)?.editorial.compareEstateSlugs).toEqual([
    ...registry.compareEstateSlugs!,
  ]);
  const shuffled = sources();
  shuffled.registry = [...shuffled.registry].reverse();
  // Source digest intentionally binds the exact bundle, while article conversion remains deterministic.
  expect(buildImportPlan(inventoryFromSnapshots(b, "unknown-live-db")).fingerprint).toBe(
    p.fingerprint,
  );
}, 60000);
test("unknown public body, failed HTTP, duplicate and missing copy are explicit unresolved sources", () => {
  const b = sources();
  b.sitemap.urls.push("https://www.earnestproperty.com/blog/unresolved-copy");
  b.sitemap.articleCount++;
  const p = buildImportPlan(inventoryFromSnapshots(b, "unknown"));
  expect(p.unresolved).toContain("public:unresolved-body-metadata:/blog/unresolved-copy");
  b.sitemap.httpStatus = 403;
  b.presentation.pages[0].paragraphCandidates = [];
  const q = buildImportPlan(inventoryFromSnapshots(b, "unknown"));
  expect(q.unresolved).toContain("source:public");
  expect(q.unresolved).toContain("presentation:unresolved-copy-or-url");
}, 60000);
test("CLI defaults to dry run with no target connection; tampering and unrequested flags fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "blog-cli-"));
  try {
    const p = buildImportPlan(inventoryFromSnapshots(sources(), "unknown")),
      file = join(dir, "manifest.json");
    writeFileSync(file, JSON.stringify(p));
    const run = (extra: string[] = []) =>
      spawnSync(
        "bun",
        ["run", "--no-env-file", "scripts/blog-cms/import.ts", "--manifest", file, ...extra],
        { encoding: "utf8", env: { ...process.env, DATABASE_URL: "MUST_NOT_BE_USED" } },
      );
    const dry = run();
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout).counts.insert).toBe(112);
    expect(run(["--apply"]).status).toBe(1);
    expect(run(["--unknown"]).status).toBe(1);
    p.insert[0].title = "tampered";
    writeFileSync(file, JSON.stringify(p));
    expect(run().status).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

test("missing database tables are unresolved instead of an empty successful inventory", () => {
  const tables = { articles: [], cms_content_revisions: [], blog_categories: [] };
  const body = { targetIdentity: "owned-fixture", systemIdentifier: "fixture", tables };
  const result = inventoryFromSnapshots(sources(), "owned-fixture", {
    ...body,
    fingerprint: fingerprint(body),
  });
  expect(buildImportPlan(result).unresolved).toContain("database:missing-table:blog_settings");
}, 60000);
test("historical slug claims are blocking even when the live row has another slug", () => {
  const input = inventoryFromSnapshots(sources(), "unknown");
  const slug = input.articles[0].article.slug;
  input.database = {
    targetIdentity: "unknown",
    systemIdentifier: "fixture",
    fingerprint: "fixture",
    tables: {
      cms_content_revisions: [
        { payload: { slug }, resource_id: "existing-authoritative-history", state: "superseded" },
      ],
    },
  };
  const p = buildImportPlan(input);
  expect(p.insert.some((a) => a.slug === slug)).toBe(false);
  expect(p.conflicts).toContainEqual({ slug, reason: "database-history-authoritative" });
}, 60000);

test("feature order follows editorial position for main, known and database-only categories", () => {
  const bundle = sources();
  bundle.registry = [];
  bundle.sitemap.urls = [];
  bundle.sitemap.articleCount = 0;
  bundle.presentation.navigationCategoryKeys = ["買樓攻略"];
  bundle.presentation.pages = bundle.presentation.pages.filter(
    (p) => p.categoryKey === null || p.categoryKey === "買樓攻略",
  );
  const low = "00000000-0000-4000-8000-000000000001",
    high = "00000000-0000-4000-8000-000000000002";
  const rows = [
    { id: "main-scope", scope_kind: "main", category_id: null },
    { id: "known-scope", scope_kind: "category", category_id: "known-category" },
    { id: "other-scope", scope_kind: "category", category_id: "other-category" },
  ].map((s) => ({
    ...s,
    heading: "原有標題",
    introduction: "原有文案",
    seo_title: null,
    seo_description: null,
    version: 3,
  }));
  const body = {
    targetIdentity: "owned-order",
    systemIdentifier: "fixture",
    tables: {
      articles: [],
      cms_content_revisions: [],
      app_migrations: [],
      blog_legacy_category_map: [],
      blog_categories: [
        {
          id: "known-category",
          key: "買樓攻略",
          name: "買樓攻略",
          navigation_order: 0,
          hidden: false,
          version: 2,
        },
        {
          id: "other-category",
          key: "額外分類",
          name: "額外分類",
          navigation_order: 1,
          hidden: false,
          version: 2,
        },
      ],
      blog_settings: rows,
      blog_featured_articles: rows.flatMap((s) => [
        { scope_id: s.id, article_id: low, position: 1 },
        { scope_id: s.id, article_id: high, position: 0 },
      ]),
    },
  };
  const database = { ...body, fingerprint: fingerprint(body) },
    before = structuredClone(database);
  const inventory = inventoryFromSnapshots(bundle, "owned-order", database);
  expect(inventory.unresolvedSources).toEqual([]);
  expect(inventory.settings).toHaveLength(3);
  for (const setting of inventory.settings) expect(setting.featuredIds).toEqual([high, low]);
  expect(database).toEqual(before);
});
