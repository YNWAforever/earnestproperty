import { z } from "zod";
import { articleEditorSchema } from "./editor-schema";
import type {
  ArticleBody,
  ArticleEditorialMetadata,
  EditorDocument,
  EditorMark,
  EditorNode,
  SupplementalLink,
  ValidatedArticleBody,
} from "./types";

/** Deliberately excludes protocol-relative, data/blob/file and obfuscated URLs. */
export function isSafeArticleUrl(value: string): boolean {
  // Reject controls before URL parsing can normalize an obfuscated protocol.
  // eslint-disable-next-line no-control-regex
  if (!value || value !== value.trim() || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  if (value.startsWith("#") && value.length > 1) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}
const safeUrl = z.string().max(4096).refine(isSafeArticleUrl, "不支援的連結網址");
const imageUrl = safeUrl.refine((value) => !value.startsWith("#"), "圖片需要有效網址");
const nullableText = z.string().max(100_000).nullable();
const markSchema: z.ZodType<EditorMark> = z.union([
  z.object({ type: z.enum(["bold", "italic", "strike", "underline", "code"]) }).strict(),
  z
    .object({
      type: z.literal("link"),
      attrs: z
        .object({
          href: safeUrl,
          target: z.enum(["_blank", "_self"]).nullable().optional(),
          rel: z.string().max(256).nullable().optional(),
          title: nullableText.optional(),
          class: z.null().optional(),
        })
        .strict(),
    })
    .strict(),
]);
const marks = z
  .array(markSchema)
  .max(6)
  .refine((value) => new Set(value.map((mark) => mark.type)).size === value.length, "重複格式");
// Dispatch by type before visiting children; ordinary recursive unions amplify malformed input.
const nodeSchema: z.ZodType<EditorNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.enum(["doc", "paragraph", "blockquote", "bulletList", "listItem"]),
        content: z.array(nodeSchema).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("heading"),
        attrs: z.object({ level: z.union([z.literal(2), z.literal(3), z.literal(4)]) }).strict(),
        content: z.array(nodeSchema).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("orderedList"),
        attrs: z
          .object({
            start: z.number().int().min(1).max(1_000_000).optional(),
            type: z.null().optional(),
          })
          .strict()
          .optional(),
        content: z.array(nodeSchema).optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("text"), text: z.string().min(1), marks: marks.optional() })
      .strict(),
    z.object({ type: z.literal("hardBreak"), marks: marks.optional() }).strict(),
    z.object({ type: z.literal("horizontalRule") }).strict(),
    z
      .object({
        type: z.literal("image"),
        attrs: z
          .object({
            src: imageUrl,
            alt: nullableText.optional(),
            title: nullableText.optional(),
            width: z.number().int().positive().max(10000).nullable().optional(),
            height: z.number().int().positive().max(10000).nullable().optional(),
          })
          .strict(),
      })
      .strict(),
  ]),
);

/** Bound recursion and work before recursive parsing, including hostile cyclic JS input. */
function assertBoundedJson(input: unknown): void {
  let values = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (++values > 20_000 || depth > 64) throw new Error("文章結構過大或過深");
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 1_000_000) throw new Error("文章內容過長");
      return;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return;
    if (typeof value !== "object") throw new Error("文章必須是 JSON 資料");
    if (ancestors.has(value)) throw new Error("文章包含循環資料");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("文章必須是 JSON 物件");
    ancestors.add(value);
    for (const item of Object.values(value)) visit(item, depth + 1);
    ancestors.delete(value);
  }
  visit(input, 0);
}

/** Reject unknown keys BEFORE ProseMirror (which otherwise silently drops unknown attrs). */
export function validateArticleBody(body: ArticleBody): ValidatedArticleBody {
  assertBoundedJson(body);
  const envelope = z
    .discriminatedUnion("format", [
      z.object({ format: z.literal("legacy-text"), text: z.string() }).strict(),
      z.object({ format: z.literal("editor-json-v1"), document: z.unknown() }).strict(),
    ])
    .parse(body);
  if (envelope.format === "legacy-text") return envelope;
  const document = nodeSchema.parse(envelope.document);
  if (document.type !== "doc" || !document.content?.length)
    throw new Error("文章需要文件根節點及段落");
  // Enforces parent/child grammar, valid marks and text structure using the editor's actual schema.
  articleEditorSchema.nodeFromJSON(document).check();
  return { format: "editor-json-v1", document: document as EditorDocument };
}

export function validateSupplementalLinks(input: unknown): SupplementalLink[] {
  assertBoundedJson(input);
  return z
    .array(z.object({ href: safeUrl, label: z.string().max(100_000) }).strict())
    .max(200)
    .parse(input);
}

export function validateEditorialMetadata(input: unknown): ArticleEditorialMetadata {
  assertBoundedJson(input);
  return z
    .object({
      author: nullableText,
      reviewer: nullableText,
      sourcesNote: nullableText,
      answerSummary: nullableText,
      compareEstateSlugs: z
        .array(
          z
            .string()
            .max(200)
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        )
        .max(200),
    })
    .strict()
    .parse(input);
}

/** Strings stay literal. Paragraph arrays opt in to an explicit, lossless rich conversion. */
export function convertLegacyBody(input: string | readonly string[]): ValidatedArticleBody {
  if (typeof input === "string") return validateArticleBody({ format: "legacy-text", text: input });
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string"))
    throw new Error("舊文章需要文字或段落陣列");
  return validateArticleBody({
    format: "editor-json-v1",
    document: {
      type: "doc",
      content: input.length
        ? input.map((value) =>
            value
              ? { type: "paragraph", content: [{ type: "text", text: value }] }
              : { type: "paragraph" },
          )
        : [{ type: "paragraph" }],
    },
  });
}
