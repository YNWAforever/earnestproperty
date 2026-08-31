import { createFileRoute } from "@tanstack/react-router";

import { SITE_CONTACT } from "@/config/site";
import { canonicalLink, pageSeo } from "@/content/seo";

// TODO(client/legal): this is reasonable template copy reflecting what the
// site actually collects (lead/enquiry forms, the WhatsApp marketing consent
// checkbox on property.$listingNo, the AI live-agent widget) -- it is not a
// substitute for review by a Hong Kong PDPO-qualified advisor before this is
// relied on as the company's final privacy policy.
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: pageSeo.privacy.title },
      { name: "description", content: pageSeo.privacy.description },
    ],
    links: [canonicalLink(pageSeo.privacy.path)],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">法律 Legal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">私隱政策</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {"生效日期：[待補]　・　最後更新日期：[待補]"}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {`本政策說明晉誠地產（牌照號 ${SITE_CONTACT.licenceNo}）如何收集、使用及保護你的個人資料，符合香港《個人資料（私隱）條例》(PDPO) 的要求。`}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="prose prose-neutral max-w-none space-y-8">
          <div>
            <h2 className="text-xl font-semibold">1. 我們收集的資料</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "當你透過本網站的查詢表格、放盤估價表格或 WhatsApp 查詢按鈕聯絡我們時，我們會收集你主動提供的姓名、電話號碼、電郵地址及查詢內容。如你使用網站的 AI 問樓助手，對話內容會用於回覆你的查詢及改善服務質素。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">2. 資料用途</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "你的資料只會用於：(a) 回覆你的查詢及安排睇樓、估價或其他你要求的服務；(b) 在你同意的情況下，透過 WhatsApp 傳送相關樓盤資訊及推廣訊息（見查詢表格上的同意選項）；以及 (c) 內部記錄及跟進。我們不會將你的個人資料出售予第三方。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">3. WhatsApp 推廣訊息</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "只有在你於查詢表格上明確剔選同意後，我們才會透過 WhatsApp 向你發送樓盤資訊及推廣訊息。你可以隨時透過回覆「STOP」或直接聯絡我們要求停止接收。"
              }
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">4. 查閱及更正個人資料</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {
                "根據《個人資料（私隱）條例》，你有權查閱及要求更正我們持有關於你的個人資料。如有查詢，請透過本網站的"
              }
              <a href="/contact" className="text-primary underline underline-offset-2">
                聯絡我們
              </a>
              {"頁面或直接聯絡我們任何一間分行。"}
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">5. 資料保安</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              我們採取合理的技術及行政措施保障你的個人資料，防止未經授權的查閱、更改或披露。
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold">6. 政策更新</h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              本政策可能因應法例或業務需要而更新，最新版本將於本頁發佈。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
