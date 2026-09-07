import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Clock } from "lucide-react";

import { Container } from "@/components/layout/Container";
import { DataNote } from "@/components/layout/DataNote";
import { AnswerSummaryCallout } from "@/components/site/AnswerSummaryCallout";
import {
  BlogEstateComparisonTable,
  type EstateComparisonRow,
} from "@/components/site/BlogEstateComparisonTable";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { PageHero } from "@/components/site/PageHero";
import { SiteLink } from "@/components/site/SiteLink";
import {
  articlePublishedAt,
  EDITORIAL_AUTHOR,
  publishedBlogArticles,
  type BlogArticleSection,
} from "@/content/blog-articles";
import { getEstateEntry } from "@/content/estate-registry";
import { SITE_URL, authored, canonicalLink } from "@/content/seo";
import {
  DESCRIPTION_MAX_UNITS,
  TITLE_MAX_UNITS,
  displayWidth,
  truncateToWidth,
} from "@/content/seo-budget.js";
import { absoluteUrl, articleSchema } from "@/lib/schema";
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
  /** Hand-written per-article SEO copy from the admin CMS. Collected since
   * 20260623090000 and never selected until now, so every authored value was
   * discarded; head() prefers them over the derived pair. */
  seo_title?: string | null;
  seo_description?: string | null;
  published_at: string;
  updated_at?: string | null;
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
  // publishedBlogArticles, not blogArticles: a scheduled 屋苑開箱 article must
  // be genuinely unreachable before its date, not merely absent from the
  // listings. The loader throws notFound() when this returns null, so its URL
  // 404s until it publishes -- which is also why the sitemap only lists the
  // published ones.
  return publishedBlogArticles().find((item) => item.slug === slug) ?? null;
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
          seo_title: dbArticle?.seo_title ?? null,
          seo_description: dbArticle?.seo_description ?? null,
          published_at: dbArticle?.published_at ?? articlePublishedAt(registryArticle),
          updated_at: dbArticle?.updated_at ?? null,
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
            seo_title: dbArticle.seo_title,
            seo_description: dbArticle.seo_description,
            published_at: dbArticle.published_at,
            updated_at: dbArticle.updated_at,
            author: EDITORIAL_AUTHOR,
            reviewer: null,
            sourcesNote: "",
            answerSummary: "",
          }
        : null;

    // An unknown slug used to render "文章不存在" with HTTP 200 and a
    // self-canonical -- an unbounded space of indexable soft-404s. Every
    // other dynamic route (estate, agent, segment, property) 404s here.
    if (!article) throw notFound();

    const compareEstates = await resolveCompareEstates(registryArticle?.compareEstateSlugs);

    return { article, compareEstates, slug: params.slug };
  },
  head: ({ loaderData }) => {
    const article = loaderData?.article;
    // The loader throws notFound() for an unknown slug, and this head still
    // renders over the 404 body. It used to emit a title and nothing else, so
    // a dead blog link unfurled with the homepage description and card, and
    // the URL stayed indexable.
    if (!article) {
      const title = `找不到這篇文章｜晉誠地產 Blog`;
      const description =
        "呢篇文章可能已移除或連結已更新。返回晉誠地產 Blog，睇深井、青山公路及汀九最新樓市分析、屋苑比較同買樓攻略。C-018613。";
      return {
        meta: [
          { title },
          { name: "description", content: description },
          { property: "og:title", content: title },
          { property: "og:description", content: description },
          { name: "twitter:title", content: title },
          { name: "twitter:description", content: description },
          { name: "robots", content: "noindex,follow" },
        ],
        links: [],
      };
    }
    // `晉誠地產 Earnest Property` is 27 display units against a 60-unit title
    // budget, so appending it pushed both live articles past the cap. Every
    // other page on the site uses the 10-unit 晉誠地產 suffix.
    const headline = authored(article.seo_title) ?? authored(article.title) ?? "深井樓市分析";
    const title =
      truncateToWidth(headline, TITLE_MAX_UNITS - displayWidth("｜晉誠地產")) + "｜晉誠地產";
    // Was `.slice(0, 155)` -- 155 CJK characters is ~310 display units, so it
    // enforced nothing and cut mid-clause when it did fire. An empty-string
    // excerpt also won the `??`, shipping an empty description meta.
    const description = truncateToWidth(
      authored(article.seo_description) ??
        authored(article.excerpt) ??
        "晉誠地產深井、青山公路及汀九樓市分析：屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。C-018613。",
      DESCRIPTION_MAX_UNITS,
    );
    const image = absoluteUrl(article.cover_image ?? "/og-cover.jpg");
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: image },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [canonicalLink(`/blog/${loaderData.slug}`)],
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
        ...articleSchema({
          url,
          headline: article.title,
          description: article.excerpt,
          image: article.cover_image,
          datePublished: article.published_at,
          dateModified: article.updated_at ?? article.published_at,
          authorName: article.author,
          articleSection: article.category,
        }),
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
      <PageHero
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "首頁", href: "/" },
              { label: "市場分析", href: "/blog" },
              { label: article.title },
            ]}
          />
        }
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-3">
            {article.category && (
              <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                {article.category}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {article.reading_minutes ?? 5} 分鐘閱讀
            </span>
          </span>
        }
        title={article.title}
        lead={article.excerpt}
      >
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>作者：{article.author}</span>
          {article.reviewer && <span>審閱：{article.reviewer}</span>}
          <Link to="/blog/editorial-standards" className="text-primary underline">
            編採標準
          </Link>
        </div>
        {article.sourcesNote && <DataNote source={article.sourcesNote} className="mt-3" />}
      </PageHero>

      <Container className="py-12">
        <article className="max-w-3xl">
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
                  <SiteLink
                    key={link.href}
                    href={link.href}
                    className="rounded-md border bg-background px-3 py-2 text-sm font-medium hover:border-primary hover:text-primary"
                  >
                    {link.label}
                  </SiteLink>
                ))}
              </div>
            </nav>
          )}
        </article>
      </Container>
    </div>
  );
}
