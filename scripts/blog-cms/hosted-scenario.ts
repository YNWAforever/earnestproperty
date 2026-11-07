import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { articleInput } from "../../src/components/admin/blog/blog-editor-state";
import type {
  ArticleRecord,
  BlogCategory,
  BlogSettings,
  SaveArticleCommand,
} from "../../src/lib/blog/types";
import { checklist, digest, roles, type HostedInput, type Role } from "./hosted-contract";
import { validateRecovery, type RecoveryEvidence } from "./hosted-recovery";

export type PublicArticle = {
  id: string;
  slug: string;
  title: string;
  body: ArticleRecord["body"];
} | null;
export interface HostedIO {
  list(role?: Role): Promise<{ items: { id: string; slug: string }[]; total: number }>;
  preview(id: string, role?: Role): Promise<ArticleRecord>;
  save(command: SaveArticleCommand, role?: Role): Promise<ArticleRecord>;
  state(role?: Role): Promise<{ categories: BlogCategory[]; settings: BlogSettings[] }>;
  settings(value: BlogSettings, role?: Role): Promise<BlogSettings>;
  category(value: BlogCategory, role?: Role): Promise<BlogCategory>;
  article(slug: string): Promise<PublicArticle>;
  page(categoryKey?: string): Promise<{
    settings: BlogSettings;
    featured: { id: string }[];
    articles: { items: { id: string }[] };
  }>;
  document(path: string, status: number, title?: string, absent?: string): Promise<void>;
  checkUrl(item: HostedInput["articles"][number]): Promise<void>;
  indexes(eligibleSlugs: string[]): Promise<void>;
  renderSettings(path: string, expected: BlogSettings, featuredPaths: string[]): Promise<void>;
  renderCategories(expected: BlogCategory[]): Promise<void>;
  recover(expected: { path: string; title: string }[]): Promise<RecoveryEvidence>;
  mark(check: string): void;
}
const denied = (status: number) => (error: unknown) =>
  !!error && typeof error === "object" && "status" in error && error.status === status;
export const command = (
  record: ArticleRecord,
  patch: Partial<ArticleRecord> = {},
  action: SaveArticleCommand["action"] = "save",
): SaveArticleCommand => ({
  id: record.id,
  expectedVersion: record.version,
  editState: record.editState,
  input: { ...articleInput(record), ...patch },
  action,
  requestId: randomUUID(),
});

export function assertSettings(expected: BlogSettings, actual: BlogSettings) {
  const { version: expectedVersion, ...wanted } = expected;
  const { version: actualVersion, ...received } = actual;
  assert.deepEqual(received, wanted, "CMS_REQUESTED_SETTINGS");
}
export function assertCategory(expected: BlogCategory, actual: BlogCategory) {
  const {
    version: expectedVersion,
    settingsVersion: expectedSettingsVersion,
    ...wanted
  } = expected;
  const { version: actualVersion, settingsVersion: actualSettingsVersion, ...received } = actual;
  assert.deepEqual(received, wanted, "CMS_REQUESTED_CATEGORY");
}

