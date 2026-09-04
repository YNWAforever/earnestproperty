import { createFileRoute, Link } from "@tanstack/react-router";

import { SITE_CONTACT } from "@/config/site";
import { Container } from "@/components/layout/Container";
import { PageHero } from "@/components/site/PageHero";
import { canonicalLink, pageSeo } from "@/content/seo";

// TODO(client/legal): reasonable template copy -- not a substitute for legal
// review before this is relied on as final terms of use.
export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: pageSeo.terms.title },
      { name: "description", content: pageSeo.terms.description },
    ],
    links: [canonicalLink(pageSeo.terms.path)],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="bg-background">
      <PageHero eyebrow="法律 Legal" title="使用條款">
        <p className="mt-2 text-xs text-muted-foreground">
          {"生效日期：[待補]　・　最後更新日期：[待補]"}
        </p>
      </PageHero>

      <Container className="py-12">
        <div className="prose prose-neutral max-w-3xl space-y-8">
          <p className="leading-7 text-muted-foreground">
            {`歡迎瀏覽晉誠地產 Earnest Property（牌照號 ${SITE_CONTACT.licenceNo}）網站。使用本網站即表示你同意以下條款。`}
          </p>

          <div>
            <h2 className="text-xl font-semibold">網站用途</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "本網站提供的內容（樓盤搜尋、屋苑資料、按揭計算機、市場分析等）僅供一般參考及查詢用途。詳見"
              }
              <Link to="/disclaimer" className="text-primary underline underline-offset-2">
                免責聲明
              </Link>
              {"。"}
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">個人資料</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {"我們如何收集及使用你透過查詢表格或 WhatsApp 提供的個人資料，詳見"}
              <Link to="/privacy" className="text-primary underline underline-offset-2">
                私隱政策
              </Link>
              {"。"}
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">知識產權</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "本網站的內容、設計及商標（包括「晉誠地產」及相關標誌）為本公司或其授權方所擁有，未經書面同意不得轉載或作商業用途。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">條款修訂</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              本公司可能因應法例或業務需要修訂本條款，最新版本將於本頁發佈。
            </p>
          </div>
        </div>
      </Container>
    </div>
  );
}
