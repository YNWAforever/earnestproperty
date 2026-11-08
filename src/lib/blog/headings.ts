import { validateArticleBody } from "./content";
import type { ArticleBody, EditorNode, ValidatedArticleBody } from "./types";

const text = (node: EditorNode): string =>
  node.type === "text"
    ? node.text
    : "content" in node
      ? (node.content ?? []).map(text).join("")
      : "";

/** Keep the existing article fragment policy: ASCII heading slug plus section index. */
export function articleHeadingEntries(body: ValidatedArticleBody) {
  const headings: Array<{ id: string; text: string; node: EditorNode }> = [];
  if (body.format === "legacy-text") return headings;
  const visit = (node: EditorNode) => {
    if (node.type === "heading") {
      const label = text(node);
      const ascii = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "");
      headings.push({ id: `${ascii || "section"}-${headings.length}`, text: label, node });
    }
    if ("content" in node) node.content?.forEach(visit);
  };
  body.document.content.forEach(visit);
  return headings;
}
export function articleHeadings(body: ArticleBody): Array<{ id: string; text: string }> {
  return articleHeadingEntries(validateArticleBody(body)).map(({ id, text }) => ({ id, text }));
}
