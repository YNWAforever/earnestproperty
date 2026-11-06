import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withOwnedPostgres } from "./acceptance/owned-postgres-test.mjs";
for (const key of [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "TEST_DATABASE_URL",
  "CMS_TEST_DATABASE_URL",
  "ASTRA_TEST_DATABASE_URL",
])
  assert.ok(!process.env[key], "Owned-only suite refuses " + key);
await withOwnedPostgres(async ({ containerId, query }) => {
  const { verifyImportTarget, snapshotDatabase, applyImport, verifyImport } =
    await import("../src/lib/neon/blog-import.ts");
  const { fingerprint, buildImportPlan, candidate, inventoryArticle } =
    await import("../src/lib/blog/reconcile.ts");
  const { databaseInventory } = await import("../src/lib/blog/import-snapshots.ts");
  const identity = "owned:" + containerId + ":postgres";
  const config = { containerId, targetIdentity: identity };
  const dir = mkdtempSync(join(tmpdir(), "earnest-blog-import-"));
  const targets = [];
  const open = async (extra = {}) => {
    const t = await verifyImportTarget({ ...config, ...extra });
    targets.push(t);
    return t;
  };
  let passed = 0;
  const check = async (name, fn) => {
    await fn();
    console.log("PASS " + name);
    passed++;
  };
  const fixture = JSON.parse(
    readFileSync(new URL("../src/lib/blog/fixtures/import-source.json", import.meta.url), "utf8"),
  );
  const reader = await open();
  async function planFor(inputs = [fixture]) {
    const database = await snapshotDatabase(reader, 2);
    const db = databaseInventory(database, "https://example.invalid");
    return buildImportPlan({
      articles: [
        ...db.articles,
        ...inputs.map((a) =>
          inventoryArticle(
            "registry",
            candidate(a, "registry"),
            "https://example.invalid/blog/" + a.slug,
          ),
        ),
      ],
      completeSources: ["database", "registry", "public", "presentation"],
      unresolvedSources: db.unresolved,
      categories: [],
      settings: [],
      sourceRevision: "fixture-v1",
      sourceDigest: fingerprint(inputs),
      targetIdentity: identity,
      database,
    });
  }
  async function authorized(plan) {
    const path = join(dir, randomUUID() + ".json");
    const data = JSON.stringify(plan.inventory.database);
    writeFileSync(path, data);
    return open({
      authorization: {
        planFingerprint: plan.fingerprint,
        backupPath: path,
        backupSha256: fingerprintBytes(data),
      },
    });
  }
  function fingerprintBytes(data) {
    return createHash("sha256").update(data).digest("hex");
  }
  try {
    await check("explicit identity, backup and approval gates", async () => {
      await assert.rejects(verifyImportTarget({ ...config, targetIdentity: "wrong" }), /TARGET/);
      const p = await planFor();
      await assert.rejects(applyImport(p, reader), /APPROVAL/);
      await assert.rejects(
        open({
          authorization: {
            planFingerprint: p.fingerprint,
            backupPath: join(dir, "absent"),
            backupSha256: "bad",
          },
        }),
      );
    });
    let receipt, original, writer;
    await check(
      "atomic import creates matching locked live/revision, null date, links and editorial metadata",
      async () => {
        original = await planFor([
          fixture,
          { ...fixture, slug: "fixture-future", publishedAt: "2099-01-01T00:00:00.000Z" },
          { ...fixture, slug: "fixture-unpublished", published: false },
        ]);
        writer = await authorized(original);
        receipt = await applyImport(original, writer);
        assert.equal(receipt.inserted.length, 3);
        assert.equal(receipt.writes, 3);
        const rows = await query(
          "SELECT a.*,r.payload,r.state FROM articles a JOIN cms_content_revisions r ON r.resource_id=a.id WHERE a.slug LIKE 'fixture-%'",
        );
        assert.equal(rows.length, 3);
        const a = rows.find((r) => r.slug === fixture.slug);
        assert.equal(a.published_at, null);
        assert.equal(a.slug_locked, true);
        assert.equal(a.version, 1);
        assert.equal(a.content, fixture.body.text);
        assert.deepEqual(a.editorial_metadata, fixture.editorial);
        assert.deepEqual(a.supplemental_links, fixture.links);
        assert.equal(a.payload.published_at, null);
        assert.equal(rows.find((r) => r.slug === "fixture-unpublished").state, "archived");
        assert.equal(rows.find((r) => r.slug === "fixture-unpublished").published, false);
        assert.equal(
          rows.find((r) => r.slug === "fixture-future").published_at.toISOString(),
          "2099-01-01T00:00:00.000Z",
        );
      },
    );
    await check(
      "lost-response retry resumes committed checkpoint with zero duplicates",
      async () => {
        const again = await applyImport(original, writer);
        assert.equal(again.writes, 0);
        assert.equal(again.verification, "unchanged");
        assert.deepEqual(again.inserted, receipt.inserted);
        assert.equal(Number((await query("SELECT count(*) n FROM blog_import_receipts"))[0].n), 1);
      },
    );
    await check(
      "Task4 CMS tokens edit imported article without first-publish/date fabrication",
      async () => {
        const actor = randomUUID();
        await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [actor]);
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin')", [actor]);
        const id = receipt.inserted.find((x) => x.slug === fixture.slug).id;
        const doc = (await query("SELECT blog_article_document($1,$2) d", [id, actor]))[0].d;
        assert.equal(doc.editState.currentPublishedVersion, 1);
        const saved = (
          await query("SELECT blog_save_article($1,$2::jsonb) d", [
            actor,
            JSON.stringify({
              id,
              expectedVersion: 1,
              editState: doc.editState,
              action: "save",
              requestId: randomUUID(),
              payload: { ...doc.payload, title: "編輯後" },
            }),
          ])
        )[0].d;
        assert.equal(saved.version, 2);
        assert.equal(saved.published_at, null);
        const replay = await applyImport(original, writer);
        assert.equal(replay.writes, 0);
        assert.equal(replay.verification, "changed");
        assert.equal(
          (await query("SELECT title FROM articles WHERE id=$1", [id]))[0].title,
          "編輯後",
        );
        assert.equal((await verifyImport(original, reader)).verification, "changed");
      },
    );
    await check(
      "all revisions including another actor draft-only identity block static collision",
      async () => {
        const id = randomUUID();
        await query(
          "INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload) VALUES('article',$1,7,'draft',$2)",
          [
            id,
            JSON.stringify({
              slug: "private-draft",
              title: "私人",
              content: "私稿",
              category: null,
              reading_minutes: 5,
            }),
          ],
        );
        const p = await planFor([{ ...fixture, slug: "private-draft" }]);
        assert.equal(p.insert.length, 0);
        assert.equal(p.conflicts[0].reason, "database-authoritative");
        assert.ok(
          p.inventory.database.tables.cms_content_revisions.some((r) => r.resource_id === id),
        );
        await assert.rejects(applyImport(p, await authorized(p)), /BLOCKED/);
        assert.equal(
          (await query("SELECT state FROM cms_content_revisions WHERE resource_id=$1", [id]))[0]
            .state,
          "draft",
        );
      },
    );
    await check(
      "freshness detects intervening version/history/source changes before any write",
      async () => {
        const p = await planFor([{ ...fixture, slug: "freshness" }]),
          t = await authorized(p);
        await query(
          "UPDATE articles SET title='direct newer',version=version+1 WHERE slug='fixture-future'",
        );
        await assert.rejects(applyImport(p, t), /STALE/);
        assert.equal((await query("SELECT id FROM articles WHERE slug='freshness'")).length, 0);
        const changed = structuredClone(original);
        changed.inventory.sourceRevision = "new-source";
        await assert.rejects(applyImport(changed, writer), /MANIFEST/);
      },
    );
    await check(
      "database failure rolls back article/revision/checkpoint; same manifest can resume",
      async () => {
        const p = await planFor([
            { ...fixture, slug: "rollback-a" },
            { ...fixture, slug: "rollback-z" },
          ]),
          t = await authorized(p);
        await query(
          "CREATE FUNCTION fail_blog_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.slug='rollback-z' THEN RAISE EXCEPTION 'injected-import-failure'; END IF; RETURN NEW; END $$",
        );
        await query(
          "CREATE TRIGGER fail_blog_import BEFORE INSERT ON articles FOR EACH ROW EXECUTE FUNCTION fail_blog_import()",
        );
        await assert.rejects(applyImport(p, t), /injected-import-failure/);
        assert.equal(
          (await query("SELECT id FROM articles WHERE slug LIKE 'rollback-%'")).length,
          0,
        );
        assert.equal(
          (
            await query(
              "SELECT id FROM cms_content_revisions WHERE payload->>'slug' LIKE 'rollback-%'",
            )
          ).length,
          0,
        );
        assert.equal(
          (
            await query("SELECT fingerprint FROM blog_import_receipts WHERE fingerprint=$1", [
              p.fingerprint,
            ])
          ).length,
          0,
        );
        await query("DROP TRIGGER fail_blog_import ON articles");
        await query("DROP FUNCTION fail_blog_import()");
        assert.equal((await applyImport(p, t)).writes, 2);
      },
    );

    await check(
      "112 deployed registry articles and 7 categories/8 settings import with exact copy and feature scope",
      async () => {
        const { blogArticles } = await import("../src/content/blog-articles.ts");
        const { inventoryFromSnapshots } = await import("../src/lib/blog/import-snapshots.ts");
        const base = new URL("../docs/superpowers/evidence/blog-cms/", import.meta.url);
        const bundle = {
          sourceRevision: "8b49d0a21c867c401c4d41db393e43c8db76a74d",
          registry: JSON.parse(JSON.stringify(blogArticles)),
          sitemap: JSON.parse(readFileSync(new URL("public-sitemap-snapshot.json", base), "utf8")),
          presentation: JSON.parse(
            readFileSync(new URL("public-blog-presentation-snapshot.json", base), "utf8"),
          ),
        };
        const database = await snapshotDatabase(reader, 2);
        const p = buildImportPlan(inventoryFromSnapshots(bundle, identity, database));
        assert.deepEqual(p.unresolved, []);
        assert.deepEqual(p.conflicts, []);
        assert.equal(p.insert.length, 112);
        const t = await authorized(p);
        const both = await Promise.all([applyImport(p, t), applyImport(p, t)]);
        assert.deepEqual(
          both.map((r) => r.writes).sort((a, b) => a - b),
          [0, 112],
        );
        assert.equal((await verifyImport(p, reader)).verification, "unchanged");
        assert.equal((await query("SELECT id FROM blog_categories")).length, 7);
        const settings = await query("SELECT * FROM blog_settings");
        assert.equal(settings.length, 8);
        assert.ok(
          settings.every(
            (s) => s.introduction === bundle.presentation.pages[0].paragraphCandidates[1],
          ),
        );
        const featured = await query(
          "SELECT a.slug,s.scope_kind FROM blog_featured_articles f JOIN articles a ON a.id=f.article_id JOIN blog_settings s ON s.id=f.scope_id",
        );
        assert.deepEqual(featured, [{ slug: "sham-tseng-buying-guide-2026", scope_kind: "main" }]);
        const categories = await query("SELECT key FROM blog_categories ORDER BY navigation_order");
        assert.deepEqual(
          categories.map((c) => c.key),
          bundle.presentation.navigationCategoryKeys,
        );
        const normalized = buildImportPlan(
          inventoryFromSnapshots(bundle, identity, await snapshotDatabase(reader)),
        );
        assert.equal(normalized.insert.length, 0);
        assert.deepEqual(normalized.conflicts, []);
        const next = await applyImport(normalized, await authorized(normalized));
        assert.equal(next.writes, 0);
        assert.equal(next.counts.settings, 0);
        await query(
          "UPDATE blog_settings SET introduction='new editorial copy',version=version+1 WHERE scope_kind='main'",
        );
        const replay = await applyImport(p, t);
        assert.equal(replay.verification, "changed");
        assert.equal(replay.writes, 0);
        assert.equal(
          (await query("SELECT introduction FROM blog_settings WHERE scope_kind='main'"))[0]
            .introduction,
          "new editorial copy",
        );
        const manifestPath = join(dir, "verify-manifest.json"),
          sourcePath = join(dir, "verify-sources.json");
        writeFileSync(manifestPath, JSON.stringify(p));
        writeFileSync(sourcePath, JSON.stringify(bundle));
        const verification = spawnSync(
          "bun",
          [
            "run",
            "--no-env-file",
            "scripts/blog-cms/import.ts",
            "--verify",
            "--manifest",
            manifestPath,
            "--sources",
            sourcePath,
            "--fingerprint",
            p.fingerprint,
            "--container",
            containerId,
            "--target",
            identity,
          ],
          { encoding: "utf8", timeout: 60000, env: process.env },
        );
        assert.equal(verification.status, 2, "verification drift must be a non-success exit");
        assert.equal(verification.stderr, "");
        assert.equal(JSON.parse(verification.stdout).verification, "changed");
      },
    );

    await check(
      "unpublished imports retain draft-only behavior with Task4 edit tokens",
      async () => {
        const actor = randomUUID();
        await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [actor]);
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin')", [actor]);
        const id = receipt.inserted.find((x) => x.slug === "fixture-unpublished").id;
        const doc = (await query("SELECT blog_article_document($1,$2) d", [id, actor]))[0].d;
        assert.equal(doc.published, false);
        assert.equal(doc.editState.currentPublishedVersion, null);
        const result = (
          await query("SELECT blog_save_article($1,$2::jsonb) d", [
            actor,
            JSON.stringify({
              id,
              expectedVersion: doc.version,
              editState: doc.editState,
              action: "save",
              requestId: randomUUID(),
              payload: { ...doc.payload, title: "私人修訂" },
            }),
          ])
        )[0].d;
        assert.equal(result.published, false);
        assert.ok(result.editState.draftRevisionId);
        assert.equal(
          (await query("SELECT published FROM articles WHERE id=$1", [id]))[0].published,
          false,
        );
      },
    );

    console.log("PASS " + passed + " owned import DB groups");
  } finally {
    for (const t of targets) await t.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
import { createHash } from "node:crypto";
