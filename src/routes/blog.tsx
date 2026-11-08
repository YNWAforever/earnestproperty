import { useState } from "react";
import {
  createFileRoute,
  Link,
  notFound,
  stripSearchParams,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/layout/EmptyState";
import { AppImage } from "@/components/media/AppImage";
import { PageHero } from "@/components/site/PageHero";
import { Input } from "@/components/ui/input";
import { BlogUnavailable, BlogNotFound } from "@/components/blog/BlogUnavailable";
import { SITE_URL, canonicalLink, pageSeo, authored } from "@/content/seo";
import { formatHkDate } from "@/lib/format";
import { getPublicBlogPage } from "@/lib/neon/blog-public";
import { blogNoStoreHeaders, parseBlogSearch } from "@/lib/blog/public";
import type { ArticleSummary } from "@/lib/blog/types";
import { itemListSchema, jsonLdScript, organizationRef } from "@/lib/schema";

export const Route = createFileRoute("/blog")({
  validateSearch: (input: Record<string, unknown> & SearchSchemaInput) => parseBlogSearch(input),
  search: { middlewares: [stripSearchParams({ page: 1 })] },
  loaderDeps: ({ search }) => ({ category: search.category, page: search.page }),
  loader: async ({ deps }) => {
    const data = await getPublicBlogPage({ categoryKey: deps.category, page: deps.page });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData)
      return {
        meta: [
          { title: "找不到文章分類｜晉誠地產" },
          { name: "robots", content: "noindex,follow" },
        ],
        links: [],
      };
    const { settings } = loaderData;
    const title = authored(settings.seoTitle) ?? settings.heading;
    const description = authored(settings.seoDescription) ?? settings.introduction;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      // Preserve the existing canonical policy for category and pagination queries.
      links: [canonicalLink(pageSeo.blog.path)],
    };
  },
  headers: blogNoStoreHeaders,
  staleTime: 0,
  gcTime: 0,
  preload: false,
  shouldReload: true,
  errorComponent: BlogUnavailable,
  notFoundComponent: BlogNotFound,
  component: BlogPage,
});

function BlogPage() {
  const { settings, categories, featured, articles } = Route.useLoaderData();
  const { category, page } = Route.useSearch();
  const [searchQuery, setSearchQuery] = useState("");
  const nameFor = (id: string | null) => categories.find((c) => c.id === id)?.name;
  const matches = (a: ArticleSummary) =>
    [a.title, a.excerpt, nameFor(a.categoryId)].some((value) =>
      (value ?? "").toLowerCase().includes(searchQuery.trim().toLowerCase()),
    );
  const visibleFeatured = featured.filter(matches);
  const visibleRegular = articles.items.filter(matches);
  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    "@id": `${SITE_URL}/blog`,
    url: `${SITE_URL}/blog`,
    name: settings.heading,
    description: settings.introduction,
    inLanguage: "zh-HK",
    publisher: organizationRef(),
    mainEntity: itemListSchema({
      items: [...featured, ...articles.items].map((a) => ({
        url: `${SITE_URL}/blog/${a.slug}`,
        name: a.title,
        image: a.coverImage,
      })),
    }),
  };
  const card = (article: ArticleSummary) => (
    <Link
      key={article.id}
      to="/blog/$slug"
      params={{ slug: article.slug }}
      className="group rounded-lg border bg-card p-6 transition hover:-translate-y-0.5 hover:shadow-card"
    >
      {article.coverImage && (
        <AppImage
          src={article.coverImage}
          alt={article.coverAlt ?? article.title}
          width={800}
          height={320}
          className="mb-4 h-40 w-full rounded-md object-cover"
        />
      )}
      {nameFor(article.categoryId) && (
        <span className="text-sm text-muted-foreground">{nameFor(article.categoryId)}</span>
      )}
      <h2 className="mt-3 text-2xl font-semibold group-hover:text-primary">{article.title}</h2>
      <p className="mt-3 text-sm leading-7 text-muted-foreground">{article.excerpt}</p>
      <p className="mt-3 text-xs text-muted-foreground">
        {article.author ?? "晉誠地產編輯團隊"} · {article.readingMinutes ?? 5} 分鐘閱讀
      </p>
      {article.publishedAt && (
        <p className="mt-3 text-xs text-muted-foreground">{formatHkDate(article.publishedAt)}</p>
      )}
      <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">
        閱讀文章
        <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
  return (
    <div className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(blogJsonLd) }}
      />
      <PageHero eyebrow="市場分析 Blog" title={settings.heading} lead={settings.introduction} />
      <Container className="py-12">
        <div className="flex flex-wrap gap-2" role="group" aria-label="按分類篩選文章">
          {[{ key: undefined, name: "全部" }, ...categories].map((c) => (
            <Link
              key={c.key ?? "all"}
              to="/blog"
              search={{ category: c.key, page: 1 }}
              activeOptions={{ exact: true }}
              className={`rounded-full border px-3 py-1.5 text-sm ${category === c.key ? "border-primary bg-secondary" : "border-border"}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜尋本頁文章"
          aria-label="搜尋本頁文章"
          className="mt-4 max-w-sm"
        />
        {visibleFeatured.length > 0 && (
          <section aria-label="精選文章" className="mt-8 grid gap-5">
            {visibleFeatured.map(card)}
          </section>
        )}
        <section aria-label="文章" className="mt-8 grid gap-5">
          {visibleRegular.map(card)}
          {!visibleRegular.length && !visibleFeatured.length && (
            <EmptyState title="未有符合條件的文章" />
          )}
        </section>
        {articles.total > articles.pageSize && (
          <nav aria-label="文章分頁" className="mt-8 flex items-center gap-6">
            {page > 1 && (
              <Link to="/blog" search={{ category, page: page - 1 }}>
                上一頁
              </Link>
            )}
            <span>
              {page} / {Math.ceil(articles.total / articles.pageSize)}
            </span>
            {page * articles.pageSize < articles.total && (
              <Link to="/blog" search={{ category, page: page + 1 }}>
                下一頁
              </Link>
            )}
          </nav>
        )}
        <p className="mt-10 text-sm text-muted-foreground">
          文章資料來源及審閱制度請參閱{" "}
          <Link to="/blog/editorial-standards" className="text-primary underline">
            編採及事實查核標準
          </Link>
          。
        </p>
      </Container>
    </div>
  );
}
