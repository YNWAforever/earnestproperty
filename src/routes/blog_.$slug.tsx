import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Clock } from "lucide-react";

import { DataNote } from "@/components/layout/DataNote";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import {
  BlogEstateComparisonTable,
  type EstateComparisonRow,
} from "@/components/site/BlogEstateComparisonTable";
import { blogArticles, EDITORIAL_AUTHOR, type BlogArticleSection } from "@/content/blog-articles";
import { getEstateEntry } from "@/content/estate-registry";
import { SITE_NAME, SITE_URL, canonicalLink } from "@/content/seo";
import { fetchArticleBySlug, fetchEstateBySlug } from "@/lib/queries";
import { jsonLdScript } from "@/lib/schema";
import { buildContext, useTrackPageView } from "@/lib/analytics/events";

type ArticleDetail = {
  slug: string;
  title: string;
  excerpt: string | null;
  sections: readonly BlogArticleSection[];
  cover_image: string | null;
  category: string | null;
  reading_minutes: number | null;
  published_at: string;
  author: string;
  reviewer: string | null;
  sourcesNote: string;
  answerSummary: string;
  links?: readonly { href: string; label: string }[];
};

/** A CMS-edited article only ever supplies a flat `content` string -- there is
 * no admin UI for authoring sections/ToC/answer-summary yet. Splitting it into
 * a single, heading-less section keeps the same body-rendering path working
 * for both sources, and the ToC (2+ sections) simply doesn't show for it. */
function sectionsFromDbContent(content: string | null): readonly BlogArticleSection[] | null {
  if (!content) return null;
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.length > 0 ? [{ heading: "", paragraphs }] : null;
}

function fallbackArticle(slug: string) {
  return blogArticles.find((item) => item.slug === slug) ?? null;
}

/** ToC anchor ids. Headings here are zh-HK prose with no ASCII content, so a
 * plain ASCII slugify always collapses to "" -- the index suffix is what
 * actually keeps ids unique and present, not the slugified text itself. */
function sectionAnchorId(heading: string, index: number): string {
  const ascii = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return ascii.length > 0 ? `${ascii}-${index}` : `section-${index}`;
}

async function resolveCompareEstates(
  slugs: readonly string[] | undefined,
): Promise<EstateComparisonRow[]> {
  if (!slugs || slugs.length === 0) return [];
  return Promise.all(
    slugs.map(async (slug) => {
      const entry = getEstateEntry(slug);
      const record = await fetchEstateBySlug(slug).catch(() => null);
      return {
        slug,
        nameZh: entry.nameZh,
        hasPage: entry.hasPage,
        avgPsf: record ? Number(record.avg_saleable_psf ?? 0) || null : null,
        totalUnits: record?.total_units ?? null,
        yearCompleted: record?.year_completed ?? null,
        developer: record?.developer ?? null,
        asOf: record?.verified_at ?? null,
      };
    }),
  );
}

// `blog_` (not `blog`) opts this route out of nesting under /blog. The list page
// in blog.tsx is a full page, not a layout -- it renders no <Outlet/> -- so as a
// child this route's loader and head() ran while its component never mounted:
// the article's title and meta resolved correctly and the visible body stayed
// stuck on the blog list. Same shape as agents.tsx + agents_.$slug.tsx. The
// public path is unchanged (/blog/$slug), so no redirect is needed.
export const Route = createFileRoute("/blog_/$slug")({
  loader: async ({ params }) => {
    const registryArticle = fallbackArticle(params.slug);
    const dbArticle = await fetchArticleBySlug(params.slug).catch(() => null);

    const article: ArticleDetail | null = registryArticle
      ? {
          slug: registryArticle.slug,
          title: dbArticle?.title || registryArticle.title,
          excerpt: dbArticle?.excerpt ?? registryArticle.excerpt,
          sections: sectionsFromDbContent(dbArticle?.content ?? null) ?? registryArticle.sections,
          cover_image: dbArticle?.cover_image ?? null,
          category: dbArticle?.category ?? registryArticle.category,
          reading_minutes: dbArticle?.reading_minutes ?? registryArticle.readingMinutes,
          published_at: dbArticle?.published_at ?? "2026-06-22T00:00:00.000Z",
          author: registryArticle.author,
          reviewer: registryArticle.reviewer,
          sourcesNote: registryArticle.sourcesNote,
          answerSummary: registryArticle.answerSummary,
          links: registryArticle.links,
        }
      : dbArticle
        ? {
            slug: dbArticle.slug,
            title: dbArticle.title,
            excerpt: dbArticle.excerpt,
            sections: sectionsFromDbContent(dbArticle.content) ?? [],
            cover_image: dbArticle.cover_image,
            category: dbArticle.category,
            reading_minutes: dbArticle.reading_minutes,
            published_at: dbArticle.published_at,
            author: EDITORIAL_AUTHOR,
            reviewer: null,
            sourcesNote: "",
            answerSummary: "",
          }
        : null;

    const compareEstates = await resolveCompareEstates(registryArticle?.compareEstateSlugs);

    return { article, compareEstates, slug: params.slug };
  },
  head: ({ loaderData }) => {
    const article = loaderData?.article;
    return {
      meta: [
        { title: article ? `${article.title}｜${SITE_NAME}` : `文章不存在｜${SITE_NAME}` },
        {
          name: "description",
          content: article?.excerpt ?? "深井 / 荃灣樓市分析文章。",
        },
      ],
      links: loaderData?.slug ? [canonicalLink(`/blog/${loaderData.slug}`)] : [],
    };
  },
  component: BlogArticlePage,
});

