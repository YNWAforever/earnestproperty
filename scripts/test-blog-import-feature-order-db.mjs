import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withOwnedPostgres } from "./acceptance/owned-postgres-test.mjs";
import { PINNED_POSTGRES_18 } from "../src/lib/neon/owned-postgres-images.ts";

const ownedOptions = process.argv.includes("--pg18") ? { image: PINNED_POSTGRES_18 } : {};

for (const key of [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "TEST_DATABASE_URL",
  "CMS_TEST_DATABASE_URL",
  "ASTRA_TEST_DATABASE_URL",
])
  assert.ok(!process.env[key], "Owned-only suite refuses " + key);
const withImportTestPostgres = (run) => withOwnedPostgres(run, ownedOptions);
await withImportTestPostgres(async ({ containerId, query }) => {
  const { verifyImportTarget, snapshotDatabase, applyImport, verifyImport } =
    await import("../src/lib/neon/blog-import.ts");
  const { inventoryFromSnapshots } = await import("../src/lib/blog/import-snapshots.ts");
  const { buildImportPlan } = await import("../src/lib/blog/reconcile.ts");
  const { blogArticles } = await import("../src/content/blog-articles.ts");
  const identity = "owned:" + containerId + ":postgres",
    config = { containerId, targetIdentity: identity };
  const dir = mkdtempSync(join(tmpdir(), "blog-feature-order-")),
    targets = [];
  async function open(extra = {}) {
    const t = await verifyImportTarget({ ...config, ...extra });
    targets.push(t);
    return t;
  }
  async function authorize(plan) {
    const bytes = JSON.stringify(plan.inventory.database),
      path = join(dir, plan.fingerprint + ".json");
    writeFileSync(path, bytes);
    return open({
      authorization: {
        planFingerprint: plan.fingerprint,
        backupPath: path,
        backupSha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
  }
  try {
    const reader = await open();
    const categories = await query(
      "INSERT INTO blog_categories(key,name,navigation_order,version) VALUES('買樓攻略','買樓攻略',0,2),('額外分類','額外分類',1,2) RETURNING *",
    );
    await query(
      "UPDATE blog_settings SET heading='原有標題',introduction='原有文案',version=3 WHERE scope_kind='main'",
    );
    for (const c of categories) {
      await query("INSERT INTO blog_legacy_category_map(legacy_key,category_id) VALUES($1,$2)", [
        c.key,
        c.id,
      ]);
      await query(
        "INSERT INTO blog_settings(scope_kind,category_id,heading,introduction,version) VALUES('category',$1,'原有標題','原有文案',3)",
        [c.id],
      );
      const offset = c.key === "買樓攻略" ? 0 : 2;
      for (let i = 1; i <= 2; i++) {
        const id = "00000000-0000-4000-8000-" + String(offset + i).padStart(12, "0");
        const row = (
          await query(
            "INSERT INTO articles(id,slug,title,content,category,category_id,published,published_at,slug_locked,version) VALUES($1,$2,'原文標題','原文內容',$3,$4,true,null,true,1) RETURNING to_jsonb(articles) payload",
            [id, "existing-order-" + (offset + i), c.key, c.id],
          )
        )[0];
        await query(
          "INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,published_at) VALUES('article',$1,1,'published',$2::jsonb,null)",
          [id, JSON.stringify(row.payload)],
        );
      }
    }
    const scopes = await query("SELECT * FROM blog_settings");
    const expected = new Map();
    for (const s of scopes) {
      const c = categories.find((c) => c.id === s.category_id);
      const offset = c?.key === "額外分類" ? 2 : 0;
      const low = "00000000-0000-4000-8000-" + String(offset + 1).padStart(12, "0");
      const high = "00000000-0000-4000-8000-" + String(offset + 2).padStart(12, "0");
      expected.set(s.id, [high, low]);
      await query(
        "INSERT INTO blog_featured_articles(scope_id,article_id,position) VALUES($1,$2,1),($1,$3,0)",
        [s.id, low, high],
      );
    }
    const base = new URL("../docs/superpowers/evidence/blog-cms/", import.meta.url);
    const presentation = JSON.parse(
      readFileSync(new URL("public-blog-presentation-snapshot.json", base), "utf8"),
    );
    presentation.navigationCategoryKeys = ["買樓攻略"];
    presentation.pages = presentation.pages.filter(
      (p) => p.categoryKey === null || p.categoryKey === "買樓攻略",
    );
    const article = {
      ...JSON.parse(JSON.stringify(blogArticles[0])),
      slug: "feature-order-new",
      category: "買樓攻略",
    };
    const sitemap = JSON.parse(readFileSync(new URL("public-sitemap-snapshot.json", base), "utf8"));
    sitemap.urls = ["https://www.earnestproperty.com/blog/feature-order-new"];
    sitemap.articleCount = 1;
    const bundle = {
      sourceRevision: "owned-feature-order-fixture",
      registry: [article],
      sitemap,
      presentation,
    };
    const before = await snapshotDatabase(reader, 2);
    for (const s of scopes) {
      const captured = before.tables.blog_featured_articles.filter((f) => f.scope_id === s.id);
      assert.deepEqual(
        captured.map((f) => f.article_id),
        [...expected.get(s.id)].reverse(),
        "capture is deliberately in reverse editorial order",
      );
    }
    const plan = buildImportPlan(inventoryFromSnapshots(bundle, identity, before));
    assert.deepEqual(plan.unresolved, []);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.insert.length, 1);
    const receipt = await applyImport(plan, await authorize(plan));
    assert.equal(receipt.writes, 1);
    assert.equal(receipt.counts.settings, 0);
    assert.equal(receipt.counts.categories, 0);
    const after = await snapshotDatabase(reader);
    assert.deepEqual(after.tables.blog_settings, before.tables.blog_settings);
    assert.deepEqual(after.tables.blog_featured_articles, before.tables.blog_featured_articles);
    for (const s of scopes) {
      const ordered = await query(
        "SELECT article_id FROM blog_featured_articles WHERE scope_id=$1 ORDER BY position",
        [s.id],
      );
      assert.deepEqual(
        ordered.map((f) => f.article_id),
        expected.get(s.id),
      );
    }
    assert.equal((await query("SELECT id FROM articles WHERE slug='feature-order-new'")).length, 1);
    assert.equal((await verifyImport(plan, reader)).verification, "unchanged");
    const fresh = buildImportPlan(inventoryFromSnapshots(bundle, identity, after));
    assert.deepEqual(fresh.unresolved, []);
    assert.deepEqual(fresh.conflicts, []);
    assert.equal(fresh.insert.length, 0);
    const noChange = await applyImport(fresh, await authorize(fresh));
    assert.equal(noChange.writes, 0);
    assert.equal(noChange.counts.settings, 0);
    console.log(
      "PASS fresh reconciliation preserves reverse-ID editorial feature order in all three scopes",
    );
  } finally {
    for (const t of targets) await t.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
