import { test, expect } from "bun:test";
import { emptyArticle, articleInput } from "../../src/components/admin/blog/blog-editor-state";
import type { ArticleRecord, BlogCategory, BlogSettings } from "../../src/lib/blog/types";
import { digest } from "./hosted-contract";
import { runCmsScenario, type HostedIO } from "./hosted-scenario";
import { fixture } from "./hosted-test-fixture";

function seam() {
  const p = fixture(),
    records = new Map<string, ArticleRecord>(),
    drafts = new Map<string, ArticleRecord>();
  const requests = new Map<string, ArticleRecord>();
  const checks: string[] = [],
    urlChecks: string[] = [];
  const categories: BlogCategory[] = p.categoryIds.map((id, i) => ({
    id,
    key: "category" + i,
    name: "Category " + i,
    navigationOrder: i,
    hidden: false,
    version: 1,
    settingsVersion: 1,
    heading: "Heading " + i,
    introduction: "Intro",
    seoTitle: null,
    seoDescription: null,
  }));
  let settings: BlogSettings[] = p.settingsIds.map((_, i) => ({
    scope: i ? { kind: "category", categoryId: p.categoryIds[i - 1] } : { kind: "main" },
    heading: "Heading " + i,
    introduction: "Intro",
    seoTitle: null,
    seoDescription: null,
    featuredIds: [],
    version: 1,
  }));
  for (const [i, item] of p.articles.entries()) {
    const a: ArticleRecord = {
      ...emptyArticle(),
      id: item.id,
      slug: item.slug,
      title: item.title,
      categoryId: p.categoryIds[i % 7],
      published: true,
      version: 1,
      slugLocked: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      editState: {
        resourceId: item.id,
        draftRevisionId: null,
        draftVersion: null,
        draftEditVersion: null,
        currentPublishedVersion: 1,
        basePublishedVersion: null,
        restoredFromRevisionId: null,
      },
    };
    item.inputSha256 = digest(articleInput(a));
    records.set(item.id, a);
  }
  const failure = (status: number): never => {
    throw Object.assign(new Error("local seam denial"), { status });
  };
  const io: HostedIO = {
    async list(role) {
      if (!role) failure(401);
      return {
        items: [...records.values()].map((a) => ({ id: a.id, slug: a.slug })),
        total: records.size,
      };
    },
    async preview(id, role) {
      if (!role) failure(401);
      return structuredClone(
        role === "agent" && drafts.has(id) ? drafts.get(id)! : records.get(id)!,
      );
    },
    async save(cmd, role) {
      if (!role) failure(401);
      if (role === "agent" && cmd.action !== "save") failure(403);
      if (requests.has(cmd.requestId)) return structuredClone(requests.get(cmd.requestId)!);
      const old = records.get(cmd.id!)!;
      if (role !== "agent" && old.version !== cmd.expectedVersion) failure(409);
      const value = { ...old, ...cmd.input, version: old.version + 1 };
      if (cmd.action === "publish") value.published = true;
      if (cmd.action === "unpublish") value.published = false;
      if (role === "agent") drafts.set(value.id, value);
      else records.set(value.id, value);
      requests.set(cmd.requestId, value);
      return structuredClone(value);
    },
    async state(role) {
      if (!role) failure(401);
      if (role === "agent") failure(403);
      return structuredClone({ settings, categories });
    },
    async settings(value, role) {
      if (!role) failure(401);
      if (role === "agent") failure(403);
      const saved = { ...value, version: value.version + 1 };
      settings = settings.map((s) => (digest(s.scope) === digest(value.scope) ? saved : s));
      return structuredClone(saved);
    },
    async category(value, role) {
      if (!role) failure(401);
      if (role === "agent") failure(403);
      const saved = {
        ...value,
        version: value.version + 1,
        settingsVersion: value.settingsVersion + 1,
      };
      categories[categories.findIndex((c) => c.id === value.id)] = saved;
      return structuredClone(saved);
    },
    async article(slug) {
      const a = [...records.values()].find((a) => a.slug === slug)!;
      return a.published && (!a.publishedAt || Date.parse(a.publishedAt) <= Date.now())
        ? structuredClone(a)
        : null;
    },
    async page(key) {
      const scope = key
        ? { kind: "category", categoryId: categories.find((c) => c.key === key)!.id }
        : { kind: "main" };
      const s = settings.find((s) => digest(s.scope) === digest(scope))!;
      return {
        settings: structuredClone(s),
        featured: s.featuredIds.map((id) => ({ id })),
        articles: { items: [] },
      };
    },
    async document(path, status, title, absent) {
      if (path.startsWith("/blog/")) {
        const a = await io.article(path.slice(6));
        expect(a ? 200 : 404).toBe(status);
        if (title) expect(a?.title).toBe(title);
        if (absent) expect(a?.title).not.toBe(absent);
      }
    },
    async checkUrl(item) {
      urlChecks.push(item.slug);
    },
    async recover(expected) {
      return {
        target: {
          origin: p.target.origin,
          deploymentId: p.target.deploymentId,
          commit: p.target.commit,
        },
        faultId: p.recovery.id,
        failures: [
          { name: "pageServer", status: 503 },
          { name: "articleServer", status: 503 },
        ],
        pages: expected.map((v) => ({
          path: v.path,
          unavailableStatus: 500,
          unavailableVisible: true,
          retryVisible: true,
          recoveredStatus: 200,
          recoveredTitle: v.title,
        })),
        restored: true,
        elapsedMs: 10,
      };
    },
    async renderSettings(path, expected, paths) {
      const actual = await io.page(
        new URL(path, "https://local.invalid").searchParams.get("category") ?? undefined,
      );
      expect(actual.settings).toEqual({ ...expected, version: actual.settings.version });
      expect(
        actual.featured.map((a) => "/blog/" + p.articles.find((v) => v.id === a.id)!.slug),
      ).toEqual(paths);
    },
    async renderCategories(expected) {
      expect(expected).toEqual((await io.state("admin")).categories);
    },
    async indexes(slugs) {
      const visible = [];
      for (const a of records.values()) if (await io.article(a.slug)) visible.push(a.slug);
      expect([...slugs].sort()).toEqual(visible.sort());
    },
    mark(name) {
      checks.push(name);
    },
  };
  return { p, io, checks, urlChecks, requests };
}

