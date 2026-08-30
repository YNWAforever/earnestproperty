import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock } from "lucide-react";

import { blogArticles } from "@/content/blog-articles";
import { canonicalLink, pageSeo } from "@/content/seo";
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

  return (
    <main className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">深井 / 荃灣樓市分析</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">深井樓市 Blog</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            由「{primaryArticleTitle}
            」開始，整理屋苑比較、交通校網同最新放盤觀察，幫你更快判斷深井樓市。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-4 py-10 sm:px-6 lg:px-8">
        {articles.map((article) => (
          <Link
            key={article.slug}
            to="/blog/$slug"
            params={{ slug: article.slug }}
            className="group rounded-lg border bg-card p-6 transition hover:-translate-y-0.5 hover:shadow-card"
          >
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
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">
              閱讀文章
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
