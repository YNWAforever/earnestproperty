import { createFileRoute, Link } from "@tanstack/react-router";

import { canonicalLink, pageSeo } from "@/content/seo";

// `blog_` (not `blog`) opts this route out of nesting under /blog, matching
// blog_.$slug.tsx -- blog.tsx is a full page, not a layout (no <Outlet/>), so
// a route nested under it would resolve its loader/head while never mounting
// its component. Same fix, same reason, see blog_.$slug.tsx's own comment.
export const Route = createFileRoute("/blog_/editorial-standards")({
  head: () => ({
    meta: [
      { title: pageSeo.blogEditorialStandards.title },
      { name: "description", content: pageSeo.blogEditorialStandards.description },
    ],
    links: [canonicalLink(pageSeo.blogEditorialStandards.path)],
  }),
  component: EditorialStandardsPage,
});

function EditorialStandardsPage() {
  return (
    <main className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">Blog</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">編採及事實查核標準</h1>
          <p className="mt-4 text-muted-foreground">
            本頁說明晉誠地產 Blog
            文章的資料來源、審閱制度，以及邊啲內容係已核實嘅事實、邊啲係我哋嘅分析意見。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="prose prose-neutral max-w-none space-y-6">
          <div>
            <h2 className="text-xl font-semibold">資料來源</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              文章內提及嘅屋苑資料（平均實呎、單位數、落成年份、發展商）實時來自本網站嘅屋苑資料庫，同
              /estate/[屋苑] 頁面及 /transactions
              頁面顯示嘅資料同一個來源，唔會喺文章入面另外打字輸入， 所以唔會過時或者打錯。
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">校網資料</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              文章目前只會列出教育局校網編號（例如「62
              校網」），唔會列出具體學校名單——因為我哋暫時未有官方教育局來源核實實際派位學校。實際派位及校網安排請以教育局最新公布為準。
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">作者同審閱</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              每篇文章都會標明作者（一般為「晉誠地產編輯團隊」）。如果有實際具名人士審閱過某篇文章，我哋會喺文章顯示審閱者名稱；未有具名審閱嘅文章唔會顯示審閱者——我哋唔會假裝有人審閱過。
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">分析意見 vs. 已核實事實</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              文章入面冇註明來源嘅內容（例如「邊個屋苑啱邊種買家」呢類建議），屬於我哋編輯團隊嘅個人分析同意見，唔係已核實嘅客觀事實，亦唔構成投資、法律或財務建議。
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            一般網站免責事項請參閱
            <Link to="/disclaimer" className="ml-1 text-primary underline">
              免責聲明
            </Link>
            。
          </p>
        </div>
      </section>
    </main>
  );
}