for (const kind of ["article", "settings", "category"] as const) {
  test(`LOCAL_SEAM: consistently unchanged ${kind} writes must fail requested-value checks`, async () => {
    const s = seam();
    if (kind === "article") s.io.save = (cmd, role) => s.io.preview(cmd.id!, role);
    if (kind === "settings")
      s.io.settings = async (value) =>
        (await s.io.state("admin")).settings.find((v) => digest(v.scope) === digest(value.scope))!;
    if (kind === "category")
      s.io.category = async (value) =>
        (await s.io.state("admin")).categories.find((v) => v.id === value.id)!;
    await expect(runCmsScenario(s.p, s.io)).rejects.toThrow(
      kind === "article"
        ? "CMS_REQUESTED_TITLE"
        : kind === "settings"
          ? "CMS_REQUESTED_SETTINGS"
          : "CMS_REQUESTED_CATEGORY",
    );
  });
}
test("LOCAL_SEAM: all 112 identities, eight scopes, seven categories, roles, publication, retry execute", async () => {
  const s = seam();
  await runCmsScenario(s.p, s.io);
  expect(s.urlChecks.length).toBe(112);
  expect(s.checks).toEqual([
    "urls-112",
    "cms-112",
    "settings-8",
    "categories-7",
    "roles",
    "publication",
    "retry",
  ]);
  expect([...s.requests.values()].filter((a) => a.title.startsWith("Retry ")).length).toBe(1);
});

test("LOCAL_SEAM: consistently reordered feature IDs fail even when version and other fields change", async () => {
  const s = seam(),
    save = s.io.settings;
  s.io.settings = (value, role) =>
    save({ ...value, featuredIds: [...value.featuredIds].reverse() }, role);
  await expect(runCmsScenario(s.p, s.io)).rejects.toThrow("CMS_REQUESTED_SETTINGS");
  expect(s.checks).not.toContain("settings-8");
});

test("LOCAL_SEAM: successful replay cannot mark retry without unavailable browser recovery", async () => {
  const s = seam(),
    recover = s.io.recover;
  s.io.recover = async (expected) => ({ ...(await recover(expected)), failures: [] });
  await expect(runCmsScenario(s.p, s.io)).rejects.toThrow("RECOVERY_REAL_UNAVAILABLE_REQUIRED");
  expect([...s.requests.values()].filter((a) => a.title.startsWith("Retry ")).length).toBe(1);
  expect(s.checks).not.toContain("retry");
});

test("LOCAL_SEAM: public render failure cannot mark settings acceptance", async () => {
  const s = seam();
  s.io.renderSettings = async () => {
    throw new Error("CMS_RENDERED_FEATURE_ORDER");
  };
  await expect(runCmsScenario(s.p, s.io)).rejects.toThrow("CMS_RENDERED_FEATURE_ORDER");
  expect(s.checks).not.toContain("settings-8");
});
test("LOCAL_SEAM: wrong content association stops before all-record success", async () => {
  const s = seam();
  s.p.articles[0].inputSha256 = "0".repeat(64);
  await expect(runCmsScenario(s.p, s.io)).rejects.toThrow();
  expect(s.checks).toEqual(["urls-112"]);
});
test("LOCAL_SEAM: accepted anonymous actor is a boundary failure", async () => {
  const s = seam(),
    original = s.io.list;
  s.io.list = (role) => original(role ?? "admin");
  await expect(runCmsScenario(s.p, s.io)).rejects.toThrow();
  expect(s.checks).not.toContain("roles");
});
test("LOCAL_SEAM: a partial URL result never reaches CMS writes", async () => {
  const s = seam();
  let count = 0;
  s.io.checkUrl = async () => {
    if (++count === 50) throw new Error("missing URL");
  };
  await expect(runCmsScenario(s.p, s.io)).rejects.toThrow();
  expect(s.requests.size).toBe(0);
  expect(s.checks).toEqual([]);
});
