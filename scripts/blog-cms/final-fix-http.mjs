import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyArticle, articleInput } from "../../src/components/admin/blog/blog-editor-state.ts";

export async function finalFixHttp({ api, publicApi, document, query, restore, archive }) {
  const command = (a, patch = {}, action = "save") => ({
    id: a.id,
    expectedVersion: a.version,
    editState: a.editState,
    input: { ...articleInput(a), ...patch },
    action,
    requestId: randomUUID(),
  });
  const create = (slug, role = "admin") =>
    api.save(
      {
        input: { ...emptyArticle(), slug, title: "Final HTTP draft" },
        action: "save",
        requestId: randomUUID(),
      },
      role,
    );
  const slug = "final-http-" + randomUUID();
  const races = await Promise.allSettled([create(slug), create(slug, "manager")]);
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(races.find((r) => r.status === "rejected").reason.status, 422);
  const role = races[0].status === "fulfilled" ? "admin" : "manager";
  let a = races.find((r) => r.status === "fulfilled").value;
  assert.equal(a.slugLocked, false);
  a = await api.save(command(a, { slug: slug + "-renamed" }), role);
  a = await api.save(command(a, {}, "publish"), role);
  assert.equal(a.slugLocked, true);
  await document("/blog/" + a.slug, 200, "Final HTTP draft");
  const privateDraft = await api.save(
    command(await api.preview({ id: a.id }, "agent"), { title: "私人草稿不可外洩" }),
    "agent",
  );
  a = await api.save(command(a, { title: "Final HTTP public update" }), role);
  const stale = await api.preview({ id: a.id }, "agent");
  assert.equal(stale.title, privateDraft.title);
  await assert.rejects(
    () => api.save(command(stale), "agent"),
    (e) => e.status === 409,
  );
  const reconcile = command(stale, {}, "reconcile");
  const fixed = await api.save(reconcile, "agent");
  assert.deepEqual(await api.save(reconcile, "agent"), fixed);
  assert.equal(fixed.editState.basePublishedVersion, a.editState.currentPublishedVersion);
  await document("/blog/" + a.slug, 200, "Final HTTP public update");
  await api.save(command(a, {}, "unpublish"), role);
  assert.equal((await api.preview({ id: a.id }, "agent")).title, privateDraft.title);
  await document("/blog/" + a.slug, 404, "找不到文章或分類");
  let historyArticle = await create("final-restore-" + randomUUID());
  historyArticle = await api.save(command(historyArticle, {}, "publish"));
  const [history] = await query(
    "SELECT id FROM cms_content_revisions WHERE resource_id=$1 AND state='published'",
    [historyArticle.id],
  );
  const articleTokens = {
    requestId: randomUUID(),
    expectedVersion: historyArticle.version,
    editState: historyArticle.editState,
  };
  const staleRestore = { revisionId: history.id, articleTokens };
  const newerDraft = await api.save(command(historyArticle, { title: "changed while confirming" }));
  await assert.rejects(
    () => restore(staleRestore),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => archive({ resourceType: "article", resourceId: historyArticle.id, articleTokens }),
    (e) => e.status === 409,
  );
  const exactRestore = {
    revisionId: history.id,
    articleTokens: {
      requestId: randomUUID(),
      expectedVersion: newerDraft.version,
      editState: newerDraft.editState,
    },
  };
  const restored = await restore(exactRestore);
  assert.deepEqual(await restore(exactRestore), restored);
  const changedDraft = await api.save(
    command(
      await api.preview({ id: historyArticle.id }),
      { title: "post-restore private" },
      "reconcile",
    ),
  );
  assert.deepEqual(await restore(exactRestore), restored);
  assert.equal((await api.preview({ id: changedDraft.id })).title, changedDraft.title);
  const category = {
    key: "final-category-" + randomUUID(),
    name: "分類初名",
    heading: "",
    introduction: "",
    seoTitle: null,
    seoDescription: null,
    navigationOrder: 30,
    hidden: false,
    version: 0,
    settingsVersion: 0,
  };
  await assert.rejects(
    () => api.category({ ...category, key: "全部" }),
    (e) => e.status === 422,
  );
  const c = await api.category(category);
  await document("/blog?category=" + encodeURIComponent(c.key), 200, c.name);
  const renamed = await api.category({ ...c, name: "分類最新名稱" });
  const page = await publicApi.page({ categoryKey: c.key, page: 1 });
  assert.equal(page.settings.heading, renamed.name);
  await document("/blog?category=" + encodeURIComponent(c.key), 200, renamed.name);
  console.log(
    "PASS final-fix built HTTP: concurrent slug rejection/rename/lock, multiauthor private reconcile/replay/withdrawal, reserved category, blank heading and rename rendering",
  );
}
