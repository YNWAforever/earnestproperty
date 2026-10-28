import { ChevronDown } from "lucide-react";

import { Container } from "@/components/layout/Container";
import { SiteLink } from "@/components/site/SiteLink";

const guides = [
  {
    id: "estate-buying-guide",
    label: "買樓比較",
    title: "買樓時，點樣比較屋苑叫價同成交？",
    summary: "先統一比較條件，再計總開支，最後核實單位狀況同文件。",
    sections: [
      {
        heading: "先訂下自己的比較條件",
        text: "先列出預算、實用面積、房數、入住時間，以及對會所、車位同交通的需要。可以從碧堤半島、浪翠園或豪景花園等屋苑的介紹開始，再揀符合條件的實際單位比較；同一屋苑不同期數、座數同單位，條件都可能有分別。",
      },
      {
        heading: "分清叫價、成交同資料日期",
        text: "叫價是放盤目前的報價，並可能調整；過往成交則是在當時條件下達成的個案，兩者都不等於銀行估價或保證成交價。比較時盡量對照同屋苑、期數、座數、樓層、實用面積、景觀及是否連車位，並留意成交或登記日期和資料來源；樣本少時不宜只靠一宗判斷。",
      },
      {
        heading: "把一次性同持續開支一齊計",
        text: "比較呎價時先確認採用同一面積口徑；按實用面積計算，就是價格除以實用面積的平方呎數。準備首期和安排按揭時，可分開計算入住前現金需要及日後每月負擔，並考慮利息、手續費、稅費、律師費、代理佣金、管理費及可能的維修支出。佣金與付款時間應先與代理商議並確認，稅費和按揭條件則以最新資料及個人情況為準。",
      },
      {
        heading: "睇樓同簽約前再核實",
        text: "實地留意牆身水漬、窗戶、喉管和電掣，並查詢管理費、已知或擬議的維修及交樓包含的物品。簽署任何具約束力的文件前，應查核業權及登記負擔；有疑問可向律師或合適的專業人士查詢。",
      },
    ],
    links: [
      { href: "/transactions", label: "查看成交紀錄" },
      {
        href: "/blog/bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
        label: "比較三個屋苑",
      },
      {
        href: "https://www.gov.hk/tc/residents/housing/private/buying/buyingDomesticProperty.htm",
        label: "香港政府：購買住宅物業",
      },
      {
        href: "https://www.landreg.gov.hk/tc/services/services_b_2.htm",
        label: "土地註冊處：查冊服務",
      },
    ],
  },
  {
    id: "estate-renting-guide",
    label: "租樓準備",
    title: "深井租樓，睇樓到簽約要留意甚麼？",
    summary: "除了月租，亦要問清費用分擔、單位使用限制及租約條款。",
    sections: [
      {
        heading: "先問清每月同入住前開支",
        text: "確認月租是否包括管理費、差餉及其他費用，並問清水電、網絡、停車及會所等支出由誰負責。入住前亦要計算按金、預繳租金和協議中的代理佣金；實際金額和付款時間以雙方約定為準。",
      },
      {
        heading: "按自己的生活方式睇單位",
        text: "量度傢俬能否放進房間，試用窗戶、水龍頭、電掣及冷氣，留意水漬和噪音。若有寵物、車位、搬屋時間或使用會所的需要，先向業主及管理處確認適用規則，不要只憑屋苑廣告判斷。",
      },
      {
        heading: "核實資料，再看清協議",
        text: "可查閱土地紀錄核實業主身份及物業是否有按揭；如有按揭，應了解承按人是否同意出租及有否附帶條件。簽署地產代理協議前，留意委託期、代理形式、佣金和付款時間，並保留簽署後的副本。",
      },
      {
        heading: "把交樓及租期安排寫清楚",
        text: "簽約前核對租期、起租日、按金、維修責任、提前終止或續租安排，以及隨屋傢俬電器。收樓時可雙方確認物品清單、設備狀況和錶數，留存相片與收據；條款有疑問時，先尋求法律意見。",
      },
    ],
    links: [
      { href: "/listings?deal=rent", label: "搜尋租盤" },
      {
        href: "https://www.gov.hk/tc/residents/housing/private/buying/rentingDomesticProperty.htm",
        label: "香港政府：承租住宅物業",
      },
      { href: "https://smart.eaa.org.hk/zh-HK/rent/3", label: "地監局：地產代理協議" },
    ],
  },
  {
    id: "estate-viewing-guide",
    label: "實地睇樓",
    title: "海景、交通同生活配套，點樣親身比較？",
    summary: "用同一條路線和同一組問題睇不同單位，才較容易比較。",
    sections: [
      {
        heading: "景觀要看實際單位",
        text: "同一屋苑的景觀會隨座數、樓層和方向而不同。可請代理確認放盤相片是否屬於該單位，再到現場看窗外遮擋、日照及開窗後的聲音；有機會的話在不同時段重看，不要只靠屋苑宣傳相片決定。",
      },
      {
        heading: "用日常出行時間試路線",
        text: "由單位門口量度步行到車站或上落客點的時間，再按自己平日上下班、接送或購物的時段實際走一次。記錄候車、轉乘及步行安排，並向營辦商核對最新路線和班次；不同人的目的地和時段，感受可以很不一樣。",
      },
      {
        heading: "比較共同條件，而不是單看名稱",
        text: "每次睇樓用同一張清單記下景觀、房間大小、管理費、車位及周邊配套。之後回到屋苑專頁查看現有放盤及資料日期，再向代理核實個別單位的供應、價格和實際情況。",
      },
    ],
    links: [
      { href: "/castle-peak-road", label: "青山公路置業指南" },
      {
        href: "/blog/bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
        label: "碧堤半島、浪翠園及豪景花園比較",
      },
      { href: "/listings", label: "搜尋現有放盤" },
    ],
  },
] as const;

export function EstateReviewGuides() {
  return (
    <section className="border-b bg-card" aria-labelledby="estate-review-guides-title">
      <Container className="py-10 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-coral">買樓、租樓同睇樓</p>
            <h2 id="estate-review-guides-title" className="mt-2 text-2xl font-bold text-primary">
              屋苑比較實用指南
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
              先按需要展開清單，再到屋苑文章及放盤比較個別單位。資料和安排可能改變，重要細節請在決定前核實。
            </p>
          </div>
          <a href="#review-articles" className="text-sm font-semibold text-primary underline">
            直接瀏覽屋苑文章 ↓
          </a>
        </div>

        <div className="mt-6 grid items-start gap-4 lg:grid-cols-3">
          {guides.map((guide) => (
            <details key={guide.id} id={guide.id} className="group rounded-lg border bg-background">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 text-left [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-coral">{guide.label}</span>
                  <span className="mt-2 block text-lg font-semibold text-primary">
                    {guide.title}
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                    {guide.summary}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="space-y-5 border-t p-5">
                {guide.sections.map((part) => (
                  <section key={part.heading}>
                    <h3 className="text-sm font-semibold text-foreground">{part.heading}</h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">{part.text}</p>
                  </section>
                ))}
                <nav aria-label={`${guide.label}延伸閱讀`} className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-foreground">延伸閱讀及參考資料</h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {guide.links.map((link) => (
                      <li key={link.href}>
                        <SiteLink href={link.href} className="text-primary underline">
                          {link.label}
                        </SiteLink>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
