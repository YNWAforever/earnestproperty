import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Real owned PostgreSQL callers supply authenticated APIs and a lock-contended race.
export async function finalFixRegressions({
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
}) {
  const preview = (id, role = "admin") => api.getArticlePreview(id, request(role));
  const tokens = (a) => ({
    requestId: randomUUID(),
    expectedVersion: a.version,
    editState: a.editState,
  });
  await check(
    "final-fix explicit reconciliation preserves private content, rejects drift and exact retry",
    async () => {
      const published = await create({}, "publish");
      const privateDraft = await save(
        command(await preview(published.id, "agent"), { title: "private author content" }),
        "agent",
      );
      const newer = await save(command(published, { title: "manager publication" }));
      const stale = await preview(published.id, "agent");
      assert.equal(stale.title, privateDraft.title);
      assert.equal(stale.editState.basePublishedVersion, published.version);
      await assert.rejects(() => save(command(stale), "agent"), /CONFLICT/);
      const reconcile = command(stale, { title: "author unsaved changes retained" }, "reconcile");
      const fixed = await save(reconcile, "agent");
      assert.equal(fixed.title, reconcile.input.title);
      assert.equal(fixed.editState.basePublishedVersion, newer.version);
      assert.equal((await preview(published.id)).title, newer.title);
      assert.deepEqual(await save(reconcile, "agent"), fixed);
      const changed = await save(command(fixed, { title: "another tab" }), "agent");
      await assert.rejects(() => save(command(fixed, {}, "reconcile"), "agent"), /CONFLICT/);
      const pending = command(changed, {}, "reconcile");
      await save(command(newer, { title: "public changes again" }));
      await assert.rejects(() => save(pending, "agent"), /CONFLICT/);
      assert.equal((await preview(published.id, "agent")).title, "another tab");
    },
  );
  await check(
    "final-fix multiauthor withdrawal archives public payload only and preserves all private drafts",
    async () => {
      const published = await create({ title: "shared public" }, "publish");
      const agent = await save(
        command(await preview(published.id, "agent"), { title: "agent secret" }),
        "agent",
      );
      const manager = await legacy.saveAdminCmsDraft(
        {
          resourceType: "article",
          resourceId: published.id,
          payload: { slug: published.slug, title: "manager secret", content: "private body" },
          basePublishedVersion: published.version,
        },
        request("manager"),
      );
      const withdrawn = await save(command(published, { title: "admin secret" }, "unpublish"));
      assert.equal(withdrawn.published, false);
      const rows = await query(
        "SELECT state,payload,draft_retired_at,created_by FROM cms_content_revisions WHERE resource_type='article' AND resource_id=$1",
        [published.id],
      );
      assert.deepEqual(
        rows.filter((r) => r.state === "archived").map((r) => r.payload.title),
        ["shared public"],
      );
      assert.equal(rows.filter((r) => r.state === "draft" && !r.draft_retired_at).length, 3);
      assert.equal((await preview(published.id, "agent")).title, agent.title);
      assert.equal(
        (await preview(published.id, "manager")).editState.draftRevisionId,
        manager.revisionId,
      );
      const reconciled = await save(
        command(await preview(published.id, "agent"), {}, "reconcile"),
        "agent",
      );
      assert.equal(reconciled.editState.basePublishedVersion, null);
      const privateOnly = await create({ title: "never shared" });
      const archive = {
        resourceType: "article",
        resourceId: privateOnly.id,
        articleTokens: tokens(privateOnly),
      };
      assert.equal((await legacy.archiveAdminCmsResource(archive, request())).ok, false);
      assert.equal((await preview(privateOnly.id)).title, "never shared");
      assert.equal(
        (
          await query(
            "SELECT count(*)::int AS n FROM cms_content_revisions WHERE resource_id=$1 AND state<>'draft'",
            [privateOnly.id],
          )
        )[0].n,
        0,
      );
      await assert.rejects(() => preview(privateOnly.id, "manager"), /NOT_FOUND/);
    },
  );
  await check(
    "final-fix restore and legacy archive CAS, no identity bypass, replay and real contention",
    async () => {
      let a = await create({}, "publish");
      const [history] = await query(
        "SELECT id FROM cms_content_revisions WHERE resource_id=$1 AND state='published'",
        [a.id],
      );
      const d = await legacy.saveAdminCmsDraft(
        {
          resourceType: "article",
          resourceId: a.id,
          payload: { slug: a.slug, title: "private original" },
          basePublishedVersion: a.version,
        },
        request(),
      );
      a = await preview(a.id);
      const restore = { revisionId: history.id, articleTokens: tokens(a) };
      const archive = { resourceType: "article", resourceId: a.id, articleTokens: tokens(a) };
      await assert.rejects(
        () => legacy.restoreAdminCmsRevision({ revisionId: history.id }, request()),
        /CONFLICT/,
      );
      await assert.rejects(
        () =>
          legacy.archiveAdminCmsResource({ resourceType: "article", resourceId: a.id }, request()),
        /CONFLICT/,
      );
      await legacy.saveAdminCmsDraft(
        {
          resourceType: "article",
          resourceId: a.id,
          draftRevisionId: d.revisionId,
          draftEditVersion: d.editState.draftEditVersion,
          basePublishedVersion: a.version,
          payload: { slug: a.slug, title: "newer same author draft" },
        },
        request(),
      );
      await assert.rejects(() => legacy.restoreAdminCmsRevision(restore, request()), /CONFLICT/);
      await assert.rejects(() => legacy.archiveAdminCmsResource(archive, request()), /CONFLICT/);
      assert.equal((await preview(a.id)).title, "newer same author draft");
      const current = await preview(a.id);
      const retry = { revisionId: history.id, articleTokens: tokens(current) };
      const results = await race(
        () => legacy.restoreAdminCmsRevision(retry, request()),
        () => legacy.restoreAdminCmsRevision(retry, request()),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
      assert.deepEqual(results[0].value, results[1].value);
      const restored = await preview(a.id);
      await save(command(restored, { title: "after restore" }, "reconcile"));
      assert.deepEqual(await legacy.restoreAdminCmsRevision(retry, request()), results[0].value);
      assert.equal((await preview(a.id)).title, "after restore");
      const fresh = await preview(a.id);
      const outcomes = await race(
        () =>
          legacy.restoreAdminCmsRevision(
            { revisionId: history.id, articleTokens: tokens(fresh) },
            request(),
          ),
        () => save(command(fresh, { title: "race edit" }, "reconcile")),
      );
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(outcomes.find((r) => r.status === "rejected").reason.message, /CONFLICT/);
      const beforePublic = await preview(a.id);
      await save(
        command(await preview(a.id, "manager"), { title: "other manager published" }),
        "manager",
      );
      await assert.rejects(
        () =>
          legacy.restoreAdminCmsRevision(
            { revisionId: history.id, articleTokens: tokens(beforePublic) },
            request(),
          ),
        /CONFLICT/,
      );
      await assert.rejects(
        () =>
          legacy.archiveAdminCmsResource(
            { resourceType: "article", resourceId: a.id, articleTokens: tokens(beforePublic) },
            request(),
          ),
        /CONFLICT/,
      );
    },
  );
  await check(
    "final-fix simultaneous slug claims, draft rename, legacy collision and first publication lock",
    async () => {
      const slug = randomUUID();
      const results = await race(
        () => create({ slug }, "save", "admin"),
        () => create({ slug }, "save", "manager"),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.match(results.find((r) => r.status === "rejected").reason.message, /VALIDATION/);
      const winner = results.find((r) => r.status === "fulfilled").value;
      const role = results[0].status === "fulfilled" ? "admin" : "manager";
      assert.equal(winner.slugLocked, false);
      await assert.rejects(
        () =>
          legacy.saveAdminCmsDraft(
            { resourceType: "article", payload: { slug, title: "collision" } },
            request(),
          ),
        /SLUG_TAKEN/,
      );
      const renamed = await save(command(winner, { slug: randomUUID() }), role);
      assert.notEqual(renamed.slug, slug);
      await create({ slug }); // Released draft slug is reusable.
      const occupied = await create();
      await assert.rejects(
        () => save(command(renamed, { slug: occupied.slug }), role),
        /VALIDATION/,
      );
      const published = await save(command(renamed, {}, "publish"), role);
      assert.equal(published.slugLocked, true);
      await assert.rejects(
        () => save(command(published, { slug: randomUUID() }), role),
        /SLUG_LOCKED/,
      );
    },
  );
  await check(
    "final-fix reserved category and blank override follows renamed hidden category",
    async () => {
      await assert.rejects(() => category("全部"), /VALIDATION/);
      await assert.rejects(
        () => query("INSERT INTO blog_categories(key,name) VALUES('全部','reserved')"),
        /RESERVED_CATEGORY/,
      );
      let c = await category("精確分類 " + randomUUID());
      c = await api.saveBlogCategory(
        { ...c, heading: "", introduction: "", hidden: true },
        request(),
      );
      const publicApi = await import("../../src/lib/neon/blog-public.server.ts");
      assert.equal(
        (await publicApi.getPublicBlogPage({ categoryKey: c.key, page: 1 })).settings.heading,
        c.name,
      );
      c = await api.saveBlogCategory({ ...c, name: "最新顯示名稱" }, request());
      const page = await publicApi.getPublicBlogPage({ categoryKey: c.key, page: 1 });
      assert.equal(page.settings.heading, c.name);
      assert.equal(page.settings.introduction, "");
      assert.equal(
        page.categories.some((x) => x.id === c.id),
        false,
      );
      const main = (await state()).settings.find((s) => s.scope.kind === "main");
      await assert.rejects(() => settings({ ...main, heading: " " }), /VALIDATION/);
      const [admin] = await query(
        "SELECT staff_user_id AS id FROM staff_roles WHERE role='admin' LIMIT 1",
      );
      await assert.rejects(
        () =>
          query("SELECT blog_save_settings($1::uuid,$2::jsonb)", [
            admin.id,
            JSON.stringify({ ...main, heading: " " }),
          ]),
        /VALIDATION_HEADING/,
      );
    },
  );
}
