import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Building2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { canonicalLink } from "@/content/seo";
import {
  fetchEstateOptions,
  fetchPublishedArticlesByCategory,
  type ArticleSummary,
} from "@/lib/queries";

export const Route = createFileRoute("/estate-reviews")({
  loader: async () => {
    const [articles, estates] = await Promise.all([
      fetchPublishedArticlesByCategory("屋苑開箱"),
      fetchEstateOptions(),
    ]);
    return { articles, estates };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "屋苑開箱｜深井 青山公路 汀九屋苑指南｜晉誠地產" },
      {
        name: "description",
        content:
          "屋苑開箱入口，集中深井、青山公路、汀九屋苑文章與屋苑頁，方便比較碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園等。",
      },
      // The page renders a graceful empty state rather than 404ing when no
      // 屋苑開箱 articles are published yet, but an indexed empty page is a
      // soft-404 risk. sitemap.xml also drops this path under the same
      // condition; both self-heal once an article publishes, no deploy needed.
      ...(!loaderData || loaderData.articles.length === 0
        ? [{ name: "robots", content: "noindex,follow" }]
        : []),
    ],
    links: [canonicalLink("/estate-reviews")],
  }),
  component: EstateReviewsPage,
});

function EstateReviewsPage() {
  const { articles, estates } = Route.useLoaderData();
  const inquiryUrl = whatsappUrl("你好，我想查詢深井／青山公路／汀九屋苑開箱及筍盤");

  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">屋苑開箱</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            深井 青山公路 汀九屋苑開箱
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            先睇屋苑文章，再入屋苑頁比較放盤、成交、校網、交通和生活配套。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-coral">Review Articles</p>
            <h2 className="mt-2 text-2xl font-bold text-primary">最新屋苑文章</h2>
          </div>
          <Button asChild variant="outline">
            <a href={inquiryUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              查詢屋苑筍盤
            </a>
          </Button>
        </div>

        {articles.length > 0 ? (
          <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <ArticleCard key={article.slug} article={article} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border bg-card p-6 text-center shadow-card">
            <BookOpen className="mx-auto h-8 w-8 text-coral" />
            <h3 className="mt-3 text-lg font-semibold text-primary">暫未有屋苑開箱文章</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
              文章未發佈前，可先由下方屋苑入口睇放盤與成交；想要現場開箱影片或睇樓路線，歡迎直接
              WhatsApp。
            </p>
          </div>
        )}
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">Estate Pages</p>
          <h2 className="mt-2 text-2xl font-bold text-primary">屋苑入口</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {estates.map((estate) => (
              <Link
                key={estate.slug}
                to="/estate/$slug"
                params={{ slug: estate.slug }}
                className="rounded-lg border bg-background p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-elegant"
              >
                <Building2 className="h-6 w-6 text-coral" />
                <h3 className="mt-4 text-lg font-semibold text-primary">{estate.name_zh}</h3>
                <p className="mt-2 text-sm text-muted-foreground">查看放盤、成交及屋苑資料</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: article.slug }}
      className="overflow-hidden rounded-lg border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-elegant"
    >
      <div className="flex aspect-video items-center justify-center bg-primary/10 text-primary">
        {article.cover_image ? (
          <img src={article.cover_image} alt="" className="h-full w-full object-cover" />
        ) : (
          <BookOpen className="h-8 w-8" />
        )}
      </div>
      <div className="p-5">
        <p className="text-xs font-semibold text-coral">{article.category ?? "屋苑開箱"}</p>
        <h3 className="mt-2 line-clamp-2 text-lg font-semibold text-primary">{article.title}</h3>
        {article.excerpt && (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
            {article.excerpt}
          </p>
        )}
      </div>
    </Link>
  );
}
