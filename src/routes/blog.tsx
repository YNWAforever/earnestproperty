import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";

import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/layout/EmptyState";
import { AppImage } from "@/components/media/AppImage";
import { PageHero } from "@/components/site/PageHero";
import { Input } from "@/components/ui/input";
import {
  BLOG_CATEGORIES,
  articlePublishedAt,
  publishedBlogArticles,
  EDITORIAL_AUTHOR,
  type BlogCategory,
} from "@/content/blog-articles";
import { SITE_URL, canonicalLink, pageSeo } from "@/content/seo";
import { formatHkDate } from "@/lib/format";
import { fetchPublishedArticles, type ArticleSummary } from "@/lib/queries";
import { itemListSchema, jsonLdScript, organizationRef } from "@/lib/schema";

type BlogCard = ArticleSummary & {
  author?: string;
};

function fallbackArticles(): BlogCard[] {
  // Per request: 28 屋苑開箱 articles are scheduled for future dates, and each
  // one now carries its own date rather than the shared 2026-06-22 constant
  // this used to stamp on every card.
  return publishedBlogArticles().map((article) => ({
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    cover_image: null,
    category: article.category,
    reading_minutes: article.readingMinutes,
    published_at: articlePublishedAt(article),
    author: article.author,
  }));
}

// The flagship guide gets a "start here" link in the hero rather than being
// spliced into the lead sentence (「由「…」開始」 read as broken copy).
const primaryArticle = { slug: "sham-tseng-buying-guide-2026", title: "深井買樓全攻略 2026" };

const CATEGORY_FILTERS = ["全部", ...BLOG_CATEGORIES] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

/** Same shape as admin.cms.tsx's own private matchesSearch helper -- kept as
 * a local copy since that one isn't exported, but the logic is identical:
 * case-insensitive substring match across whichever fields the caller cares
 * about, "" always matches. */
function matchesSearch(query: string, fields: Array<string | null | undefined>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

// Category lives in the URL (?category=) so each category is a crawlable,
// shareable address rather than React state that no link can reach.
function parseBlogSearch(input: Record<string, unknown>): { category?: CategoryFilter } {
  const raw = typeof input.category === "string" ? input.category : undefined;
  const category =
    raw && (CATEGORY_FILTERS as readonly string[]).includes(raw) && raw !== "全部"
      ? (raw as CategoryFilter)
      : undefined;
  return category ? { category } : {};
}

/**
 * Title/description for a `?category=` view.
 *
 * The category URLs were built as "crawlable, shareable addresses", but head()
 * was a zero-argument function that never read the validated param, so all six
 * served the hub's title and description -- every shared category link
 * unfurled as the hub, and every browser tab read the same. The canonical
 * still collapses them onto the bare path, so this is about the tab and the
 * share card, not about indexing six near-duplicates.
 */
function blogCategorySeo(category: CategoryFilter | undefined) {
  if (!category) return { title: pageSeo.blog.title, description: pageSeo.blog.description };
  return {
    title: `深井 ${category}｜青山公路 汀九樓市文章｜晉誠地產`,
    description: `晉誠地產 Blog 嘅${category}文章：深井、青山公路及汀九屋苑比較、校網交通同成交走勢，由紮根深井嘅持牌代理團隊撰寫。`,
  };
}

export const Route = createFileRoute("/blog")({
  validateSearch: parseBlogSearch,
  // The category has to reach head(), which only receives loaderData. The
  // loader itself ignores it -- the article list is fetched whole and filtered
  // client-side, exactly as before.
  loaderDeps: ({ search }) => ({ category: search.category }),
  loader: async ({ deps }) => {
    const articles = await fetchPublishedArticles().catch(() => []);
    return {
      articles: articles.length ? articles : fallbackArticles(),
      category: deps.category,
    };
  },
  head: ({ loaderData }) => {
    const { title, description } = blogCategorySeo(loaderData?.category);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      // Bare path -- ?category= must not fork the canonical.
      links: [canonicalLink(pageSeo.blog.path)],
    };
  },
  component: BlogPage,
});

function BlogPage() {
  const { articles } = Route.useLoaderData() as { articles: BlogCard[] };
  const { category: categoryParam } = Route.useSearch();
  const selectedCategory: CategoryFilter = categoryParam ?? "全部";
  const [searchQuery, setSearchQuery] = useState("");
  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}${pageSeo.blog.path}`,
    url: `${SITE_URL}${pageSeo.blog.path}`,
    name: pageSeo.blog.title,
    description: pageSeo.blog.description,
    inLanguage: "zh-HK",
    publisher: organizationRef(),
    mainEntity: itemListSchema({
      items: articles.map((article) => ({
        url: `${SITE_URL}/blog/${article.slug}`,
        name: article.title,
        image: article.cover_image,
      })),
    }),
  };

  const filteredArticles = useMemo(
    () =>
      articles.filter(
        (article) =>
          (selectedCategory === "全部" || article.category === selectedCategory) &&
          matchesSearch(searchQuery, [article.title, article.excerpt, article.category]),
      ),
    [articles, selectedCategory, searchQuery],
  );

  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(blogJsonLd) }}
      />
      <PageHero
        eyebrow="市場分析 Blog"
        title="深井 青山公路 汀九樓市分析"
        lead="整理屋苑比較、交通校網、成交走勢同最新放盤觀察，幫你更快判斷深井、青山公路及汀九樓市。"
      >
        <Link
          to="/blog/$slug"
          params={{ slug: primaryArticle.slug }}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border bg-background px-4 text-sm font-semibold text-primary transition hover:border-primary"
        >
          新手先睇：{primaryArticle.title}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </PageHero>

      <Container className="py-12">
        <section>
          <div className="flex flex-wrap gap-2" role="group" aria-label="按分類篩選文章">
            {CATEGORY_FILTERS.map((category) => (
              <Link
                key={category}
                to="/blog"
                search={category === "全部" ? {} : { category }}
                aria-pressed={selectedCategory === category}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  selectedCategory === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {category}
              </Link>
            ))}
          </div>
          <Input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜尋文章標題或內容..."
            aria-label="搜尋文章"
            className="mt-4 max-w-sm"
          />
        </section>

        <section className="mt-8 grid gap-5">
          {filteredArticles.length === 0 && (
            <EmptyState title="未有符合條件的文章" description="請調整分類或搜尋字詞。" />
          )}
          {filteredArticles.map((article) => {
            const publishedDate = formatHkDate(article.published_at);
            return (
              <Link
                key={article.slug}
                to="/blog/$slug"
                params={{ slug: article.slug }}
                className="group rounded-lg border bg-card p-6 transition hover:-translate-y-0.5 hover:shadow-card"
              >
                {article.cover_image && (
                  <AppImage
                    src={article.cover_image}
                    alt={article.title}
                    width={800}
                    height={320}
                    className="mb-4 h-40 w-full rounded-md object-cover"
                  />
                )}
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
                <h2 className="mt-4 text-2xl font-semibold tracking-tight group-hover:text-primary">
                  {article.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{article.excerpt}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span>{article.author ?? EDITORIAL_AUTHOR}</span>
                  {publishedDate && <span>{publishedDate}</span>}
                </div>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  閱讀文章
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </section>

        <section className="mt-10">
          <p className="text-xs text-muted-foreground">
            文章資料來源及審閱制度請參閱
            <Link to="/blog/editorial-standards" className="ml-1 text-primary underline">
              編採及事實查核標準
            </Link>
            。
          </p>
        </section>
      </Container>
    </div>
  );
}
