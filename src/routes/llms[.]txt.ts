import { createFileRoute } from "@tanstack/react-router";

import { SITE_URL, estateSeo } from "@/content/seo";
import { fetchSitemapTimestamps } from "@/lib/neon/public-data.server";
import { fetchRecentTransactions } from "@/lib/queries";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async () => {
        let degraded = false;
        // Match the sitemap's live publication and data-exists gates. A failed
        // read omits those URLs and must not cache the incomplete result.
        const [timestamps, transactions] = await Promise.all([
          fetchSitemapTimestamps().catch(() => {
            degraded = true;
            return { estates: {}, articles: {} };
          }),
          fetchRecentTransactions({ limit: 1 }).catch(() => {
            degraded = true;
            return [];
          }),
        ]);
        const link = (label: string, path: string) => `- [${label}](${SITE_URL}${path})`;
        const body = [
          "# 晉誠地產 Earnest Property",
          "",
          "> 持牌地產代理 Licensed estate agency · C-018613。深井 Sham Tseng、青山公路 Castle Peak Road、汀九 Ting Kau、青龍頭 Tsing Lung Tau 買樓租樓指南。",
          "",
          "## 地區與放盤 Areas and listings",
          link("首頁 Home", "/"),
          link("青山公路置業指南 Castle Peak Road guide", "/castle-peak-road"),
          link("油柑頭／汀九 Yau Kom Tau / Ting Kau", "/castle-peak-road/ting-kau"),
          link(
            "青山公路深井段／青龍頭 Sham Tseng corridor / Tsing Lung Tau",
            "/castle-peak-road/sham-tseng",
          ),
          link("深井地區攻略 Sham Tseng district", "/district/sham-tseng"),
          link("搜尋放盤 Property listings", "/listings"),
          ...(transactions.length > 0 ? [link("成交紀錄 Transactions", "/transactions")] : []),
          "",
          "## 文章與聯絡 Articles and contact",
          link("市場分析 Blog", "/blog"),
          link("屋苑開箱 Estate reviews", "/estate-reviews"),
          link("代理團隊 Agents", "/agents"),
          link("聯絡我們 Contact", "/contact"),
          "",
          "## 已公開屋苑 Published estates",
          ...Object.values(estateSeo)
            .filter((estate) => estate.slug in timestamps.estates)
            .map((estate) => link(`${estate.nameZh} ${estate.nameEn}`, `/estate/${estate.slug}`)),
          "",
        ].join("\n");

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": degraded ? "no-store" : "public, max-age=3600",
          },
        });
      },
    },
  },
});
