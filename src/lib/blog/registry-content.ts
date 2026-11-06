import type { BlogArticleMeta } from "../../content/blog-articles";
import {
  validateArticleBody,
  validateEditorialMetadata,
  validateSupplementalLinks,
} from "./content";
import type { RegistryArticleContent } from "./types";

/** Pure candidate conversion; no import, publication decision, dates invented or source mutation. */
export function convertRegistryArticle(article: BlogArticleMeta): RegistryArticleContent {
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    categoryKey: article.category,
    readingMinutes: article.readingMinutes,
    publishedAt: article.publishedAt ?? null,
    body: validateArticleBody({
      format: "editor-json-v1",
      document: {
        type: "doc",
        content: article.sections.flatMap((section) => [
          {
            type: "heading",
            attrs: { level: 2 },
            ...(section.heading ? { content: [{ type: "text", text: section.heading }] } : {}),
          },
          ...section.paragraphs.map((text) => ({
            type: "paragraph",
            ...(text ? { content: [{ type: "text", text }] } : {}),
          })),
        ]),
      },
    }),
    links: validateSupplementalLinks(article.links),
    editorial: validateEditorialMetadata({
      author: article.author,
      reviewer: article.reviewer,
      sourcesNote: article.sourcesNote,
      answerSummary: article.answerSummary,
      compareEstateSlugs: [...(article.compareEstateSlugs ?? [])],
    }),
  };
}
