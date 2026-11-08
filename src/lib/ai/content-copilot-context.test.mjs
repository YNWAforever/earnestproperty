import assert from "node:assert/strict";
import test from "node:test";

import { createContentCopilotContextLoader } from "./content-copilot-context.server.ts";

const actor = {
  staffId: "11111111-1111-4111-8111-111111111111",
  authUserId: "synthetic-auth",
  email: "qa@example.invalid",
  name: null,
  roles: ["admin"],
  bootstrap: false,
};

const articleId = "22222222-2222-4222-8222-222222222222";
const request = {
  resourceType: "article",
  resourceId: articleId,
  action: "improve",
  selectedFields: ["title"],
  tone: "professional_property",
  targetLanguage: null,
  researchMode: "internal",
};

/** A row as the loader's draft query returns it (payload columns flattened by SQL). */
function draftRow(overrides = {}) {
  return {
    id: articleId,
    slug: "oncc-20260907-31ffdd",
    title: "草稿標題",
    excerpt: "草稿摘要",
    content: "草稿正文",
    seo_title: null,
    seo_description: null,
    category: "晉誠成交",
    reading_minutes: 2,
    published: false,
    published_at: null,
    updated_at: new Date("2026-11-08T20:00:00Z"),
    source_db_revision: "a".repeat(32),
    ...overrides,
  };
}

function publishedRow(overrides = {}) {
  return {
    id: articleId,
    slug: "published-article",
    title: "已發布標題",
    excerpt: "已發布摘要",
    content: "已發布正文",
    seo_title: "SEO",
    seo_description: "描述",
    category: "市場評論",
    reading_minutes: 3,
    published: true,
    published_at: new Date("2026-10-01T00:00:00Z"),
    updated_at: new Date("2026-10-01T00:00:00Z"),
    source_db_revision: "b".repeat(32),
    ...overrides,
  };
}

function loaderFor({ draft = [], published = [] }, calls = []) {
  return createContentCopilotContextLoader({
    queryRows: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("cms_content_revisions")) return draft;
      if (sql.includes("FROM articles")) return published;
      return [];
    },
    searchPublicKnowledge: async () => [],
  });
}

test("a never-published article draft is a valid copilot source", async () => {
  const calls = [];
  const loader = loaderFor({ draft: [draftRow()] }, calls);
  const context = await loader.load(request, actor);

  // CMS v2 keeps the only copy of a draft in cms_content_revisions; reading `articles`
  // alone answered COPILOT_RESOURCE_NOT_FOUND for every imported-but-unpublished post.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [articleId, actor.staffId]);
  assert.equal(context.resource.title, "草稿標題");
  assert.equal(context.resource.content, "草稿正文");
  assert.equal(context.resource.category, "晉誠成交");
  assert.equal(context.resource.published, false);
  assert.equal(context.sourceDbRevision, "a".repeat(32));
  assert.match(context.query, /article/);
  assert.match(context.query, /草稿標題/);
  assert.match(context.internalEvidence[0].excerpt, /草稿正文/);
});

test("a published article without a draft still resolves through the projection", async () => {
  const calls = [];
  const loader = loaderFor({ published: [publishedRow()] }, calls);
  const context = await loader.load(request, actor);

  assert.equal(calls.length, 2);
  assert.equal(context.resource.title, "已發布標題");
  assert.equal(context.resource.published, true);
  assert.equal(context.sourceDbRevision, "b".repeat(32));
});

test("an unknown article id is still COPILOT_RESOURCE_NOT_FOUND", async () => {
  const loader = loaderFor({});
  await assert.rejects(loader.load(request, actor), /COPILOT_RESOURCE_NOT_FOUND/);
});

test("knowledge search failures keep the saved-record evidence", async () => {
  const loader = createContentCopilotContextLoader({
    queryRows: async (sql) => (sql.includes("cms_content_revisions") ? [draftRow()] : []),
    searchPublicKnowledge: async () => {
      throw new Error("search down");
    },
  });
  const context = await loader.load(request, actor);
  assert.equal(context.internalEvidence.length, 1);
  assert.equal(context.internalEvidence[0].type, "internal");
});
