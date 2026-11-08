import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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

await withOwnedPostgres(async ({ query, transaction }) => {
  await mockOwnedServerDb(mock, query, transaction);
  const path = new URL("../src/lib/neon/blog-public.server.ts", import.meta.url);
  assert.ok(existsSync(path), "Task7 requires the authoritative public CMS reader");
  const api = await import(path.href);
  const repository = await import("../src/lib/neon/blog-repository.server.ts");
  const old = await import("../src/lib/neon/public-data.server.ts");
  const visibility = await import("../src/lib/neon/blog-visibility.server.ts");
  const actor = { staffId: randomUUID() };
  await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [actor.staffId]);
  await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin')", [actor.staffId]);
  const category = (key, hidden = false) =>
    repository.saveBlogCategory(
      {
        key,
        name: key + "名稱",
        navigationOrder: 1,
        hidden,
        version: 0,
        settingsVersion: 0,
        heading: key + "標題",
        introduction: key + "簡介",
        seoTitle: key + "SEO",
        seoDescription: key + "描述",
      },
      actor,
    );
  const exact = await category("成交分析");
  const hidden = await category("隱藏分類", true);
  const empty = await category("空分類");
  const input = (slug, categoryId = exact.id) => ({
    slug,
    title: "公開標題 " + slug,
    excerpt: "摘要",
    categoryId,
    published: false,
    publishedAt: null,
    coverImage: "/cover.jpg",
    coverAlt: "封面描述",
    body: {
      format: "editor-json-v1",
      document: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "標題" }] },
          { type: "paragraph", content: [{ type: "text", text: "<script>literal</script>" }] },
          { type: "image", attrs: { src: "/media.jpg", alt: "照片" } },
        ],
      },
    },
    links: [{ href: "/estate/bellagio?x=1#facts", label: "屋苑" }],
    editorial: {
      author: "作者",
      reviewer: "審閱",
      sourcesNote: "來源",
      answerSummary: "重點",
      compareEstateSlugs: ["bellagio"],
    },
    readingMinutes: 8,
    seoTitle: "已儲存 SEO",
    seoDescription: "已儲存描述",
  });
  const create = (slug, categoryId) =>
    repository.saveBlogArticle(
      {
        input: input(slug, categoryId),
        action: "publish",
        requestId: randomUUID(),
      },
      actor,
    );
  const first = await create("sham-tseng-buying-guide-2026");
  const second = await create("second-feature");
  // Live projection fixtures with ties exercise count/page SQL and null dates.
  for (let i = 0; i < 27; i++)
    await query(
      `INSERT INTO articles(slug,title,content,category_id,published,published_at,created_at)
     VALUES($1,$1,'文字',$2,true,$3,'2026-01-01')`,
      ["regular-" + String(i).padStart(2, "0"), exact.id, i === 26 ? null : "2026-01-01"],
    );
  await create("hidden-article", hidden.id);
  await create("uncategorized", null);
  const state = await repository.getBlogAdminState(actor);
  const main = state.settings.find((s) => s.scope.kind === "main");
  await repository.saveBlogSettings(
    {
      ...main,
      heading: "主頁獨立標題",
      introduction: "主頁獨立簡介",
      featuredIds: [second.id, first.id],
    },
    actor,
  );
  const cat = state.settings.find((s) => s.scope.categoryId === exact.id);
  await repository.saveBlogSettings({ ...cat, featuredIds: [first.id, second.id] }, actor);
  const page = await api.getPublicBlogPage({ categoryKey: "成交分析", page: 1 });
  assert.equal(page.settings.heading, "成交分析標題");
  assert.equal(page.settings.introduction, "成交分析簡介");
  assert.equal(page.settings.seoTitle, "成交分析SEO");
  assert.deepEqual(
    page.featured.map((a) => a.id),
    [first.id, second.id],
  );
  assert.equal(page.articles.total, 27);
  assert.equal(
    page.categories.some((c) => c.id === hidden.id),
    false,
  );
  const collected = [];
  for (let n = 1; n <= Math.ceil(page.articles.total / page.articles.pageSize); n++) {
    const p = await api.getPublicBlogPage({ categoryKey: "成交分析", page: n });
    if (n > 1) assert.deepEqual(p.featured, []);
    assert.equal(p.articles.total, 27);
    collected.push(...p.articles.items.map((a) => a.slug));
  }
  assert.equal(collected.length, 27);
  assert.equal(new Set(collected).size, 27);
  assert.equal(collected.at(-1), "regular-26");
  assert.equal(
    (await api.getPublicBlogPage({ categoryKey: empty.key, page: 1 })).articles.total,
    0,
  );
  assert.equal(await api.getPublicBlogPage({ categoryKey: "成交", page: 1 }), null);
  assert.equal(
    (await api.getPublicBlogPage({ categoryKey: hidden.key, page: 1 })).articles.total,
    1,
  );
  const hub = await api.getPublicBlogPage({ page: 1 });
  assert.equal(hub.settings.heading, "主頁獨立標題");
  assert.deepEqual(
    hub.featured.map((a) => a.id),
    [second.id, first.id],
  );
  assert.equal(hub.articles.total, 29);
  console.log(
    "PASS exact categories, independent copy/features, hidden/empty/unknown and stable pagination",
  );

  const article = await api.getPublicBlogArticle(first.slug);
  assert.equal(article.seoTitle, "已儲存 SEO");
  assert.deepEqual(article.body, first.body);
  assert.deepEqual(article.editorial, first.editorial);
  assert.deepEqual(article.links, first.links);
  await repository.saveBlogArticle(
    {
      id: first.id,
      expectedVersion: first.version,
      editState: first.editState,
      input: { ...input(first.slug), title: "PRIVATE PREVIEW ONLY" },
      action: "save",
      requestId: randomUUID(),
    },
    {
      ...actor,
      staffId: await (async () => {
        const id = randomUUID();
        await query("INSERT INTO staff_users(id,active) VALUES($1,true)", [id]);
        await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [id]);
        return id;
      })(),
    },
  );
  const publicAgain = await api.getPublicBlogArticle(first.slug);
  assert.equal(publicAgain.title, first.title);
  assert.equal(publicAgain.editState.draftRevisionId, null);
  assert.ok(
    !JSON.stringify(await api.getPublicBlogPage({ page: 1 })).includes("PRIVATE PREVIEW ONLY"),
  );
  assert.ok((await old.fetchSitemapTimestamps()).articles[first.slug]);
  const mutate = async (id, patch, action = "publish") => {
    const current = await repository.getArticlePreview(id, actor);
    return repository.saveBlogArticle(
      {
        id,
        expectedVersion: current.version,
        editState: current.editState,
        input: { ...input(current.slug, current.categoryId), ...patch },
        action,
        requestId: randomUUID(),
      },
      actor,
    );
  };
  await mutate(first.id, {}, "unpublish");
  await mutate(second.id, { publishedAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(await api.getPublicBlogArticle(first.slug), null);
  assert.equal(await api.getPublicBlogArticle(second.slug), null);
  assert.equal(await api.getPublicBlogArticle("editorial-standards"), null);
  assert.equal(
    await api.getPublicBlogArticle("bellagio-vs-sea-crest-villa-vs-hong-kong-garden"),
    null,
  );
  assert.deepEqual(
    await visibility.filterPublicBlogSlugs([
      first.slug,
      second.slug,
      "bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
    ]),
    [],
  );
  assert.deepEqual((await api.getPublicBlogPage({ page: 1 })).featured, []);
  assert.equal(first.slug in (await old.fetchSitemapTimestamps()).articles, false);
  assert.equal(second.slug in (await old.fetchSitemapTimestamps()).articles, false);
  assert.ok(
    !(await old.fetchPublishedArticles()).some(
      (a) => a.slug === first.slug || a.slug === second.slug,
    ),
  );
  assert.ok(
    !(await api.getPublicRelatedArticles("bellagio")).some(
      (a) => a.slug === first.slug || a.slug === second.slug,
    ),
  );
  console.log(
    "PASS live metadata/body/media/links, draft isolation, withdrawal/future/missing registry across readers",
  );

  const moved = await create("moved-article", hidden.id);
  assert.equal(
    (await api.getPublicBlogPage({ categoryKey: hidden.key, page: 1 })).articles.total,
    2,
  );
  await mutate(moved.id, { categoryId: empty.id, title: "重新分類公開內容" });
  assert.equal(
    (await api.getPublicBlogPage({ categoryKey: hidden.key, page: 1 })).articles.total,
    1,
  );
  assert.equal(
    (await api.getPublicBlogPage({ categoryKey: empty.key, page: 1 })).articles.total,
    1,
  );
  assert.equal((await api.getPublicBlogArticle(moved.slug)).title, "重新分類公開內容");
  const currentMain = (await repository.getBlogAdminState(actor)).settings.find(
    (s) => s.scope.kind === "main",
  );
  await repository.saveBlogSettings(
    { ...currentMain, heading: "即時新標題", featuredIds: [moved.id] },
    actor,
  );
  const fresh = await api.getPublicBlogPage({ page: 1 });
  assert.equal(fresh.settings.heading, "即時新標題");
  assert.deepEqual(
    fresh.featured.map((a) => a.id),
    [moved.id],
  );
  assert.ok(
    !(await api.getPublicBlogPage({ page: 2 })).articles.items.some((a) => a.id === moved.id),
  );
  console.log(
    "PASS real CMS withdrawal, future publish, category reassignment and settings save are fresh on next read",
  );

  for (const length of [201, 240]) {
    const slug = "a".repeat(length);
    const saved = await create(slug, empty.id);
    assert.equal((await api.getPublicBlogArticle(slug)).id, saved.id);
    assert.ok(
      (await api.getPublicBlogPage({ page: 1 })).articles.items.some((a) => a.slug === slug),
    );
    assert.ok(slug in (await old.fetchSitemapTimestamps()).articles);
    assert.equal((await old.fetchArticleBySlug({ slug })).slug, slug);
  }
  console.log(
    "PASS 201/240-character published slugs agree across write, page, detail and sitemap readers",
  );

  await query("ALTER TABLE articles RENAME TO articles_unavailable");
  try {
    for (const run of [
      () => api.getPublicBlogPage({ page: 1 }),
      () => api.getPublicBlogArticle(first.slug),
      () => old.fetchPublishedArticles(),
      () => old.fetchArticleBySlug({ slug: first.slug }),
      () => old.fetchSitemapTimestamps(),
      () => api.getPublicRelatedArticles("bellagio"),
      () => visibility.filterPublicBlogSlugs([first.slug]),
    ]) {
      await assert.rejects(run, (e) => e.code === "BLOG_UNAVAILABLE" && e.status === 503);
    }
  } finally {
    await query("ALTER TABLE articles_unavailable RENAME TO articles");
  }
  console.log("PASS database outages are explicit typed unavailable on every public reader");
});
