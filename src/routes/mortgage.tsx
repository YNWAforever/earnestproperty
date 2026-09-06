import { createFileRoute } from "@tanstack/react-router";

import { MortgageCalculator } from "@/components/site/MortgageCalculator";
import { SITE_URL, canonicalLink } from "@/content/seo";
import { jsonLdScript, organizationRef } from "@/lib/schema";
import { parseMortgageSearch } from "@/lib/mortgage";

export const Route = createFileRoute("/mortgage")({
  validateSearch: parseMortgageSearch,
  head: () => ({
    meta: [
      { title: "香港按揭計算機｜每月供款、壓力測試與印花稅估算｜晉誠地產" },
      {
        name: "description",
        content: "香港住宅按揭計算機：估算首期、每月供款、壓力測試、債務供款比率及住宅印花稅。",
      },
      { property: "og:title", content: "香港按揭計算機｜晉誠地產" },
      {
        property: "og:description",
        content: "快速估算香港置業的首期、供款、壓力測試及住宅印花稅。",
      },
      { name: "twitter:title", content: "香港按揭計算機｜晉誠地產" },
      {
        name: "twitter:description",
        content: "快速估算香港置業的首期、供款、壓力測試及住宅印花稅。",
      },
    ],
    // Bare path -- ?price=X must not fork the canonical per query value.
    links: [canonicalLink("/mortgage")],
  }),
  component: MortgageRoute,
});

const mortgageJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${SITE_URL}/mortgage`,
  url: `${SITE_URL}/mortgage`,
  name: "香港按揭計算機",
  description: "估算首期、每月供款、壓力測試、債務供款比率及住宅印花稅。",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  inLanguage: "zh-HK",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: 0, priceCurrency: "HKD" },
  provider: organizationRef(),
};

function MortgageRoute() {
  const search = Route.useSearch();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(mortgageJsonLd) }}
      />
      <MortgageCalculator key={JSON.stringify(search)} initialSearch={search} />
    </>
  );
}
