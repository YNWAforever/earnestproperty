import { createFileRoute } from "@tanstack/react-router";

import { MortgageCalculator } from "@/components/site/MortgageCalculator";
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
    ],
  }),
  component: MortgageRoute,
});

function MortgageRoute() {
  const search = Route.useSearch();

  return <MortgageCalculator key={JSON.stringify(search)} initialSearch={search} />;
}
