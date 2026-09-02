import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Building2, MessageCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/layout/EmptyState";
import { AppImage } from "@/components/media/AppImage";
import { PageHero } from "@/components/site/PageHero";
import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { getEstateEntry } from "@/content/estate-registry";
import { canonicalLink } from "@/content/seo";
import {
  fetchEstateOptions,
  fetchPublishedArticlesByCategory,
  type ArticleSummary,
} from "@/lib/queries";

const DISTRICT_FILTERS = ["全部", "深井", "青山公路", "汀九"] as const;
type DistrictFilter = (typeof DISTRICT_FILTERS)[number];

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
  const [districtFilter, setDistrictFilter] = useState<DistrictFilter>("全部");

  // homepageDistrict is the registry's existing display grouping for the
  // homepage estate cards -- reused here rather than a new district map.
  // getEstateEntry() throws for a slug it doesn't recognise, but
  // fetchEstateOptions() only ever returns real published estates, and every
  // one of today's has a registry entry (asserted by
  // estate-registry.test.mjs's own "every hasPage:true entry has a matching
  // estateSeo" test), so a direct call here is safe, not a guess.
  const estatesWithDistrict = useMemo(
    () =>
      estates.map((estate) => ({
        ...estate,
        homepageDistrict: getEstateEntry(estate.slug).homepageDistrict,
      })),
    [estates],
  );
  const filteredEstates = useMemo(
    () =>
      districtFilter === "全部"
        ? estatesWithDistrict
        : estatesWithDistrict.filter((estate) => estate.homepageDistrict === districtFilter),
    [estatesWithDistrict, districtFilter],
  );

  return (
    <div className="bg-background">
      <PageHero
        eyebrow="屋苑開箱"
        title="深井 青山公路 汀九屋苑開箱"
        lead="先睇屋苑文章，再入屋苑頁比較放盤、成交、校網、交通和生活配套。"
      />

      <Container className="py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-coral">屋苑文章</p>
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
          <EmptyState
            className="mt-6"
            icon={BookOpen}
            title="暫未有屋苑開箱文章"
            description="文章未發佈前，可先由下方屋苑入口睇放盤與成交；想要現場開箱影片或睇樓路線，歡迎直接 WhatsApp。"
          />
        )}
      </Container>

      <section className="border-y bg-card">
        <Container className="py-12">
          <p className="text-sm font-semibold text-coral">屋苑專頁</p>
          <h2 className="mt-2 text-2xl font-bold text-primary">屋苑入口</h2>
          {estatesWithDistrict.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="按地區篩選屋苑">
              {DISTRICT_FILTERS.map((district) => (
                <button
                  key={district}
                  type="button"
                  aria-pressed={districtFilter === district}
                  onClick={() => setDistrictFilter(district)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    districtFilter === district
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {district}
                </button>
              ))}
            </div>
          )}
          {filteredEstates.length > 0 ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEstates.map((estate) => (
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
          ) : (
            // A district chip that matches nothing used to leave an empty
            // grid with no message. "全部" contributes no district word so the
            // no-estates-at-all case doesn't read as 「暫未有全部屋苑專頁」.
            <EmptyState
              className="mt-6 bg-background"
              title={`暫未有${districtFilter === "全部" ? "" : districtFilter}屋苑專頁`}
              description="試試其他地區，或直接 WhatsApp 查詢。"
            />
          )}
        </Container>
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
        <AppImage
          src={article.cover_image}
          alt={article.title}
          width={640}
          height={360}
          className="h-full w-full object-cover"
          fallback={<BookOpen className="h-8 w-8" />}
        />
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
