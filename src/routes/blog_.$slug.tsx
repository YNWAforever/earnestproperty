import { getPublicBlogArticle } from "@/lib/neon/blog-public";
import { blogNoStoreHeaders } from "@/lib/blog/public";
import { ArticleBody } from "@/components/blog/ArticleBody";
import { articleHeadings } from "@/lib/blog/headings";
import { BlogUnavailable, BlogNotFound } from "@/components/blog/BlogUnavailable";
import { AppImage } from "@/components/media/AppImage";
import type { ValidatedArticleBody } from "@/lib/blog/types";
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
import { estateRegistry } from "@/content/estate-registry";
import { SITE_URL, authored, canonicalLink } from "@/content/seo";
import {
  DESCRIPTION_MAX_UNITS,
  TITLE_MAX_UNITS,
  displayWidth,
  truncateToWidth,
} from "@/content/seo-budget.js";
import { absoluteUrl, articleSchema } from "@/lib/schema";
import { fetchEstateBySlug } from "@/lib/queries";
import { jsonLdScript } from "@/lib/schema";
import { buildContext, useTrackPageView } from "@/lib/analytics/events";
import { blogCorridorLinks } from "@/lib/corridor-links";

type ArticleDetail = {
  slug: string;
  title: string;
  excerpt: string | null;
  body: ValidatedArticleBody;
  coverAlt: string | null;
  cover_image: string | null;
  category: string | null;
  /** Stable category key for links; `category` is the (renameable) display name. */
  categoryKey: string | null;
  reading_minutes: number | null;
  /** Hand-written per-article SEO copy from the admin CMS. Collected since
   * 20260623090000 and never selected until now, so every authored value was
   * discarded; head() prefers them over the derived pair. */
  seo_title?: string | null;
  seo_description?: string | null;
  published_at: string | null;
  updated_at?: string | null;
  author: string;
  reviewer: string | null;
  sourcesNote: string;
  answerSummary: string;
  links?: readonly { href: string; label: string }[];
};

async function resolveCompareEstates(
  slugs: readonly string[] | undefined,
): Promise<EstateComparisonRow[]> {
  if (!slugs || slugs.length === 0) return [];
  return Promise.all(
    slugs.map(async (slug) => {
      const record = await fetchEstateBySlug(slug);
      // Editable references may be DB-only or no longer published. The public
      // record owns names/page availability; registry labels are optional context.
      const entry = estateRegistry.find((candidate) => candidate.slug === slug);
      return {
        slug: record?.slug ?? slug,
        nameZh: record?.name_zh ?? entry?.nameZh ?? slug,
        hasPage: record !== null,
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
    const record = await getPublicBlogArticle(params.slug);
    if (!record) throw notFound();
    const article: ArticleDetail = {
      slug: record.slug,
      title: record.title,
      excerpt: record.excerpt,
      body: record.body,
      cover_image: record.coverImage,
      coverAlt: record.coverAlt,
      category: record.categoryName ?? record.category,
      categoryKey: record.category,
      reading_minutes: record.readingMinutes,
      seo_title: record.seoTitle,
      seo_description: record.seoDescription,
      published_at: record.publishedAt,
      updated_at: record.updatedAt,
      author: record.editorial.author ?? "晉誠地產編輯團隊",
      reviewer: record.editorial.reviewer,
      sourcesNote: record.editorial.sourcesNote ?? "",
      answerSummary: record.editorial.answerSummary ?? "",
      links: record.links,
    };
    const compareEstates = await resolveCompareEstates(record.editorial.compareEstateSlugs);

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
  headers: blogNoStoreHeaders,
  staleTime: 0,
  gcTime: 0,
  preload: false,
  shouldReload: true,
  errorComponent: BlogUnavailable,
  notFoundComponent: BlogNotFound,
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
        <Link
          to="/blog"
          activeOptions={{ exact: true }}
          className="mt-4 inline-block text-sm font-semibold text-primary"
        >
          返回 Blog
        </Link>
      </div>
    );
  }

  const url = `${SITE_URL}/blog/${article.slug}`;
  // A post belongs to its category, not to the blog root: a 晉誠成交 story must read as
  // 晉誠成交 in the trail and in the BreadcrumbList, never as the generic 市場分析.
  const categoryKey = article.categoryKey?.trim() || null;
  const categoryLabel = article.category?.trim() || categoryKey || "市場分析";
  const categoryHref = categoryKey ? `/blog?category=${encodeURIComponent(categoryKey)}` : "/blog";
  const relatedLinks = [
    ...(article.links ?? []),
    ...blogCorridorLinks(
      compareEstates.map((estate) => estate.slug),
      article.links,
    ),
  ];
  const headings = articleHeadings(article.body);
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
          {
            "@type": "ListItem",
            position: 2,
            name: categoryLabel,
            item: `${SITE_URL}${categoryHref}`,
          },
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
              { label: categoryLabel, href: categoryHref },
              { label: article.title },
            ]}
          />
        }
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-3">
            {article.category && (
              <span className="rounded-full bg-secondary px-3 py-1 font-medium text-secondary-foreground">
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

          {headings.length >= 2 && (
            <nav aria-label="目錄" className="mt-8 rounded-md border bg-muted/30 p-4">
              <h2 className="text-sm font-semibold">目錄</h2>
              <ol className="mt-2 space-y-1 text-sm">
                {headings.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="text-primary hover:underline">
                      {section.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {article.cover_image && (
            <AppImage
              src={article.cover_image}
              alt={article.coverAlt ?? article.title}
              width={1000}
              height={600}
              className="mt-8 rounded-lg"
            />
          )}
          <div className="prose prose-neutral mt-8 max-w-none">
            <ArticleBody body={article.body} links={relatedLinks} />
          </div>

          {compareEstates.length > 0 && <BlogEstateComparisonTable estates={compareEstates} />}
        </article>
      </Container>
    </div>
  );
}
