import { castlePeakRoadSegments } from "./castle-peak-road.ts";
import { estateRegistry } from "./estate-registry.ts";
import { earnestPublicTrust } from "./estate-pages.ts";
import { getSchoolNet, schoolNetCodeForDistrict } from "./school-nets.ts";

/**
 * The homepage's 青山公路屋苑買樓租樓 FAQ.
 *
 * ## Why this is static, and why it is not the corridor page's FAQ
 *
 * The homepage's other FAQ (深井買樓租樓) comes from the `faqs` table under
 * scope `district:sham-tseng`, seeded by 20260622060000_public_content.sql.
 * Nothing seeds a 青山公路 scope, so this ships as the floor and
 * `fetchFaqs("district:castle-peak-road")` overrides it the moment a real row
 * exists — the same CMS-wins-over-static shape /blog and /estate-reviews use.
 *
 * These are deliberately NOT copies of `castlePeakRoadHub.faqs`. Those three
 * ("適合邊類買家", "應先比較哪些地段", "放盤數量是否即時更新") are already
 * published and rendered on /castle-peak-road, and repeating them here would
 * put the same Q&A — and the same FAQPage entities — on two indexable pages.
 * These answer what a visitor who landed on the *homepage* asks instead, and
 * point at the corridor page for depth.
 *
 * Every fact is drawn from data already in this repo: the registry's estate
 * list and area labels, the segments' own transport copy, the school-net codes
 * from school-nets.ts, and estate-pages.ts's `earnestPublicTrust` block.
 * Nothing states a price, a developer, a year or a unit count.
 */

/** Areas, in the order the corridor runs from 荃灣 outward, with how many
 * estates in each have a detail page. Derived so it can never disagree with
 * the registry: an estate added or given a page changes this answer by
 * itself. */
function estateAreaSummary(): string {
  const order = ["深井", "青龍頭", "掃管笏", "青山灣", "小欖", "大欖"];
  const counts = new Map<string, string[]>();
  for (const entry of estateRegistry) {
    if (!entry.hasPage) continue;
    // "深井 / 青山公路" and "小欖／大欖" both appear; the first segment is the
    // estate's primary area.
    const area = (entry.locationLabelZh ?? "").split(/[／/]/)[0].trim();
    if (!area) continue;
    counts.set(area, [...(counts.get(area) ?? []), entry.nameZh]);
  }
  const parts = order
    .filter((area) => counts.has(area))
    .map((area) => `${area} ${counts.get(area)!.length} 個`);
  // Any area the hardcoded order misses still gets counted, so a new area
  // label cannot silently vanish from the answer.
  for (const [area, names] of counts) {
    if (!order.includes(area)) parts.push(`${area} ${names.length} 個`);
  }
  return parts.join("、");
}

function totalEstatePages(): number {
  return estateRegistry.filter((entry) => entry.hasPage).length;
}

/** The school nets the corridor's estates actually sit in, as "62 校網（荃灣）"
 * style labels grouped by the areas that use them. */
function schoolNetAnswer(): string {
  const byCode = new Map<string, Set<string>>();
  for (const entry of estateRegistry) {
    if (!entry.hasPage) continue;
    const code = schoolNetCodeForDistrict(entry.districtSlug);
    if (!code) continue;
    const area = (entry.locationLabelZh ?? "").split(/[／/]/)[0].trim();
    if (!area) continue;
    byCode.set(code, (byCode.get(code) ?? new Set()).add(area));
  }
  const described = [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, areas]) => {
      const net = getSchoolNet(code);
      const label = net ? `${net.netCode} 校網（${net.districtLabel}）` : `${code} 校網`;
      return `${[...areas].join("、")}一帶屬 ${label}`;
    })
    .join("；");
  return (
    `${described}。` +
    "本網站唔會列出小學名單 —— 教育局《小一入學統一派位選校名冊》來源未確認，" +
    "寧願唔寫都好過寫錯；實際派位以教育局最新公布為準。"
  );
}

function transportAnswer(): string {
  const lines = castlePeakRoadSegments.map((segment) => segment.transport);
  return (
    `${[...new Set(lines)].join("")}` +
    "整條走廊都唔屬港鐵步行生活圈，所以自駕、車位同繁忙時間接駁時間，" +
    "係睇樓時要親身實測嘅重點。"
  );
}

export const castlePeakRoadHomeFaqs: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "青山公路沿線有邊啲屋苑可以睇？",
    answer:
      `本網站現時有 ${totalEstatePages()} 個屋苑設獨立屋苑專頁，分佈為${estateAreaSummary()}。` +
      "每個屋苑專頁都有現有放盤、成交紀錄同屋苑基本資料，可以直接比較。",
  },
  {
    question: "青山公路屋苑屬邊個校網？",
    answer: schoolNetAnswer(),
  },
  {
    question: "青山公路一帶交通方便嗎？",
    answer: transportAnswer(),
  },
  {
    question: "深井同青山公路係咪同一個地區？",
    answer:
      "深井係青山公路沿線其中一個生活圈，唔係同一個範圍。青山公路由汀九、油柑頭一直伸延到深井、" +
      "青龍頭，再去到掃管笏、青山灣、小欖同大欖；深井只係其中一段。" +
      "想睇深井本身，可以睇深井地區攻略；想沿住成條走廊比較，可以睇青山公路置業指南。",
  },
  {
    question: "喺青山公路買樓或租樓，比較時有咩要特別留意？",
    answer:
      "同一個屋苑內，期數、座向、樓層同景觀開揚度都會令呎價差得遠，所以唔好只睇屋苑平均數。" +
      "另外分層、複式同洋房係唔同產品，唔應該混合估值；低密度屋苑成交疏落，樣本少嘅時候，" +
      "睇近期成交清單會比睇平均呎價可靠。",
  },
  {
    question: "想約睇樓或者查詢盤源，可以點聯絡晉誠地產？",
    answer:
      `可以 WhatsApp 或致電 ${earnestPublicTrust.phoneDisplay}，亦歡迎親臨${earnestPublicTrust.address}。` +
      `${earnestPublicTrust.companyNameZh}為持牌地產代理，牌照號碼 ${earnestPublicTrust.licenceNo}，` +
      "買樓、租樓、放盤委託同免費估價都可以直接搵我哋跟進。",
  },
];
