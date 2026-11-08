// Isolated rehearsal only. Run: node --experimental-test-module-mocks scripts/blog-cms/rehearse-live-inventory.mjs
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import { withOwnedPostgres, mockOwnedServerDb } from "../acceptance/owned-postgres-test.mjs";
import { PINNED_POSTGRES_18 } from "../../src/lib/neon/owned-postgres-images.ts";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = join(root, ".private-sync-evidence/blog-import");
const rawDir = join(base, "live-database-2026-11-05T11-51-46-243Z");
const sourceDir = join(base, "public-source-2026-11-05T11-54-46-574Z");
const schemaPath = join(base, "rehearsal-schema-2026-11-05T12-09-31-923Z/schema.json");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evidence = join(base, "isolated-rehearsal-" + stamp);
mkdirSync(evidence, { recursive: false });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const files = [];
function retain(name, value) {
  const bytes = JSON.stringify(value, null, 2) + "\n";
  const path = join(evidence, name);
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o400);
  files.push({ path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) });
  return { path, sha256: sha(bytes) };
}
const report = {
  status: "RUNNING",
  startedAtUtc: new Date().toISOString(),
  layer:
    "owned PostgreSQL 18; real SQL and actual CMS/public services; locally seeded auth and DB transport binding",
  image: PINNED_POSTGRES_18,
  evidence: relative(root, evidence).replaceAll("\\", "/"),
  checks: [],
  limitations: [
    "No production or network database connection, commit, push, merge, or deployment.",
    "Captured article/history baseline is empty; unrelated production rows are not copied. Local migrations seed unrelated data.",
    "Local PostgreSQL 18.6 is not the Neon fork; hosted auth, RLS/provider behavior, HTTP rendering and deployment are not accepted by this run.",
    "Private snapshots cover importer tables, not a full Neon backup or disaster recovery; seals are exclusive-create plus hashes/read-only attributes, not WORM.",
    "Parent independently runs general importer failures, build and built HTTP acceptance; those are not PASS claims made by this harness.",
  ],
};
let stage = "input-seals";
async function check(name, fn) {
  stage = name;
  await fn();
  report.checks.push({ name, status: "PASS" });
  console.log("PASS " + name);
}
function verifySeal(dir) {
  const seal = json(join(dir, "sealed-file-manifest.json"));
  for (const entry of seal.files) {
    const path = resolve(dir, entry.path);
    assert.ok(path.startsWith(resolve(dir) + "/") || path.startsWith(resolve(dir) + "\\"));
    const bytes = readFileSync(path);
    assert.equal(bytes.length, entry.bytes, "sealed length");
    assert.equal(sha(bytes), entry.sha256, "sealed hash");
  }
  return {
    files: seal.files.length,
    sealSha256: sha(readFileSync(join(dir, "sealed-file-manifest.json"))),
  };
}