/** Fixed scenarios; a supplied IO is a unit-test seam, never a hosted receipt authority. */
export async function runCmsScenario(p: HostedInput, io: HostedIO) {
  for (const item of p.articles) await io.checkUrl(item);
  for (const path of checklist.pages) await io.document(path, 200);
  await io.indexes(p.articles.map((a) => a.slug));
  io.mark("urls-112");
  for (const role of roles) {
    const list = await io.list(role);
    assert.equal(list.total, 112);
    assert.deepEqual(list.items.map((a) => a.id).sort(), p.articles.map((a) => a.id).sort());
  }
  for (const item of p.articles) {
    const before = await io.preview(item.id, "admin");
    assert.equal(digest(articleInput(before)), item.inputSha256, "approved content association");
    assert.equal(before.slug, item.slug);
    assert.equal(before.slugLocked, true);
    const requested = command(before, { title: before.title + " [" + p.runId + "]" });
    const saved = await io.save(requested, "admin");
    assert.equal(saved.title, requested.input.title, "CMS_REQUESTED_TITLE");
    assert.deepEqual(articleInput(saved), requested.input, "CMS_REQUESTED_ARTICLE");
    assert.ok(saved.version > before.version, "CMS_ARTICLE_VERSION");
    assert.deepEqual(await io.preview(item.id, "admin"), saved);
    assert.equal((await io.article(item.slug))?.title, requested.input.title);
    await io.document("/blog/" + item.slug, 200, requested.input.title);
    const restored = await io.save(command(saved, { title: before.title }), "admin");
    assert.equal(restored.title, before.title);
  }
  io.mark("cms-112");
  const initial = await io.state("admin");
  assert.equal(initial.settings.length, 8);
  assert.equal(initial.categories.length, 7);
  for (const original of initial.settings) {
    const eligible: ArticleRecord[] = [];
    for (const item of p.articles) {
      const a = await io.preview(item.id, "admin");
      if (original.scope.kind === "main" || a.categoryId === original.scope.categoryId)
        eligible.push(a);
    }
    assert.ok(eligible.length >= 2, "two approved published records per scope required");
    const requested: BlogSettings = {
      ...original,
      heading: `Acceptance ${p.runId}`,
      introduction: "Isolated introduction",
      seoTitle: "Isolated SEO",
      seoDescription: "Isolated description",
      featuredIds: eligible
        .slice(0, 2)
        .reverse()
        .map((a) => a.id),
    };
    const saved = await io.settings(requested, "manager");
    assertSettings(requested, saved);
    assert.ok(saved.version > original.version, "CMS_SETTINGS_VERSION");
    assert.deepEqual(
      (await io.state("admin")).settings.find((s) => digest(s.scope) === digest(original.scope)),
      saved,
    );
    const key =
      original.scope.kind === "category"
        ? initial.categories.find(
            (c) => c.id === (original.scope as { categoryId: string }).categoryId,
          )!.key
        : undefined;
    const page = await io.page(key);
    assertSettings(requested, page.settings);
    assert.deepEqual(
      page.featured.map((a) => a.id),
      requested.featuredIds,
    );
    assert.equal(
      new Set([...page.featured, ...page.articles.items].map((a) => a.id)).size,
      page.featured.length + page.articles.items.length,
    );
    await io.renderSettings(
      key ? "/blog?category=" + encodeURIComponent(key) : "/blog",
      requested,
      requested.featuredIds.map((id) => "/blog/" + p.articles.find((a) => a.id === id)!.slug),
    );
    // Every other scope remains independent.
    for (const s of (await io.state("admin")).settings)
      if (digest(s.scope) !== digest(original.scope))
        assert.deepEqual(
          s,
          initial.settings.find((x) => digest(x.scope) === digest(s.scope)),
        );
    const restored = await io.settings({ ...original, version: saved.version }, "admin");
    assertSettings(original, restored);
    initial.settings = initial.settings.map((s) =>
      digest(s.scope) === digest(original.scope) ? restored : s,
    );
  }
  io.mark("settings-8");
  for (const original of initial.categories) {
    const current = (await io.state("admin")).categories.find((c) => c.id === original.id)!;
    const requested: BlogCategory = {
      ...current,
      name: current.name + " acceptance",
      navigationOrder: current.navigationOrder + 1,
    };
    const saved = await io.category(requested, "manager");
    assertCategory(requested, saved);
    assert.ok(saved.version > current.version, "CMS_CATEGORY_VERSION");
    assert.equal(saved.key, original.key);
    assert.deepEqual(
      (await io.state("admin")).categories.find((c) => c.id === original.id),
      saved,
    );
    await io.renderCategories((await io.state("admin")).categories);
    const restored = await io.category(
      { ...original, version: saved.version, settingsVersion: saved.settingsVersion },
      "admin",
    );
    assertCategory(original, restored);
    await io.renderCategories((await io.state("admin")).categories);
  }
  io.mark("categories-7");
  await assert.rejects(io.list(), denied(401));
  await assert.rejects(io.state(), denied(401));
  await assert.rejects(io.state("agent"), denied(403));
  const id = p.articles[0].id,
    slug = p.articles[0].slug;
  let a = await io.preview(id, "admin");
  await assert.rejects(io.preview(id), denied(401));
  await assert.rejects(io.save(command(a)), denied(401));
  const state = await io.state("admin");
  await assert.rejects(io.settings(state.settings[0], "agent"), denied(403));
  await assert.rejects(io.category(state.categories[0], "agent"), denied(403));
  await assert.rejects(io.settings(state.settings[0]), denied(401));
  await assert.rejects(io.category(state.categories[0]), denied(401));
  const draft = await io.save(
    command(await io.preview(id, "agent"), { title: "PRIVATE " + p.runId }),
    "agent",
  );
  assert.equal(draft.title, "PRIVATE " + p.runId, "CMS_REQUESTED_DRAFT");
  assert.equal((await io.preview(id, "agent")).title, "PRIVATE " + p.runId);
  assert.equal((await io.article(slug))?.title, a.title);
  await io.document("/blog/" + slug, 200, a.title, draft.title);
  await assert.rejects(io.save(command(draft, {}, "publish"), "agent"), denied(403));
  await assert.rejects(io.save(command(draft, {}, "unpublish"), "agent"), denied(403));
  const saved = await io.save(command(a, { title: a.title + " manager" }), "manager");
  assert.equal(saved.title, a.title + " manager", "CMS_REQUESTED_MANAGER_TITLE");
  assert.deepEqual(await io.preview(id, "manager"), saved);
  await assert.rejects(io.save(command(a, { title: "stale" }), "admin"), denied(409));
  assert.equal((await io.preview(id, "agent")).title, draft.title);
  io.mark("roles");
  a = await io.save(command(saved, {}, "unpublish"), "admin");
  assert.equal(await io.article(slug), null);
  await io.document("/blog/" + slug, 404);
  await io.indexes(p.articles.filter((a) => a.slug !== slug).map((a) => a.slug));
  a = await io.save(command(a, { publishedAt: "2099-01-01T00:00:00.000Z" }, "publish"), "admin");
  assert.equal(await io.article(slug), null);
  await io.document("/blog/" + slug, 404);
  await io.indexes(p.articles.filter((a) => a.slug !== slug).map((a) => a.slug));
  a = await io.save(command(a, { publishedAt: null }), "admin");
  assert.equal(a.publishedAt, null);
  assert.equal((await io.article(slug))?.title, a.title);
  await io.document("/blog/" + slug, 200, a.title, draft.title);
  await io.indexes(p.articles.map((a) => a.slug));
  io.mark("publication");
  // Lost-response retry: discard the first successful response, replay exact request ID and CAS.
  const retry = command(a, { title: "Retry " + p.runId });
  await io.save(retry, "admin");
  const once = await io.preview(id, "admin");
  assert.equal(once.title, retry.input.title, "CMS_REQUESTED_REPLAY_TITLE");
  const twice = await io.save(retry, "admin");
  assert.deepEqual(twice, once);
  assert.deepEqual(await io.preview(id, "admin"), once);
  const expectedRecovery = [
    { path: "/blog", title: (await io.page()).settings.heading },
    { path: "/blog/" + slug, title: retry.input.title },
  ];
  validateRecovery(p, await io.recover(expectedRecovery), expectedRecovery);
  io.mark("retry");
}
