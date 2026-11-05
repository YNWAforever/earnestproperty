import { articleCopilotValues, applyArticleCopilotPatch } from "./article-copilot-state";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BlogManager } from "./BlogManager";
import {
  emptyArticle,
  articleInput,
  articleError,
  createSaveSession,
  changeQuery,
  convertLiteralBody,
  eligibleFeature,
} from "./blog-editor-state";
import type { ArticleRecord, SaveArticleCommand } from "@/lib/blog/types";
import { ServerFnResponseError } from "@/lib/neon/server-fn-response";
const record = (): ArticleRecord => ({
  ...emptyArticle(),
  id: "saved-id",
  createdAt: "2026-11-05T00:00:00Z",
  version: 3,
  slugLocked: true,
  editState: {
    resourceId: "saved-id",
    draftRevisionId: "revision",
    draftVersion: 4,
    draftEditVersion: 2,
    currentPublishedVersion: 3,
    basePublishedVersion: 3,
    restoredFromRevisionId: null,
  },
});
describe("blog editor state used by components", () => {
  test("filter/search changes reset page 101 navigation to page one", () => {
    expect(
      changeQuery({ search: "", state: "all", page: 5, pageSize: 25 }, { search: "101" }).page,
    ).toBe(1);
    expect(
      changeQuery({ search: "", state: "all", page: 5, pageSize: 25 }, { state: "draft" }).page,
    ).toBe(1);
  });
  test("successful save installs resource identity and full CAS before failed refresh", async () => {
    const session = createSaveSession();
    const events: string[] = [];
    let installed: ArticleRecord | null = null;
    await session.save(
      { input: emptyArticle(), action: "save" },
      async () => record(),
      (r) => {
        installed = r;
        events.push("install");
      },
      async () => {
        events.push("refresh");
        throw Error("offline");
      },
    );
    expect(events).toEqual(["install", "refresh"]);
    expect<unknown>(installed).toEqual(record());
  });
  test("retries exact failed command with same receipt; changed content gets new receipt", async () => {
    const session = createSaveSession();
    const seen: SaveArticleCommand[] = [];
    const fail = async (c: SaveArticleCommand): Promise<ArticleRecord> => {
      seen.push(c);
      throw Error("offline");
    };
    const c = { input: emptyArticle(), action: "save" as const };
    await session
      .save(
        c,
        fail,
        () => {},
        async () => {},
      )
      .catch(() => {});
    await session
      .save(
        c,
        fail,
        () => {},
        async () => {},
      )
      .catch(() => {});
    await session
      .save(
        { ...c, input: { ...c.input, title: "changed" } },
        fail,
        () => {},
        async () => {},
      )
      .catch(() => {});
    expect(seen[0].requestId).toBe(seen[1].requestId);
    expect(seen[2].requestId).not.toBe(seen[1].requestId);
  });
  test("stale save never installs or clears typed input", async () => {
    const input = { ...emptyArticle(), title: "typed text" };
    let installed = false;
    await expect(
      createSaveSession().save(
        { input, action: "save" },
        async () => {
          throw new ServerFnResponseError("BLOG_VERSION_CONFLICT", 409);
        },
        () => {
          installed = true;
        },
        async () => {},
      ),
    ).rejects.toThrow("BLOG_VERSION_CONFLICT");
    expect(installed).toBe(false);
    expect(input.title).toBe("typed text");
  });
  test("browser errors use numeric status/message", () => {
    expect(articleError(new ServerFnResponseError("BLOG_VERSION_CONFLICT", 409))).toContain("保留");
    expect(articleError(new ServerFnResponseError("Forbidden", 403))).toContain("權限");
  });
  test("DTO input excludes identity and tokens while preserving editorial, links and nullable date", () => {
    const r = record();
    r.editorial.compareEstateSlugs = ["sea-crest", "ocean-pointe"];
    r.links = [{ href: "/about", label: "About" }];
    const input = articleInput(r);
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("editState");
    expect(input.publishedAt).toBeNull();
    expect(input.editorial).toEqual(r.editorial);
    expect(input.links).toEqual(r.links);
  });
  test("legacy conversion preserves literal HTML, whitespace and newline meaning", () => {
    const text = "  <b>literal</b>\r\n\nlast  ";
    const body = convertLiteralBody(text);
    expect(body.format).toBe("editor-json-v1");
    if (body.format === "editor-json-v1")
      expect(body.document.content[0]).toEqual({
        type: "paragraph",
        content: [{ type: "text", text }],
      });
  });
  test("feature picker refuses drafts, future rows, wrong categories", () => {
    const a = { ...record(), published: true, categoryId: "one" };
    expect(eligibleFeature(a, { kind: "category", categoryId: "two" })).toBe(false);
    expect(eligibleFeature({ ...a, published: false }, { kind: "main" })).toBe(false);
    expect(eligibleFeature({ ...a, publishedAt: "2999-01-01T00:00:00Z" }, { kind: "main" })).toBe(
      false,
    );
    expect(eligibleFeature(a, { kind: "main" })).toBe(true);
  });
  test("agent rendering exposes articles without administrative settings", () => {
    const html = renderToStaticMarkup(<BlogManager canPublish={false} />);
    expect(html).toContain("文章");
    expect(html).not.toContain("網誌設定");
    expect(html).not.toContain("分類管理");
  });
});

describe("article copilot adapter", () => {
  test("scalar patches preserve metadata, links, publication and CAS; legacy text stays literal", () => {
    const original = record();
    original.body = { format: "legacy-text", text: "  <b>old</b>\r\n" };
    original.links = [{ label: "來源", href: "/about" }];
    const next = applyArticleCopilotPatch(original, {
      title: "建議標題",
      content: "  <b>new</b>\r\n",
      published: "true",
      slug: "changed",
    });
    expect(next.title).toBe("建議標題");
    expect(next.body).toEqual({ format: "legacy-text", text: "  <b>new</b>\r\n" });
    expect(next.editorial).toEqual(original.editorial);
    expect(next.links).toEqual(original.links);
    expect(next.editState).toEqual(original.editState);
    expect(next.published).toBe(original.published);
    expect(next.slug).toBe(original.slug);
  });
  test("rich body uses existing serialized content contract and exact rich undo", () => {
    const original = { ...record(), body: convertLiteralBody("  <b>literal</b>\r\n") };
    const before = articleCopilotValues(original);
    const changed = applyArticleCopilotPatch(original, { content: "  <i>suggestion</i>\r\n" });
    expect(changed.body).toEqual(convertLiteralBody("  <i>suggestion</i>\r\n"));
    expect(applyArticleCopilotPatch(changed, { content: before.content }).body).toEqual(
      original.body,
    );
    expect(applyArticleCopilotPatch(original, { title: "title only" }).body).toBe(original.body);
  });
  test("invalid rich documents and non-string suggestions cannot erase current content", () => {
    const original = { ...record(), body: convertLiteralBody("keep me") };
    expect(() =>
      applyArticleCopilotPatch(original, {
        content: '{"type":"doc","content":[{"type":"script"}]}',
      }),
    ).toThrow();
    expect(() => applyArticleCopilotPatch(original, { content: ["wrong"] })).toThrow();
    expect(original.body).toEqual(convertLiteralBody("keep me"));
  });
});