try {
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "TEST_DATABASE_URL",
    "CMS_TEST_DATABASE_URL",
    "ASTRA_TEST_DATABASE_URL",
  ])
    assert.ok(!process.env[key], "Owned rehearsal refuses " + key);
  const sourcePath = join(sourceDir, "normalized-main-navigation/source-bundle.json");
  const sourceHash = "60f95f002b0b0f1da1ad4145b7a8d02f14ab19066e9bd3a18bd9b3563a71427e";
  await check("sealed-inputs", async () => {
    report.inputs = {
      live: verifySeal(rawDir),
      source: verifySeal(sourceDir),
      sourceSha256: sha(readFileSync(sourcePath)),
      schemaSha256: sha(readFileSync(schemaPath)),
    };
    assert.equal(report.inputs.sourceSha256, sourceHash);
    assert.equal(
      report.inputs.schemaSha256,
      "1c184a49a8f31e7c93a140f8cb6f007d4c03198112aeba8a09eeb3b17acb9d80",
    );
  });
  const raw = json(join(rawDir, "database-raw.json")),
    bundle = json(sourcePath),
    schema = json(schemaPath);
  const captured95 = raw.tables.app_migrations.rows.map((r) => r.version).sort();
  const pending = MIGRATION_VERSIONS.filter((v) => !captured95.includes(v));
  assert.equal(captured95.length, 95);
  assert.deepEqual(captured95, MIGRATION_VERSIONS.slice(0, 95).toSorted());
  assert.deepEqual(pending, [
    "20261105120000_blog_presentation_contracts.sql",
    "20261105140000_blog_repository_mutations.sql",
    "20261105160000_blog_import_receipts.sql",
  ]);
  assert.equal(raw.tables.articles.count, 0);
  assert.equal(raw.tables.cms_content_revisions.count, 0);
  assert.deepEqual(raw.tables.articles.rows, []);
  assert.deepEqual(raw.tables.cms_content_revisions.rows, []);
  assert.equal(bundle.registry.length, 112);
  assert.equal(bundle.registry.filter((a) => a.publishedAt == null).length, 2);
  retain("input-binding.json", {
    ...report.inputs,
    captured95,
    pending,
    sourceRevision: bundle.sourceRevision,
    capturedLiveCounts: { articles: 0, articleRevisions: 0, ledger: 95 },
  });
  const { verifyImportTarget, snapshotDatabase, applyImport, verifyImport } =
    await import("../../src/lib/neon/blog-import.ts");
  const { buildImportPlan, fingerprint } = await import("../../src/lib/blog/reconcile.ts");
  const { inventoryFromSnapshots } = await import("../../src/lib/blog/import-snapshots.ts");
  const { articleInput } = await import("../../src/components/admin/blog/blog-editor-state.ts");
  const { seedSessions } = await import("./acceptance-scenario.mjs");
  stage = "owned-PG18-baseline";
  await withOwnedPostgres(
    async (owned) => {
      const { query, transaction, containerId } = owned;
      report.targetIdentity = "owned:" + containerId + ":postgres";
      report.serverVersion = (await query("SHOW server_version"))[0].server_version;
      assert.match(report.serverVersion, /^18\.6(?:\s|$)/);
      const targets = [];
      const open = async (extra = {}) => {
        const t = await verifyImportTarget({
          containerId,
          targetIdentity: report.targetIdentity,
          ...extra,
        });
        targets.push(t);
        return t;
      };
      try {
        await check("captured95-schema-parity", async () => {
          const comparisons = [];
          for (let i = 3; i <= 7; i++) {
            // Capture transport escaped double quotes; normalize only that SQL transport escape.
            const statement = schema.queries[i].replaceAll('\\"', '"');
            assert.match(statement, /^SELECT /);
            const actual = await query(statement);
            const normalize = (rows) =>
              rows.map((r) =>
                typeof r.definition === "string"
                  ? { ...r, definition: r.definition.replaceAll("\r\n", "\n") }
                  : r,
              );
            comparisons.push({
              queryIndex: i,
              captured: schema.values[i],
              owned: actual,
              byteEqual: fingerprint(actual) === fingerprint(schema.values[i]),
              equal: fingerprint(normalize(actual)) === fingerprint(normalize(schema.values[i])),
              normalization: "CRLF to LF in definition text only; no schema replay",
            });
          }
          retain("schema-parity.json", { comparisons });
          report.schemaParity = comparisons.map((c) => ({
            queryIndex: c.queryIndex,
            rows: c.owned.length,
            byteEqual: c.byteEqual,
            equal: c.equal,
            normalization: c.normalization,
          }));
          assert.ok(
            comparisons.every((c) => c.equal),
            "CAPTURED_SCHEMA_DRIFT: inspect private schema-parity.json",
          );
          for (const table of ["articles", "cms_content_revisions"]) {
            const columns = comparisons[0].owned
              .filter((r) => r.table_name === table)
              .map((r) => ({ name: r.column_name, type: r.data_type }));
            assert.deepEqual(columns, raw.capabilities[table].columns);
          }
          assert.equal(Number((await query("SELECT count(*) n FROM articles"))[0].n), 0);
          assert.equal(
            Number(
              (
                await query(
                  "SELECT count(*) n FROM cms_content_revisions WHERE resource_type='article'",
                )
              )[0].n,
            ),
            0,
          );
          assert.deepEqual(
            (await query("SELECT version FROM app_migrations ORDER BY version")).map(
              (r) => r.version,
            ),
            captured95,
          );
          for (const table of Object.keys(raw.capabilities).filter(
            (t) => !raw.capabilities[t].present,
          ))
            assert.equal(
              (await query("SELECT to_regclass($1) name", ["public." + table]))[0].name,
              null,
            );
        });
        // Clearly synthetic unrelated history; this is never represented as captured production data.
        const sentinelId = randomUUID();
        await query(
          "INSERT INTO cms_content_revisions(id,resource_type,resource_id,version_number,state,payload) VALUES($1,'faq',$2,1,'archived',$3::jsonb)",
          [
            sentinelId,
            randomUUID(),
            JSON.stringify({ synthetic: true, purpose: "isolated unrelated history preservation" }),
          ],
        );
        const sentinel = (
          await query("SELECT to_jsonb(r) r FROM cms_content_revisions r WHERE id=$1", [sentinelId])
        )[0].r;
        const sentinelCheck = async () =>
          assert.deepEqual(
            (
              await query("SELECT to_jsonb(r) r FROM cms_content_revisions r WHERE id=$1", [
                sentinelId,
              ])
            )[0].r,
            sentinel,
          );
        await check("three-transactional-migrations-ledger95-to98", async () => {
          const migrationFiles = pending.map((version) => ({
            version,
            sql: readFileSync(join(root, "neon/migrations", version), "utf8"),
          }));
          await transaction(
            migrationFiles.flatMap(({ version, sql }) => [
              { statement: sql },
              { statement: "INSERT INTO app_migrations(version) VALUES($1)", params: [version] },
            ]),
          );
          assert.deepEqual(
            (await query("SELECT version FROM app_migrations ORDER BY version")).map(
              (r) => r.version,
            ),
            MIGRATION_VERSIONS.toSorted(),
          );
          await sentinelCheck();
          retain("migrations.json", {
            before: 95,
            after: 98,
            atomicTransaction: true,
            files: migrationFiles.map(({ version, sql }) => ({ version, sha256: sha(sql) })),
            syntheticUnrelatedHistory: sentinel,
          });
        });
        const reader = await open();
        const database = await snapshotDatabase(reader, 7);
        const plan = buildImportPlan(
          inventoryFromSnapshots(bundle, report.targetIdentity, database),
        );
        const backup = retain("preimport-backup.json", database);
        retain("manifest.json", plan);
        report.manifestFingerprint = plan.fingerprint;
        await check("exact-fresh112-plan-no-conflicts-or-gaps", async () => {
          assert.equal(plan.insert.length, 112);
          assert.equal(plan.inventory.categories.length, 7);
          assert.equal(plan.inventory.settings.length, 8);
          assert.deepEqual(plan.conflicts, []);
          assert.deepEqual(plan.unresolved, []);
          assert.equal(plan.insert.filter((a) => a.publishedAt === null).length, 2);
          assert.deepEqual(plan.inventory.publicUrls, bundle.sitemap.urls.toSorted());
          assert.equal(plan.inventory.sourceDigest, fingerprint(bundle));
        });
        const writer = await open({
          authorization: {
            planFingerprint: plan.fingerprint,
            backupPath: backup.path,
            backupSha256: backup.sha256,
          },
        });
        let receipt;
        await check("guarded112-import-and-exact-retry-zero-writes", async () => {
          await assert.rejects(applyImport(plan, reader), /IMPORT_APPROVAL/);
          receipt = await applyImport(plan, writer);
          retain("import-receipt.json", receipt);
          assert.equal(receipt.writes, 112);
          assert.equal(receipt.inserted.length, 112);
          const after = await snapshotDatabase(reader, 7);
          retain("postimport-snapshot.json", after);
          const retry = await applyImport(plan, writer);
          assert.equal(retry.writes, 0);
          assert.equal(retry.verification, "unchanged");
          assert.deepEqual(retry.inserted, receipt.inserted);
          assert.deepEqual(await snapshotDatabase(reader, 7), after);
          assert.equal((await verifyImport(plan, reader)).verification, "unchanged");
          assert.equal(
            Number((await query("SELECT count(*) n FROM blog_import_receipts"))[0].n),
            1,
          );
          assert.equal(after.tables.articles.length, 112);
          assert.equal(after.tables.cms_content_revisions.length, 112);
          assert.equal(after.tables.blog_categories.length, 7);
          assert.equal(after.tables.blog_settings.length, 8);
          retain("retry-receipt.json", retry);
          await sentinelCheck();
        });
        process.env.NEON_AUTH_BASE_URL = "http://127.0.0.1/owned-auth-fixture";
        process.env.ADMIN_BOOTSTRAP_EMAILS = "";
        await mockOwnedServerDb(mock, query, transaction);
        await seedSessions(query);
        const service = await import("../../src/lib/neon/blog-admin.server.ts");
        const pub = await import("../../src/lib/neon/blog-public.server.ts");
        const request = (role = "admin") =>
          new Request("http://127.0.0.1/owned", {
            headers: { authorization: "Bearer task8-" + role },
          });
        const preview = (id, role = "admin") => service.getArticlePreview(id, request(role));
        const command = (a, patch = {}, action = "save") => ({
          id: a.id,
          expectedVersion: a.version,
          editState: a.editState,
          input: { ...articleInput(a), ...patch },
          action,
          requestId: randomUUID(),
        });
        const save = (cmd, role = "admin") => service.saveBlogArticle(cmd, request(role));
        const state = () => service.getBlogAdminState(request());
        const ids = new Map(receipt.inserted.map((a) => [a.slug, a.id]));
        const initial = await state();
        const contentKeys = [
          "slug",
          "title",
          "excerpt",
          "published",
          "publishedAt",
          "coverImage",
          "coverAlt",
          "readingMinutes",
          "seoTitle",
          "seoDescription",
          "body",
          "links",
          "editorial",
        ];
        const content = (a) => Object.fromEntries(contentKeys.map((k) => [k, a[k]]));
        const coverage = [];
        await check("all112-actual-CMS-preview-draft-save-reload-public-unchanged", async () => {
          const listing = { search: "", state: "all", page: 1, pageSize: 100 };
          const pages = await Promise.all([
            service.listBlogArticles(listing, request()),
            service.listBlogArticles({ ...listing, page: 2 }, request()),
          ]);
          assert.deepEqual(
            pages.map((p) => p.total),
            [112, 112],
          );
          assert.deepEqual(
            pages.map((p) => p.items.length),
            [100, 12],
          );
          assert.equal(new Set(pages.flatMap((p) => p.items.map((a) => a.id))).size, 112);
          for (const source of plan.insert) {
            const id = ids.get(source.slug),
              before = await preview(id, "agent");
            const live = await pub.getPublicBlogArticle(source.slug);
            assert.deepEqual(content(before), content(source));
            assert.deepEqual(content(live), content(source));
            const sourceCategory = plan.inventory.categories.find(
              (c) => c.id === source.categoryId,
            );
            assert.equal(live.category, sourceCategory.key);
            assert.equal(
              live.categoryId,
              initial.categories.find((c) => c.key === sourceCategory.key).id,
            );
            const changed = await save(
              command(before, { title: before.title + " [isolated draft]" }),
              "agent",
            );
            assert.ok(changed.editState.draftRevisionId);
            assert.deepEqual(await preview(id, "agent"), changed);
            assert.deepEqual(await pub.getPublicBlogArticle(source.slug), live);
            const reconciled = await save(command(changed, { title: before.title }), "agent");
            assert.deepEqual(content(reconciled), content(source));
            assert.deepEqual(await preview(id, "agent"), reconciled);
            assert.deepEqual(await pub.getPublicBlogArticle(source.slug), live);
            coverage.push({
              slug: source.slug,
              sourceFingerprint: fingerprint(content(source)),
              publicFingerprint: fingerprint(content(live)),
              draftEditable: true,
              draftReconciledToSource: true,
              publishedAt: live.publishedAt,
            });
          }
          retain("all112-coverage.json", coverage);
          report.coverage = {
            imported: 112,
            cmsReadSaveReload: 112,
            publicResolvedExact: 112,
            sourceNullDates: 2,
            draftsReconciledToSource: 112,
            privateHistoryRetained: true,
          };
        });
        await check("public-pagination-main-feature-once-seven-category-scopes", async () => {
          const main = await pub.getPublicBlogPage({ page: 1 });
          assert.deepEqual(
            main.featured.map((a) => a.slug),
            ["sham-tseng-buying-guide-2026"],
          );
          assert.equal(main.articles.total, 111);
          const seen = [...main.featured.map((a) => a.slug)];
          for (let page = 1; page <= Math.ceil(main.articles.total / 12); page++) {
            const p = await pub.getPublicBlogPage({ page });
            assert.equal(p.articles.total, 111);
            assert.equal(p.articles.items.length, Math.min(12, 111 - (page - 1) * 12));
            if (page > 1) assert.deepEqual(p.featured, []);
            seen.push(...p.articles.items.map((a) => a.slug));
          }
          assert.deepEqual(seen.toSorted(), plan.insert.map((a) => a.slug).toSorted());
          assert.equal(new Set(seen).size, 112);
          assert.deepEqual((await pub.getPublicBlogPage({ page: 11 })).articles.items, []);
          for (const c of initial.categories) {
            const first = await pub.getPublicBlogPage({ categoryKey: c.key, page: 1 });
            assert.deepEqual(first.featured, []);
            const expected = bundle.registry
              .filter((a) => a.category === c.key)
              .map((a) => a.slug)
              .sort();
            assert.equal(first.articles.total, expected.length);
            const actual = [];
            for (let page = 1; page <= Math.ceil(expected.length / 12); page++) {
              const p = await pub.getPublicBlogPage({ categoryKey: c.key, page });
              assert.ok(p.articles.items.every((a) => a.categoryId === c.id));
              actual.push(...p.articles.items.map((a) => a.slug));
            }
            assert.deepEqual(actual.sort(), expected);
          }
        });
        await check("independent-feature-edits-and-newer-work-preserved-on-reimport", async () => {
          const main = initial.settings.find((s) => s.scope.kind === "main");
          const category = initial.categories.find(
            (c) => bundle.registry.filter((a) => a.category === c.key).length > 2,
          );
          const scope = initial.settings.find(
            (s) => s.scope.kind === "category" && s.scope.categoryId === category.id,
          );
          const selected = bundle.registry
            .filter((a) => a.category === category.key)
            .slice(0, 2)
            .map((a) => ids.get(a.slug));
          const updated = await service.saveBlogSettings(
            { ...scope, featuredIds: selected },
            request(),
          );
          assert.deepEqual(
            (await state()).settings.find((s) => s.scope.kind === "main"),
            main,
          );
          const categoryPage = await pub.getPublicBlogPage({ categoryKey: category.key, page: 1 });
          assert.deepEqual(
            categoryPage.featured.map((a) => a.id),
            selected,
          );
          assert.ok(categoryPage.articles.items.every((a) => !selected.includes(a.id)));
          const outside = bundle.registry.find((a) => a.category !== category.key);
          await assert.rejects(
            service.saveBlogSettings(
              { ...updated, featuredIds: [ids.get(outside.slug)] },
              request(),
            ),
          );
          const first = receipt.inserted[0],
            second = receipt.inserted[1];
          const newer = await save(
            command(await preview(first.id), {
              title: "Isolated newer publication",
              seoTitle: "Isolated newer SEO",
            }),
          );
          const privateDraft = await preview(first.id, "agent");
          assert.notEqual(privateDraft.title, newer.title);
          await save(command(await preview(second.id), {}, "unpublish"));
          assert.equal(await pub.getPublicBlogArticle(second.slug), null);
          const before = await snapshotDatabase(reader, 7);
          const retry = await applyImport(plan, writer);
          assert.equal(retry.writes, 0);
          assert.equal(retry.verification, "changed");
          assert.deepEqual(await snapshotDatabase(reader, 7), before);
          assert.deepEqual(await preview(first.id, "agent"), privateDraft);
          assert.equal((await pub.getPublicBlogArticle(first.slug)).title, newer.title);
          assert.equal(await pub.getPublicBlogArticle(second.slug), null);
          assert.equal((await verifyImport(plan, reader)).verification, "changed");
          retain("newer-work-preservation.json", {
            before,
            receipt: retry,
            privateDraft,
            newerPublication: newer,
            unpublishedId: second.id,
          });
          // One-field forward repair uses current service CAS tokens and retains intervening title/body.
          const damaged = await save(
            command(await preview(first.id), { seoTitle: "isolated repair probe" }),
          );
          const stale = command(damaged, { seoTitle: newer.seoTitle });
          const intervening = await save(
            command(damaged, { title: "Isolated intervening publication" }),
          );
          const prior = await snapshotDatabase(reader, 7);
          await assert.rejects(save(stale), (e) => e.status === 409);
          assert.deepEqual(await snapshotDatabase(reader, 7), prior);
          const repaired = await save(
            command(await preview(first.id), { seoTitle: newer.seoTitle }),
          );
          assert.equal(repaired.title, intervening.title);
          assert.deepEqual(repaired.body, intervening.body);
          assert.equal(repaired.seoTitle, newer.seoTitle);
          assert.equal((await preview(first.id, "agent")).title, privateDraft.title);
          assert.equal(await pub.getPublicBlogArticle(second.slug), null);
          const after = await snapshotDatabase(reader, 7);
          for (const [table, rows] of Object.entries(prior.tables)) {
            const unaffected = (rs) =>
              rs.filter((r) =>
                table === "articles"
                  ? r.id !== first.id
                  : table === "cms_content_revisions"
                    ? r.resource_id !== first.id
                    : true,
              );
            assert.deepEqual(unaffected(after.tables[table]), unaffected(rows));
          }
          retain("targeted-cas-recovery.json", {
            prior,
            after,
            staleRejected: 409,
            field: "seoTitle",
            targetId: first.id,
          });
          await sentinelCheck();
        });
        retain("final-snapshot.json", await snapshotDatabase(reader, 7));
      } finally {
        for (const target of targets) await target.close();
      }
    },
    { migrationVersions: captured95, image: PINNED_POSTGRES_18 },
  );
  report.status = "PASS";
  report.cleanup = "withOwnedPostgres completed exact harness-owned container cleanup";
} catch (error) {
  report.status = "FAIL";
  report.failedStage = stage;
  // Detailed diagnostics stay private; console never prints assertion operands/private bodies.
  retain("failure-private.json", {
    name: error.name,
    message: error.message,
    stack: error.stack,
    actual: error.actual,
    expected: error.expected,
  });
  report.failureCode = error.code ?? error.name;
  process.exitCode = 1;
} finally {
  report.completedAtUtc = new Date().toISOString();
  retain("report.json", report);
  retain("sealed-file-manifest.json", {
    semantics: "exclusive-create + SHA256 + read-only attributes; owner can override; not WORM",
    files: [...files],
  });
  const reportPath = join(
    root,
    ".superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/rehearsal-report.md",
  );
  mkdirSync(resolve(reportPath, ".."), { recursive: true });
  const text =
    "# Isolated captured-inventory rehearsal\n\n```json\n" +
    JSON.stringify(report, null, 2) +
    "\n```\n\nRun: `node --experimental-test-module-mocks scripts/blog-cms/rehearse-live-inventory.mjs`. Detailed immutable run evidence is retained at the path above.\n";
  // Preserve prior reports rather than replace them on a later rehearsal.
  if (existsSync(reportPath)) writeFileSync(reportPath, "\n\n---\n\n" + text, { flag: "a" });
  else writeFileSync(reportPath, text, { flag: "wx" });
  console.log(JSON.stringify(report));
}
