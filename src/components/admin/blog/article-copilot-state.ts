import type { ContentCopilotValue } from "@/lib/ai/content-copilot";
import { validateArticleBody } from "@/lib/blog/content";
import type { ArticleInput, ValidatedArticleBody } from "@/lib/blog/types";
import { convertLiteralBody } from "./blog-editor-state";

// Keep the existing provider's persisted scalar content contract, including rich JSON.
// Never flatten the editor document for comparison or undo.
export function articleCopilotValues(value: ArticleInput): Record<string, ContentCopilotValue> {
  return {
    title: value.title,
    excerpt: value.excerpt,
    content:
      value.body.format === "legacy-text" ? value.body.text : JSON.stringify(value.body.document),
    seo_title: value.seoTitle,
    seo_description: value.seoDescription,
  };
}

export function articleCopilotBody(
  format: ValidatedArticleBody["format"],
  text: string,
): ValidatedArticleBody {
  if (format === "legacy-text") return validateArticleBody({ format, text });
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    /* Plain suggestions remain literal text. */
  }
  if (document && typeof document === "object" && "type" in document && document.type === "doc") {
    return validateArticleBody({ format, document });
  }
  return validateArticleBody(convertLiteralBody(text));
}

export function applyArticleCopilotPatch<T extends ArticleInput>(
  current: T,
  patch: Record<string, ContentCopilotValue>,
): T {
  const next = { ...current };
  for (const [field, key] of Object.entries({
    title: "title",
    excerpt: "excerpt",
    seo_title: "seoTitle",
    seo_description: "seoDescription",
  } as const)) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (typeof value !== "string" && value !== null) throw new Error("Invalid suggestion");
    if (key === "title") {
      if (value === null) throw new Error("Missing title");
      next.title = value;
    } else next[key] = value;
  }
  if ("content" in patch && patch.content !== articleCopilotValues(current).content) {
    if (typeof patch.content !== "string") throw new Error("Invalid content suggestion");
    next.body = articleCopilotBody(current.body.format, patch.content);
  }
  return next;
}
