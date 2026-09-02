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
  blogArticles,
  EDITORIAL_AUTHOR,
  type BlogCategory,
} from "@/content/blog-articles";
import { canonicalLink, pageSeo } from "@/content/seo";
import { formatHkDate } from "@/lib/format";
import { fetchPublishedArticles, type ArticleSummary } from "@/lib/queries";

type BlogCard = ArticleSummary & {
  author?: string;
};

const fallbackArticles: BlogCard[] = blogArticles.map((article) => ({
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt,
  cover_image: null,
  category: article.category,
  reading_minutes: article.readingMinutes,
  published_at: "2026-06-22T00:00:00.000Z",
  author: article.author,
}));

const primaryArticleTitle = "深井買樓全攻略 2026";

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

export const Route = createFileRoute("/blog")({
  loader: async () => {
    const articles = await fetchPublishedArticles().catch(() => []);
    return { articles: articles.length ? articles : fallbackArticles };
  },
  head: () => ({
    meta: [
      { title: pageSeo.blog.title },
      { name: "description", content: pageSeo.blog.description },
      { property: "og:title", content: pageSeo.blog.title },
      { property: "og:description", content: pageSeo.blog.description },
    ],
    links: [canonicalLink(pageSeo.blog.path)],
  }),
  component: BlogPage,
});

function BlogPage() {
  const { articles } = Route.useLoaderData() as { articles: BlogCard[] };
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("全部");
  const [searchQuery, setSearchQuery] = useState("");

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
      <PageHero
        eyebrow="深井 / 荃灣樓市分析"
        title="深井樓市 Blog"
        lead={`由「${primaryArticleTitle}」開始，整理屋苑比較、交通校網同最新放盤觀察，幫你更快判斷深井樓市。`}
      />

      <Container className="py-12">
        <section>
          <div className="flex flex-wrap gap-2" role="group" aria-label="按分類篩選文章">
            {CATEGORY_FILTERS.map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={selectedCategory === category}
                onClick={() => setSelectedCategory(category)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  selectedCategory === category
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {category}
              </button>
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
