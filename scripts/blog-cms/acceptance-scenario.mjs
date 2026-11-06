import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import {
  verifyImportTarget,
  snapshotDatabase,
  applyImport,
} from "../../src/lib/neon/blog-import.ts";
import {
  buildImportPlan,
  candidate,
  fingerprint,
  inventoryArticle,
} from "../../src/lib/blog/reconcile.ts";
import { databaseInventory } from "../../src/lib/blog/import-snapshots.ts";
import {
  articleInput,
  createSaveSession,
} from "../../src/components/admin/blog/blog-editor-state.ts";

export function refuseExternalTargets() {
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "TEST_DATABASE_URL",
    "CMS_TEST_DATABASE_URL",
    "ASTRA_TEST_DATABASE_URL",
  ])
    assert.ok(!process.env[key], "Owned-only acceptance refuses " + key);
}

export async function seedSessions(query) {
  await query("CREATE SCHEMA neon_auth");
  await query(
    'CREATE TABLE neon_auth."user" (id text PRIMARY KEY,email text,name text,"emailVerified" boolean)',
  );
  await query('CREATE TABLE neon_auth.session (token text,"userId" text,"expiresAt" timestamptz)');
  for (const role of ["admin", "manager", "agent", "viewer"]) {
    const id = randomUUID();
    await query('INSERT INTO neon_auth."user" VALUES($1,$2,$3,true)', [
      id,
      role + "@example.invalid",
      role,
    ]);
    await query("INSERT INTO neon_auth.session VALUES($1,$2,now()+interval '1 hour')", [
      "task8-" + role,
      id,
    ]);
    await query("INSERT INTO staff_users(id,auth_user_id,active) VALUES($1,$2,true)", [id, id]);
    await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [id, role]);
  }
}

