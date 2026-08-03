import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Clock } from "lucide-react";

import { SITE_NAME, SITE_URL, blogArticles, canonicalLink } from "@/content/seo";
import { fetchArticleBySlug } from "@/lib/queries";

type ArticleDetail = {
  slug: string;
  title: string;
  excerpt: string | null;
  content: string | readonly string[] | null;
  cover_image: string | null;
  category: string | null;
  reading_minutes: number | null;
  published_at: string;
  links?: readonly { href: string; label: string }[];
};

function fallbackArticle(slug: string): ArticleDetail | null {
  const article = blogArticles.find((item) => item.slug === slug);
  if (!article) return null;

  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    cover_image: null,
    category: article.category,
    reading_minutes: article.readingMinutes,
    published_at: "2026-06-22T00:00:00.000Z",
    links: article.links,
  };
}

function paragraphsFor(content: ArticleDetail["content"]) {
  if (Array.isArray(content)) return [...content];
  return String(content ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
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
    return {
      article: dbArticle ? { ...registryArticle, ...dbArticle } : registryArticle,
      slug: params.slug,
    };
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
  const { article } = Route.useLoaderData() as { article: ArticleDetail | null };

  if (!article) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">文章不存在</h1>
        <Link to="/blog" className="mt-4 inline-block text-sm font-semibold text-primary">
          返回 Blog
        </Link>
      </main>
    );
  }

  const url = `${SITE_URL}/blog/${article.slug}`;
  const paragraphs = paragraphsFor(article.content);
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
    <main className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
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
        </header>

        <div className="prose prose-neutral mt-8 max-w-none">
          {paragraphs.map((paragraph) => (
            <p key={paragraph} className="leading-8 text-foreground/85">
              {paragraph}
            </p>
          ))}
        </div>

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
    </main>
  );
}
