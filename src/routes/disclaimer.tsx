import { createFileRoute } from "@tanstack/react-router";

import { SITE_CONTACT } from "@/config/site";
import { canonicalLink, pageSeo } from "@/content/seo";

// TODO(client/legal): reasonable template copy expanding on the existing
// per-listing disclaimer (see property.$listingNo.tsx) into a site-wide page --
// not a substitute for legal review before this is relied on as final.
export const Route = createFileRoute("/disclaimer")({
  head: () => ({
    meta: [
      { title: pageSeo.disclaimer.title },
      { name: "description", content: pageSeo.disclaimer.description },
    ],
    links: [canonicalLink(pageSeo.disclaimer.path)],
  }),
  component: DisclaimerPage,
});

function DisclaimerPage() {
  return (
    <main className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">法律 Legal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">免責聲明</h1>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="prose prose-neutral max-w-none space-y-6">
          <p className="leading-7 text-muted-foreground">
            {`本網站（earnestproperty.vercel.app）由晉誠地產 Earnest Property（牌照號 ${SITE_CONTACT.licenceNo}）營運。以下聲明適用於本網站所有頁面，包括放盤資料、屋苑資訊、成交記錄、市場分析文章及按揭計算機。`}
          </p>

          <div>
            <h2 className="text-xl font-semibold">樓盤及屋苑資料</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "本網站所載樓盤資料（包括價格、面積、間隔、圖片、屋苑資料及成交記錄）只供參考，實際資料以業主提供、政府紀錄及現場視察為準。本公司不會就資料的準確性、完整性或時效性作出保證或負上任何責任。圖片可能經美化或編輯處理，買家或租客應在交易前親身核實所有資料。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">按揭計算機</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "按揭計算機提供的供款、壓力測試及印花稅估算純屬參考，並非正式貸款批核或財務建議。實際按揭條款、利率及批核結果以貸款機構最終決定為準。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">市場分析內容</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "網站內的市場分析、屋苑比較及 AI 問樓助手回覆僅代表一般市場觀察，不構成投資、法律或財務建議。任何置業決定應諮詢適當的專業意見。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">外部連結</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "本網站可能連結至第三方網站（如 YouTube、地圖服務）。我們不對該等網站的內容或私隱政策負責。"
              }
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
