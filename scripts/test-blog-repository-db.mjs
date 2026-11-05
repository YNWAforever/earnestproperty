import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { withOwnedPostgres, mockOwnedServerDb } from "./acceptance/owned-postgres-test.mjs";

for (const key of [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "TEST_DATABASE_URL",
  "CMS_TEST_DATABASE_URL",
  "ASTRA_TEST_DATABASE_URL",
])
  assert.ok(!process.env[key], "Owned-only suite refuses " + key);
process.env.NEON_AUTH_BASE_URL = "http://127.0.0.1/owned-auth-fixture";
process.env.ADMIN_BOOTSTRAP_EMAILS = "";
await withOwnedPostgres(async ({ query, transaction, pool }) => {
  let unavailableProbe = false;
  let unavailableErrors = 0;
  await mockOwnedServerDb(
    mock,
    async (...args) => {
      try {
        return await query(...args);
      } catch (error) {
        if (
          unavailableProbe &&
          error.code === "42P01" &&
          error.message === 'relation "blog_categories" does not exist'
        )
          unavailableErrors++;
        else if (!/BLOG_|CMS_|FORBIDDEN/.test(error.message))
          console.error("DB diagnostic:", error.message);
        throw error;
      }
    },
    transaction,
  );
  // Sessions are local fixtures, resolved by the real auth module and real SQL.
  await query("CREATE SCHEMA IF NOT EXISTS neon_auth");
  await query(
    'CREATE TABLE neon_auth."user" (id text PRIMARY KEY,email text,name text,"emailVerified" boolean)',
  );
  await query('CREATE TABLE neon_auth.session (token text,"userId" text,"expiresAt" timestamptz)');
  const actors = {};
  for (const role of ["admin", "manager", "agent", "viewer", "revoked"]) {
    const id = randomUUID();
    actors[role] = id;
    await query('INSERT INTO neon_auth."user" VALUES($1,$2,$3,true)', [
      id,
      role + "@example.invalid",
      role,
    ]);
    await query("INSERT INTO neon_auth.session VALUES($1,$2,now()+interval '1 hour')", [
      "fixture-" + role,
      id,
    ]);
    await query("INSERT INTO staff_users(id,auth_user_id,active) VALUES($1,$2,$3)", [
      id,
      id,
      role !== "revoked",
    ]);
    await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,$2)", [
      id,
      role === "revoked" ? "admin" : role,
    ]);
  }
  const request = (role = "admin") =>
    new Request("http://localhost/blog-admin", {
      headers: { authorization: "Bearer fixture-" + role, "x-role": "admin" },
    });
  const path = new URL("../src/lib/neon/blog-admin.server.ts", import.meta.url);
  const exists = await import("node:fs").then((fs) => fs.existsSync(path));
  assert.equal(exists, true, "Task4 authenticated blog server wrapper must exist");
  const api = await import(path.href);
  const legacy = await import("../src/lib/neon/admin-cms.server.ts");
  async function race(first, second) {
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT blog_lock()");
    let pending;
    try {
      pending = Promise.allSettled([first(), second()]);
      let waiters = 0;
      for (let i = 0; i < 300; i++) {
        waiters = Number(
          (await query("SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event='advisory'"))[0]
            .n,
        );
        if (waiters >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(waiters >= 2, "both real transactions must contend before releasing the lock");
    } finally {
      await blocker.query("COMMIT");
      blocker.release();
    }
    return pending;
  }
  let passed = 0;
  async function check(name, fn) {
    await fn();
    console.log("PASS " + name);
    passed++;
  }
  const input = (slug = randomUUID()) => ({
    slug,
    title: "文章 " + slug,
    excerpt: null,
    categoryId: null,
    published: false,
    publishedAt: null,
    coverImage: null,
    coverAlt: null,
    body: { format: "legacy-text", text: "原文" },
    links: [],
    editorial: {
      author: null,
      reviewer: null,
      sourcesNote: null,
      answerSummary: null,
      compareEstateSlugs: [],
    },
    readingMinutes: 5,
    seoTitle: null,
    seoDescription: null,
  });
  const command = (record, patch = {}, action = "save") => ({
    id: record.id,
    expectedVersion: record.version,
    editState: record.editState,
    input: { ...recordInput(record), ...patch },
    action,
    requestId: randomUUID(),
  });
  const recordInput = ({ id, version, slugLocked, createdAt, editState, ...rest }) => rest;
  const save = (cmd, role = "admin") => api.saveBlogArticle(cmd, request(role));
  const create = (patch = {}, action = "save", role = "admin") =>
    save({ input: { ...input(), ...patch }, action, requestId: randomUUID() }, role);
  const state = () => api.getBlogAdminState(request());
  const category = (key) =>
    api.saveBlogCategory(
      {
        key,
        name: key,
        navigationOrder: 0,
        hidden: false,
        version: 0,
        settingsVersion: 0,
        heading: key,
        introduction: "",
        seoTitle: null,
        seoDescription: null,
      },
      request(),
    );
  const settings = (value, role = "admin") => api.saveBlogSettings(value, request(role));
  await check("Task6 agent category options are narrow authenticated readonly data", async () => {
    const before = await api.getBlogAdminState(request("admin"));
    const options = await api.getBlogCategoryOptions(request("agent"));
    assert.deepEqual(
      options.map((x) => x.id),
      before.categories.map((x) => x.id),
    );
    for (const option of options)
      assert.deepEqual(Object.keys(option).sort(), ["hidden", "id", "key", "name"]);
    for (const role of ["viewer", "revoked", "unknown"])
      await assert.rejects(() => api.getBlogCategoryOptions(request(role)));
    await assert.rejects(() => api.getBlogAdminState(request("agent")));
    assert.deepEqual(await api.getBlogAdminState(request("admin")), before);
  });
  await check(
    "real sessions: admin/manager publication, agent private draft, anonymous/viewer/revoked denial and role spoof rejection",
    async () => {
      for (const role of ["admin", "manager"])
        assert.equal((await create({}, "publish", role)).published, true);
      assert.equal((await create({}, "save", "agent")).published, false);
      for (const role of ["agent", "viewer", "revoked", "unknown"])
        await assert.rejects(() => create({}, "publish", role));
      await assert.rejects(() =>
        api.saveBlogArticle(
          { input: input(), action: "save", requestId: randomUUID(), roles: ["admin"] },
          request("agent"),
        ),
      );
      await assert.rejects(() => api.getBlogAdminState(new Request("http://localhost")));
      for (const role of ["agent", "viewer", "revoked"])
        await assert.rejects(() => api.getBlogAdminState(request(role)));
    },
  );
  await check(
    "atomic published Save, dates, rich metadata, links and original replay result",
    async () => {
      const rich = {
        format: "editor-json-v1",
        document: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "富文字" }] }],
        },
      };
      const cmd = {
        input: {
          ...input(),
          body: rich,
          links: [{ href: "/blog/abc", label: "延伸" }],
          editorial: {
            author: "作者",
            reviewer: "審閱",
            sourcesNote: "來源",
            answerSummary: "摘要",
            compareEstateSlugs: ["castle-peak"],
          },
        },
        action: "publish",
        requestId: randomUUID(),
      };
      const first = await save(cmd);
      assert.equal(first.published, true);
      assert.ok(first.publishedAt);
      assert.deepEqual(first.body, rich);
      assert.deepEqual(first.editorial, cmd.input.editorial);
      const updated = await save(command(first, { title: "更新" }));
      assert.equal(updated.published, true);
      assert.equal(updated.publishedAt, first.publishedAt);
      assert.ok(updated.version > first.version);
      assert.deepEqual(await save(cmd), first);
      await assert.rejects(
        () => save({ ...cmd, input: { ...cmd.input, title: "不同" } }),
        /IDEMPOTENCY/,
      );
      await assert.rejects(() => save(cmd, "manager"), /IDEMPOTENCY/);
      const replay = await Promise.allSettled([
        save(command(updated, { title: "next" })),
        save(command(updated, { title: "race" })),
      ]);
      assert.equal(replay.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(replay.find((r) => r.status === "rejected").reason.message, /CONFLICT/);
    },
  );
  await check(
    "concurrent identical request creates exactly once; changed action rejected",
    async () => {
      const cmd = { input: input(), action: "save", requestId: randomUUID() };
      const [a, b] = await Promise.all([save(cmd), save(cmd)]);
      assert.deepEqual(a, b);
      assert.equal(
        Number(
          (
            await query("SELECT count(*) AS n FROM cms_content_revisions WHERE resource_id=$1", [
              a.id,
            ])
          )[0].n,
        ),
        1,
      );
      await assert.rejects(() => save({ ...cmd, action: "publish" }), /IDEMPOTENCY/);
    },
  );
  await check(
    "locked/reserved slugs, invalid rich data and legacy routes cannot bypass",
    async () => {
      await assert.rejects(() => create({ slug: "editorial-standards" }), /VALIDATION|RESERVED/);
      await assert.rejects(
        () =>
          legacy.saveAdminCmsDraft(
            { resourceType: "article", payload: { slug: "editorial-standards", title: "bad" } },
            request(),
          ),
        /VALIDATION|RESERVED/,
      );
      await assert.rejects(() =>
        legacy.saveAdminCmsDraft(
          {
            resourceType: "article",
            payload: {
              slug: "ok",
              title: "bad",
              content_format: "editor-json-v1",
              content: '{"type":"script"}',
            },
          },
          request(),
        ),
      );
      const a = await create({}, "publish");
      await assert.rejects(() => save(command(a, { slug: "changed" })), /SLUG_LOCKED/);
      await assert.rejects(
        () =>
          legacy.saveAdminCmsDraft(
            {
              resourceType: "article",
              resourceId: a.id,
              basePublishedVersion: a.version,
              payload: { slug: "changed", title: "bad" },
            },
            request(),
          ),
        /SLUG_LOCKED/,
      );
      await assert.rejects(() =>
        create({ links: [{ href: "javascript:alert(1)", label: "bad" }] }),
      );
    },
  );
  await check("agents can draft published articles without altering live publication", async () => {
    const a = await create({}, "publish");
    const agentView = await api.getArticlePreview(a.id, request("agent"));
    const draft = await save(command(agentView, { title: "agent private" }), "agent");
    assert.equal(draft.published, true);
    assert.ok(draft.editState.draftRevisionId);
    assert.equal((await query("SELECT title FROM articles WHERE id=$1", [a.id]))[0].title, a.title);
    await assert.rejects(() => save(command(draft, {}, "publish"), "agent"));
  });
  await check(
    "atomic rollback includes draft, publication, audit and request receipt",
    async () => {
      const cmd = {
        input: { ...input(), title: "force-rollback" },
        action: "publish",
        requestId: randomUUID(),
      };
      await query(
        "CREATE FUNCTION task4_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='cms_published' AND EXISTS(SELECT 1 FROM articles WHERE id=NEW.subject_id AND title='force-rollback') THEN RAISE EXCEPTION 'BLOG_VALIDATION_FORCED'; END IF; RETURN NEW; END $$",
      );
      await query(
        "CREATE TRIGGER task4_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION task4_fail_audit()",
      );
      try {
        await assert.rejects(() => save(cmd), /VALIDATION/);
        assert.equal(
          Number(
            (
              await query(
                "SELECT count(*) AS n FROM cms_content_revisions WHERE payload->>'slug'=$1",
                [cmd.input.slug],
              )
            )[0].n,
          ),
          0,
        );
        assert.equal(
          Number(
            (await query("SELECT count(*) AS n FROM articles WHERE slug=$1", [cmd.input.slug]))[0]
              .n,
          ),
          0,
        );
        assert.equal(
          Number(
            (
              await query("SELECT count(*) AS n FROM blog_mutation_requests WHERE request_id=$1", [
                cmd.requestId,
              ])
            )[0].n,
          ),
          0,
        );
      } finally {
        await query("DROP TRIGGER task4_fail_audit ON audit_logs");
        await query("DROP FUNCTION task4_fail_audit()");
      }
      assert.equal((await save(cmd)).published, true);
    },
  );
  await check(
    "historical unmarked restore remains legacy and retains supplemental data",
    async () => {
      const old = await legacy.saveAdminCmsDraft(
        {
          resourceType: "article",
          payload: { slug: randomUUID(), title: "historical", content: 'literal {"type":"doc"}' },
        },
        request(),
      );
      await legacy.publishAdminCmsRevision(
        {
          resourceType: "article",
          resourceId: old.resourceId,
          revisionId: old.revisionId,
          basePublishedVersion: null,
          draftEditVersion: old.editState.draftEditVersion,
        },
        request(),
      );
      const view = await api.getArticlePreview(old.resourceId, request());
      const rich = await save(
        command(view, {
          body: {
            format: "editor-json-v1",
            document: { type: "doc", content: [{ type: "paragraph" }] },
          },
          links: [{ href: "/contact", label: "contact" }],
          editorial: {
            author: "作者",
            reviewer: null,
            sourcesNote: null,
            answerSummary: null,
            compareEstateSlugs: [],
          },
        }),
      );
      const restored = await legacy.restoreAdminCmsRevision(
        {
          revisionId: old.revisionId,
          articleTokens: {
            requestId: randomUUID(),
            expectedVersion: rich.version,
            editState: rich.editState,
          },
        },
        request(),
      );
      const preview = await api.getArticlePreview(view.id, request());
      assert.equal(preview.body.format, "legacy-text");
      assert.equal(preview.body.text, 'literal {"type":"doc"}');
      await legacy.publishAdminCmsRevision(
        {
          resourceType: "article",
          resourceId: view.id,
          revisionId: restored.revisionId,
          basePublishedVersion: rich.version,
          draftEditVersion: restored.editState.draftEditVersion,
        },
        request(),
      );
      const final = await api.getArticlePreview(view.id, request());
      assert.equal(final.body.format, "legacy-text");
      assert.deepEqual(final.links, rich.links);
      assert.deepEqual(final.editorial, rich.editorial);
      assert.equal(final.publishedAt, view.publishedAt);
    },
  );
  const c1 = await category("成交分析"),
    c2 = await category("測試分類");
  await check("settings/category dual CAS and publication authority", async () => {
    const main = (await state()).settings.find((x) => x.scope.kind === "main");
    await assert.rejects(() => settings(main, "agent"));
    const same = await race(
      () => settings({ ...main, heading: "one" }),
      () => settings({ ...main, heading: "two" }),
    );
    assert.equal(same.filter((x) => x.status === "fulfilled").length, 1);
    const cs = (await state()).settings.find((x) => x.scope.categoryId === c1.id);
    await settings({ ...cs, heading: "changed" });
    await assert.rejects(
      () => api.saveBlogCategory({ ...c1, name: "stale" }, request()),
      /CONFLICT/,
    );
    assert.equal((await state()).categories.find((x) => x.id === c1.id).name, c1.name);
  });
  await check("future dates stay exact and are ineligible for features", async () => {
    const a = await create({ publishedAt: "2099-01-01T00:00:00.000Z" }, "publish");
    assert.equal(a.publishedAt, "2099-01-01T00:00:00.000Z");
    const main = (await state()).settings.find((x) => x.scope.kind === "main");
    await assert.rejects(() => settings({ ...main, featuredIds: [a.id] }), /INELIGIBLE/);
  });
  await check(
    "feature/unpublish and feature/reassignment races leave no invalid memberships",
    async () => {
      for (const action of ["unpublish", "reassign"]) {
        const a = await create({ categoryId: c1.id }, "publish");
        const s = (await state()).settings.find((x) => x.scope.categoryId === c1.id);
        const results = await race(
          () => settings({ ...s, featuredIds: [a.id] }),
          () =>
            save(
              command(
                a,
                action === "reassign" ? { categoryId: c2.id } : {},
                action === "unpublish" ? "unpublish" : "save",
              ),
            ),
        );
        assert.equal(results[1].status, "fulfilled");
        const final = (await state()).settings.find((x) => x.scope.categoryId === c1.id);
        assert.ok(!final.featuredIds.includes(a.id));
        if (results[0].status === "fulfilled") assert.ok(final.version > results[0].value.version);
        else assert.match(results[0].reason.message, /INELIGIBLE|CONFLICT/);
      }
    },
  );
  await check("first publish competing with slug update has exactly one winner", async () => {
    const a = await create();
    const results = await race(
      () => save(command(a, {}, "publish")),
      () => save(command(a, { slug: "new-" + randomUUID() })),
    );
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(
      results.find((x) => x.status === "rejected").reason.message,
      /CONFLICT|SLUG_LOCKED/,
    );
  });
  await check(
    "stable page 3 of 101, counts/search/category/state and own draft privacy",
    async () => {
      const cat = await category("pagination");
      for (let i = 0; i < 101; i++)
        await create(
          { categoryId: cat.id, title: "paging " + String(i).padStart(3, "0") },
          i % 2 ? "publish" : "save",
        );
      const q = { search: "paging", categoryId: cat.id, state: "all", page: 3, pageSize: 25 };
      const a = await api.listBlogArticles(q, request());
      const b = await api.listBlogArticles(q, request());
      // No article title or slug contains these category-only search terms.
      const renamed = await api.saveBlogCategory({ ...cat, name: "分類名稱獨有" }, request());
      for (const search of ["pagination", "分類名稱獨有"]) {
        const byCategory = await api.listBlogArticles(
          { ...q, categoryId: undefined, search },
          request(),
        );
        assert.equal(byCategory.total, 101);
        assert.deepEqual(
          byCategory.items.map((item) => item.id),
          a.items.map((item) => item.id),
        );
        assert.equal(
          (
            await api.listBlogArticles(
              { ...q, categoryId: undefined, search, state: "published" },
              request(),
            )
          ).total,
          50,
        );
        assert.equal(
          (await api.listBlogArticles({ ...q, categoryId: undefined, search, page: 99 }, request()))
            .total,
          101,
        );
        assert.equal(
          (await api.listBlogArticles({ ...q, categoryId: c1.id, search }, request())).total,
          0,
        );
      }
      assert.equal(renamed.key, "pagination");
      assert.equal(a.total, 101);
      assert.equal(a.items.length, 25);
      assert.deepEqual(a, b);
      assert.equal((await api.listBlogArticles({ ...q, state: "published" }, request())).total, 50);
      assert.equal((await api.listBlogArticles({ ...q, state: "draft" }, request())).total, 51);
      assert.equal(
        (await api.listBlogArticles({ ...q, search: "paging 100", page: 1 }, request())).total,
        1,
      );
      assert.equal((await api.listBlogArticles({ ...q, page: 99 }, request())).total, 101);
      await assert.rejects(() => api.listBlogArticles({ ...q, pageSize: 101 }, request()));
      const own = await create({}, "save", "agent");
      await assert.rejects(() => api.getArticlePreview(own.id, request("manager")), /NOT_FOUND/);
      assert.equal((await api.getArticlePreview(own.id, request("agent"))).id, own.id);
    },
  );
  await check(
    "public readers and registry suppression exclude future and withdrawn entries",
    async () => {
      const reader = await import("../src/lib/neon/public-data.server.ts");
      const guard = await import("../src/lib/neon/blog-visibility.server.ts");
      const future = await create({ publishedAt: "2099-01-01T00:00:00.000Z" }, "publish");
      const withdrawn = await create({}, "publish");
      await save(command(withdrawn, {}, "unpublish"));
      assert.equal(await reader.fetchArticleBySlug({ slug: future.slug }), null);
      assert.ok(!(await reader.fetchPublishedArticles()).some((a) => a.slug === future.slug));
      assert.ok(!(future.slug in (await reader.fetchSitemapTimestamps()).articles));
      assert.deepEqual(
        await guard.filterPublicBlogSlugs([future.slug, withdrawn.slug, "unowned-registry-slug"]),
        [],
      );
    },
  );
  await check(
    "anonymous eligibility treats unknown, draft, withdrawn and future slugs alike",
    async () => {
      const guard = await import("../src/lib/neon/blog-visibility.server.ts");
      const registry = await import("../src/content/blog-articles.ts");
      const clock = new Date("2026-06-22T12:00:00.000Z");
      const due = registry.publishedBlogArticles(clock);
      const knownDue = new Set(due.map((a) => a.slug));
      const futureRegistry = registry.blogArticles.find((a) => !knownDue.has(a.slug));
      assert.ok(
        due.length > 0 && futureRegistry,
        "actual registry must contain due and future fixtures",
      );
      const draft = await create();
      const future = await create({ publishedAt: "2099-01-01T00:00:00.000Z" }, "publish");
      const withdrawn = await create({}, "publish");
      await save(command(withdrawn, {}, "unpublish"));
      const publicArticle = await create({ publishedAt: "2000-01-01T00:00:00.000Z" }, "publish");
      const rejected = [
        "unknown-" + randomUUID(),
        draft.slug,
        future.slug,
        withdrawn.slug,
        futureRegistry.slug,
      ];
      for (const slug of rejected)
        assert.deepEqual(await guard.filterPublicBlogSlugs([slug], clock), []);
      assert.deepEqual(
        await guard.filterPublicBlogSlugs([...rejected, due[0].slug, publicArticle.slug], clock),
        [publicArticle.slug],
      );
      // A registry-only article is absent until imported; a future DB projection is also private.
      const registryOverride = await create(
        { slug: due[0].slug, publishedAt: "2099-01-01T00:00:00.000Z" },
        "publish",
      );
      assert.deepEqual(await guard.filterPublicBlogSlugs([registryOverride.slug], clock), []);
    },
  );
  await check(
    "import seed contract: matching live/revision identity preserves null dates and edits through CMS",
    async () => {
      const id = randomUUID(),
        slug = "seed-" + randomUUID();
      await transaction([
        {
          statement:
            "INSERT INTO articles(id,slug,title,content,published,published_at,version,slug_locked) VALUES($1,$2,'seed','original',true,NULL,1,true)",
          params: [id, slug],
        },
        {
          statement:
            "INSERT INTO cms_content_revisions(resource_type,resource_id,version_number,state,payload,created_by,published_at) SELECT 'article',id,version,'published',to_jsonb(a)-'created_at'-'updated_at',$2::uuid,published_at FROM articles a WHERE id=$1",
          params: [id, actors.admin],
        },
      ]);
      const a = await api.getArticlePreview(id, request());
      assert.equal(a.publishedAt, null);
      assert.equal(a.editState.currentPublishedVersion, 1);
      const b = await save(command(a, { title: "seed edited" }));
      assert.equal(b.publishedAt, null);
      assert.equal(b.version, 2);
      assert.equal(b.slug, slug);
      const reader = await import("../src/lib/neon/public-data.server.ts");
      assert.equal((await reader.fetchArticleBySlug({ slug })).published_at, null);
      await assert.rejects(() => save(command(b, { slug: "seed-renamed" })), /SLUG_LOCKED/);
    },
  );
  await check("failed reads return typed unavailable, never empty success", async () => {
    await query("ALTER TABLE blog_categories RENAME TO task4_unavailable_categories");
    unavailableProbe = true;
    try {
      await assert.rejects(
        () => state(),
        (error) => error.code === "BLOG_UNAVAILABLE" && error.status === 503,
      );
      assert.equal(unavailableErrors, 1, "exact expected missing-relation diagnostic");
    } finally {
      unavailableProbe = false;
      await query("ALTER TABLE task4_unavailable_categories RENAME TO blog_categories");
    }
  });
  const { finalFixRegressions } = await import("./blog-cms/final-fix-regressions.mjs");
  await finalFixRegressions({
    check,
    api,
    legacy,
    request,
    query,
    race,
    create,
    save,
    command,
    category,
    state,
    settings,
  });
  console.log("PASS " + passed + " owned PostgreSQL groups; real request auth, no external target");
  mock.restoreAll();
});
