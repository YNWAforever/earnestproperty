import { test, expect } from "bun:test";
import {
  buildImportPlan,
  candidate,
  fingerprint,
  inventoryArticle,
} from "../../src/lib/blog/reconcile";
import type { Inventory } from "../../src/lib/blog/reconcile";
import type { ArticleInput } from "../../src/lib/blog/types";
import fixture from "../../src/lib/blog/fixtures/import-source.json";
import { verifyManifest, runVerifyManifest } from "./verify-manifest";

function inventory(): Inventory {
  const targetIdentity = "owned:" + "a".repeat(64) + ":postgres";
  const database = {
    targetIdentity,
    systemIdentifier: "fixture-system",
    tables: Object.fromEntries(
      [
        "articles",
        "cms_content_revisions",
        "blog_categories",
        "blog_settings",
        "blog_featured_articles",
        "blog_legacy_category_map",
        "app_migrations",
      ].map((t) => [t, []]),
    ),
  };
  const url = "https://example.invalid/blog/" + fixture.slug;
  return {
    articles: [inventoryArticle("registry", candidate(fixture as ArticleInput, "registry"), url)],
    completeSources: ["database", "registry", "public", "presentation"],
    unresolvedSources: [],
    categories: [],
    settings: [],
    sourceRevision: "source-fixture-v1",
    sourceDigest: fingerprint(fixture),
    publicUrls: [url],
    targetIdentity,
    database: { ...database, fingerprint: fingerprint(database) },
  };
}
const binding = (i: Inventory) => ({
  fingerprint: buildImportPlan(i).fingerprint,
  targetIdentity: i.targetIdentity,
  sourceRevision: i.sourceRevision,
});

test("unchanged complete observations pass without mutating approval or granting activation", () => {
  const i = inventory(),
    plan = buildImportPlan(i),
    approved = binding(i);
  const before = JSON.stringify({ i, plan, approved });
  expect(verifyManifest(plan, i, approved).activationAuthorized).toBe(false);
  expect(JSON.stringify({ i, plan, approved })).toBe(before);
});

for (const [name, mutate] of Object.entries<Record<string, (i: Inventory) => void>[string]>({
  changedDB: (i) => {
    i.database!.tables.articles.push({ id: "changed", version: 2 });
    const { fingerprint: ignored, ...data } = i.database!;
    i.database!.fingerprint = fingerprint(data);
  },
  publicURLs: (i) => {
    i.publicUrls!.push("https://example.invalid/blog/new-url");
  },
  missingSources: (i) => {
    i.completeSources = i.completeSources.filter((s) => s !== "public");
  },
  missingTable: (i) => {
    delete i.database!.tables.cms_content_revisions;
  },
  missingDatabase: (i) => {
    delete i.database;
  },
  target: (i) => {
    i.targetIdentity = "different-target";
  },
  revision: (i) => {
    i.sourceRevision = "different-revision";
  },
  system: (i) => {
    i.database!.systemIdentifier = "different-system";
  },
  sourceDigest: (i) => {
    i.sourceDigest = "different-source";
  },
  failedRead: (i) => {
    i.unresolvedSources.push("source:public:unavailable");
  },
})) {
  test(name + " rejects rather than silently approving a new fingerprint", () => {
    const original = inventory(),
      plan = buildImportPlan(original),
      approved = binding(original);
    const fresh = structuredClone(original);
    mutate(fresh);
    const before = JSON.stringify({ plan, approved, fresh });
    expect(() => verifyManifest(plan, fresh, approved)).toThrow(/^MANIFEST_/);
    expect(JSON.stringify({ plan, approved, fresh })).toBe(before);
  });
}
test("tampered manifest and explicit approval/target/revision mismatches fail", () => {
  const i = inventory(),
    plan = buildImportPlan(i),
    approved = binding(i);
  for (const key of ["fingerprint", "targetIdentity", "sourceRevision"] as const)
    expect(() => verifyManifest(plan, i, { ...approved, [key]: "wrong" })).toThrow(/^MANIFEST_/);
  plan.insert = [];
  expect(() => verifyManifest(plan, i, approved)).toThrow("MANIFEST_TAMPERED");
});
test("CLI accepts neither a URL nor a write/approval mutation option", async () => {
  for (const flag of ["--database-url", "--apply", "--approve", "--output"])
    await expect(runVerifyManifest([flag, "forbidden"])).rejects.toThrow("MANIFEST_ARGUMENTS");
});
