import { createFileRoute } from "@tanstack/react-router";

import { MortgageCalculator } from "@/components/site/MortgageCalculator";
import { SITE_URL, canonicalLink, pageSeo } from "@/content/seo";
import { jsonLdScript, organizationRef } from "@/lib/schema";
import { parseMortgageSearch } from "@/lib/mortgage";

export const Route = createFileRoute("/mortgage")({
  validateSearch: parseMortgageSearch,
  head: () => ({
    meta: [
      { title: pageSeo.mortgage.title },
      { name: "description", content: pageSeo.mortgage.description },
      // The og pair used to be a different, shorter string than the page
      // title, so the shared card lost the whole value proposition.
      { property: "og:title", content: pageSeo.mortgage.title },
      { property: "og:description", content: pageSeo.mortgage.description },
      { name: "twitter:title", content: pageSeo.mortgage.title },
      { name: "twitter:description", content: pageSeo.mortgage.description },
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