function BlogArticlePage() {
  const { article, compareEstates } = Route.useLoaderData() as {
    article: ArticleDetail | null;
    compareEstates: EstateComparisonRow[];
  };

  useTrackPageView(
    () =>
      article
        ? {
            event: { name: "article_view", payload: { articleSlug: article.slug } },
            context: buildContext(),
          }
        : null,
    [article?.slug],
  );

  if (!article) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">文章不存在</h1>
        <Link to="/blog" className="mt-4 inline-block text-sm font-semibold text-primary">
          返回 Blog
        </Link>
      </div>
    );
  }

  const url = `${SITE_URL}/blog/${article.slug}`;
  const sectionAnchors = article.sections.map((section, index) =>
    sectionAnchorId(section.heading, index),
  );
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: article.title,
        description: article.excerpt,
        datePublished: article.published_at,
        author: { "@type": "Organization", name: SITE_NAME },
        publisher: { "@type": "Organization", name: SITE_NAME },
        mainEntityOfPage: url,
        ...(article.reviewer
          ? { reviewedBy: { "@type": "Organization", name: article.reviewer } }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "首頁", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
          { "@type": "ListItem", position: 3, name: article.title, item: url },
        ],
      },
    ],
  };

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <Link
          to="/blog"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          返回 Blog
        </Link>

        <header className="mt-8 border-b pb-8">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {article.category && (
              <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                {article.category}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {article.reading_minutes ?? 5} 分鐘閱讀
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{article.title}</h1>
          {article.excerpt && (
            <p className="mt-4 text-lg leading-8 text-muted-foreground">{article.excerpt}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>作者：{article.author}</span>
            {article.reviewer && <span>審閱：{article.reviewer}</span>}
            <Link to="/blog/editorial-standards" className="text-primary underline">
              編採標準
            </Link>
          </div>
          {article.sourcesNote && <DataNote source={article.sourcesNote} className="mt-3" />}
        </header>

        <AnswerSummaryCallout summary={article.answerSummary} />

        {article.sections.length >= 2 && (
          <nav aria-label="目錄" className="mt-8 rounded-md border bg-muted/30 p-4">
            <h2 className="text-sm font-semibold">目錄</h2>
            <ol className="mt-2 space-y-1 text-sm">
              {article.sections.map((section, index) => (
                <li key={sectionAnchors[index]}>
                  <a href={`#${sectionAnchors[index]}`} className="text-primary hover:underline">
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="prose prose-neutral mt-8 max-w-none">
          {article.sections.map((section, index) => (
            <section key={sectionAnchors[index]} id={sectionAnchors[index]}>
              {section.heading && (
                <h2 className="text-xl font-bold text-foreground">{section.heading}</h2>
              )}
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className="leading-8 text-foreground/85">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        {compareEstates.length > 0 && <BlogEstateComparisonTable estates={compareEstates} />}

        {article.links && article.links.length > 0 && (
          <nav className="mt-10 rounded-lg border bg-muted/30 p-5">
            <h2 className="text-sm font-semibold">延伸閱讀</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {article.links.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="rounded-md border bg-background px-3 py-2 text-sm font-medium hover:border-primary hover:text-primary"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </article>
    </div>
  );
}