/** Same workflow through real authenticated services or built HTTP; never a synthetic repository. */
export async function runAcceptance({
  owned,
  api,
  publicApi,
  checkPublic = async () => {},
  cutover,
}) {
  const { query, containerId } = owned;
  const identity = "owned:" + containerId + ":postgres";
  const reader = await verifyImportTarget({ containerId, targetIdentity: identity });
  let writer;
  const dir = mkdtempSync(join(tmpdir(), "task8-blog-"));
  const check = async (name, fn) => {
    await fn();
    console.log("PASS " + name);
  };
  const preview = (id, role = "admin") => api.preview({ id }, role);
  const command = (record, patch = {}, action = "save") => ({
    id: record.id,
    expectedVersion: record.version,
    editState: record.editState,
    input: { ...articleInput(record), ...patch },
    action,
    requestId: randomUUID(),
  });
  const listing = { search: "", state: "all", page: 1, pageSize: 100 };
  const status = (code) => (e) => e.status === code;
  try {
    const category = await api.category({
      key: "成交分析",
      name: "成交分析",
      navigationOrder: 1,
      hidden: false,
      version: 0,
      settingsVersion: 0,
      heading: "分類標題",
      introduction: "分類簡介",
      seoTitle: null,
      seoDescription: null,
    });
    const inputs = Array.from({ length: 101 }, (_, i) => ({
      slug: "acceptance-" + String(i + 1).padStart(3, "0"),
      title: "驗收文章 " + (i + 1),
      excerpt: "原始摘要",
      categoryId: category.id,
      published: i !== 99,
      publishedAt: i === 100 ? "2099-01-01T00:00:00.000Z" : null,
      coverImage: null,
      coverAlt: "原始封面",
      readingMinutes: 5,
      seoTitle: null,
      seoDescription: null,
      body:
        i % 2
          ? {
              format: "editor-json-v1",
              document: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "原文 <不是HTML> " + i, marks: [{ type: "bold" }] },
                    ],
                  },
                ],
              },
            }
          : { format: "legacy-text", text: " 原文\n<不是 HTML> " + i },
      links: [{ href: "https://example.invalid/source?x=%2f&b=2#中文", label: "原始來源" }],
      editorial: {
        author: "編輯",
        reviewer: null,
        sourcesNote: "來源註記",
        answerSummary: "文章重點",
        compareEstateSlugs: [],
      },
    }));
    const initialState = await api.state();
    await cutover?.pause({ initialState, inputs });
    const snapshot = await snapshotDatabase(reader, 7);
    const db = databaseInventory(snapshot, "https://example.invalid");
    const plan = buildImportPlan({
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
      categories: initialState.categories,
      settings: initialState.settings,
      sourceRevision: "task8-owned-101-v1",
      sourceDigest: fingerprint(inputs),
      publicUrls: inputs.map((a) => "https://example.invalid/blog/" + a.slug),
      targetIdentity: identity,
      database: snapshot,
    });
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.unresolved, []);
    await cutover?.fresh({ plan, reader });
    const backup = JSON.stringify(snapshot);
    const backupPath = join(dir, "backup.json");
    writeFileSync(backupPath, backup);
    writer = await verifyImportTarget({
      containerId,
      targetIdentity: identity,
      authorization: {
        planFingerprint: plan.fingerprint,
        backupPath,
        backupSha256: createHash("sha256").update(backup).digest("hex"),
      },
    });
    const receipt = await applyImport(plan, writer);
    assert.equal(receipt.writes, 101);
    await cutover?.imported({
      plan,
      reader,
      receipt,
      inputs,
      backupSha256: createHash("sha256").update(backup).digest("hex"),
    });
    console.log(
      JSON.stringify({
        layer: "owned-db",
        targetIdentity: identity,
        systemIdentifier: reader.systemIdentifier,
        manifestFingerprint: plan.fingerprint,
        sourceDigest: plan.inventory.sourceDigest,
        articles: 101,
      }),
    );
    const records = [];
    await check(
      "import -> CMS edit/save/reload of all 101 legacy/rich articles, draft and future outcomes, exact URLs/links",
      async () => {
        const page1 = await api.list(listing),
          page2 = await api.list({ ...listing, page: 2 });
        assert.equal(page1.total, 101);
        assert.equal(page1.items.length, 100);
        assert.equal(page2.items.length, 1);
        assert.equal(new Set([...page1.items, ...page2.items].map((a) => a.id)).size, 101);
        for (const input of inputs) {
          const id = receipt.inserted.find((a) => a.slug === input.slug).id;
          const before = await preview(id);
          assert.deepEqual(before.body, input.body);
          assert.deepEqual(before.links, input.links);
          const body = structuredClone(input.body);
          if (body.format === "legacy-text") body.text += "\nCMS 修改";
          else body.document.content[0].content[0].text += " CMS 修改";
          const edited = await api.save(
            command(before, {
              title: input.title + " 已編輯",
              coverAlt: "已編輯替代文字",
              seoTitle: "已編輯SEO",
              body,
            }),
          );
          const reload = await preview(id);
          assert.deepEqual(reload, edited);
          assert.deepEqual(reload.body, body);
          assert.equal(reload.slug, input.slug);
          assert.equal(reload.slugLocked, true);
          assert.deepEqual(reload.links, input.links);
          assert.equal(reload.publishedAt, input.publishedAt);
          const live = await publicApi.article(input.slug);
          if (!input.published || input.publishedAt) assert.equal(live, null);
          else {
            assert.equal(live.slug, input.slug);
            assert.equal(live.title, edited.title);
            assert.deepEqual(live.body, body);
          }
          records.push(reload);
        }
      },
    );
    await checkPublic({ stage: "imported", records, category });
    await check(
      "independent main/category copy/features, ordered selections, rename/hide and dual version conflict",
      async () => {
        let state = await api.state();
        const main = state.settings.find((s) => s.scope.kind === "main");
        const cat = state.settings.find((s) => s.scope.kind === "category");
        const savedMain = await api.settings({
          ...main,
          heading: "主頁已編輯",
          featuredIds: [records[1].id, records[0].id],
        });
        const savedCat = await api.settings({
          ...cat,
          heading: "分類獨立編輯",
          featuredIds: [records[2].id, records[0].id],
        });
        state = await api.state();
        const current = state.categories.find((c) => c.id === category.id);
        await assert.rejects(api.category({ ...category, name: "不應覆寫" }), status(409));
        const renamed = await api.category({ ...current, name: "成交新名稱", hidden: true });
        assert.equal(renamed.key, "成交分析");
        assert.equal(renamed.heading, savedCat.heading);
        const renamedDetail = await publicApi.article(records[1].slug);
        assert.equal(renamedDetail.category, "成交分析");
        assert.equal(renamedDetail.categoryName, "成交新名稱");
        state = await api.state();
        assert.deepEqual(
          state.settings.find((s) => s.scope.kind === "main"),
          savedMain,
        );
        const page = await publicApi.page({ page: 1 });
        assert.equal(
          page.categories.some((c) => c.id === category.id),
          false,
        );
        assert.deepEqual(
          page.featured.map((a) => a.id),
          savedMain.featuredIds,
        );
        const categoryPage = await publicApi.page({ page: 1, categoryKey: "成交分析" });
        assert.equal(categoryPage.settings.heading, "分類獨立編輯");
        assert.deepEqual(
          categoryPage.featured.map((a) => a.id),
          savedCat.featuredIds,
        );
      },
    );
    await check(
      "two concurrent editors, stale-save conflict and private agent draft survive newer publication",
      async () => {
        const first = await preview(records[0].id),
          second = await preview(records[0].id, "manager");
        const race = await Promise.allSettled([
          api.save(command(first, { title: "並行甲" })),
          api.save(command(second, { title: "並行乙" }), "manager"),
        ]);
        assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(race.find((r) => r.status === "rejected").reason.status, 409);
        const latest = await preview(first.id);
        await assert.rejects(api.save(command(first, { title: "過期覆寫" })), status(409));
        const agent = await preview(first.id, "agent");
        const draft = await api.save(command(agent, { title: "私人草稿不可外洩" }), "agent");
        assert.equal(draft.title, "私人草稿不可外洩");
        assert.equal((await publicApi.article(first.slug)).title, latest.title);
        const newer = await api.save(command(await preview(first.id), { title: "較新公開編輯" }));
        assert.equal((await preview(first.id, "agent")).title, draft.title);
        assert.equal((await publicApi.article(first.slug)).title, newer.title);
        await assert.rejects(api.save(command(draft, {}, "publish"), "agent"), status(403));
        // This separate author's draft remains active even when the first article is withdrawn.
        await api.save(
          command(await preview(records[1].id, "agent"), { title: "私人草稿不可外洩" }),
          "agent",
        );
      },
    );
    await check(
      "failed read != empty; failed save rolls back and exact retry succeeds; saved tokens precede failed refresh",
      async () => {
        await query("ALTER TABLE blog_categories RENAME TO task8_categories_offline");
        try {
          await assert.rejects(api.list(listing), status(503));
        } finally {
          await query("ALTER TABLE task8_categories_offline RENAME TO blog_categories");
        }
        const before = await preview(records[3].id),
          session = createSaveSession();
        const cmd = command(before, { title: "失敗後保留的修改" });
        delete cmd.requestId;
        const attempts = [];
        let installed;
        const write = (c) => {
          attempts.push(c.requestId);
          return api.save(c);
        };
        await query(
          "CREATE FUNCTION task8_fail_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'task8 injected write failure'; END $$",
        );
        await query(
          "CREATE TRIGGER task8_fail_save BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION task8_fail_save()",
        );
        try {
          await assert.rejects(
            session.save(
              cmd,
              write,
              (a) => {
                installed = a;
              },
              async () => {},
            ),
            status(503),
          );
        } finally {
          await query("DROP TRIGGER task8_fail_save ON articles");
          await query("DROP FUNCTION task8_fail_save()");
        }
        assert.equal(installed, undefined);
        assert.deepEqual(await preview(before.id), before);
        const result = await session.save(
          cmd,
          write,
          (a) => {
            installed = a;
          },
          async () => {
            assert.equal(installed.title, "失敗後保留的修改");
            await query("ALTER TABLE blog_categories RENAME TO task8_categories_offline");
            try {
              await api.list(listing);
            } finally {
              await query("ALTER TABLE task8_categories_offline RENAME TO blog_categories");
            }
          },
        );
        assert.equal(result.refreshFailed, true);
        assert.equal(attempts[0], attempts[1]);
        assert.deepEqual(await preview(before.id), installed);
        assert.equal((await api.list(listing)).total, 101);
      },
    );
    await check(
      "unpublish prunes both scopes, repeat import is read-only and preserves all newer edits/private state",
      async () => {
        const withdrawn = records[0];
        await api.save(command(await preview(withdrawn.id), {}, "unpublish"));
        assert.equal(await publicApi.article(withdrawn.slug), null);
        const state = await api.state();
        for (const scope of state.settings)
          assert.equal(scope.featuredIds.includes(withdrawn.id), false);
        const before = await snapshotDatabase(reader, 7);
        const repeat = await applyImport(plan, writer);
        assert.equal(repeat.writes, 0);
        assert.equal(repeat.verification, "changed");
        assert.deepEqual(await snapshotDatabase(reader, 7), before);
        const rows = await query("SELECT slug FROM articles ORDER BY slug");
        assert.deepEqual(
          rows.map((a) => a.slug),
          inputs.map((a) => a.slug),
        );
        assert.equal((await api.list(listing)).total, 101);
        assert.equal((await preview(records[99].id)).published, false);
        assert.equal(await publicApi.article(records[99].slug), null);
        assert.equal(await publicApi.article(records[100].slug), null);
        assert.equal((await preview(records[3].id)).title, "失敗後保留的修改");
        assert.equal((await preview(records[1].id, "agent")).title, "私人草稿不可外洩");
        assert.equal((await publicApi.article(records[1].slug)).title, records[1].title);
      },
    );
    await checkPublic({ stage: "withdrawn", records, category });
    await cutover?.recover({ reader, records });
  } finally {
    await writer?.close();
    await reader.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(resolve(dir).startsWith(join(resolve(tmpdir()), "task8-blog-")));
    rmSync(dir, { recursive: true, force: true });
  }
}
