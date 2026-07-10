import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SITE_BRANCHES } from "@/config/site";

import { PropertyDecisionActions } from "./PropertyDecisionActions";

function renderActions(price: number | null) {
  return load(
    renderToStaticMarkup(
      createElement(PropertyDecisionActions, {
        agent: null,
        branchContact: SITE_BRANCHES[0],
        fallbackWhatsapp: "85291234567",
        listingNo: "B059390",
        title: "測試售盤",
        dealType: "sale",
        price,
        onInquiry: () => undefined,
      }),
    ),
  );
}

describe("PropertyDecisionActions", () => {
  test("renders exactly three mobile sale actions and a generic mortgage CTA without price", () => {
    const $ = renderActions(null);
    const mobileActions = $("[data-property-mobile-actions]");
    const mortgageCard = $("[data-property-mortgage-card]");

    expect(mobileActions.find("a")).toHaveLength(3);
    expect(mobileActions.text()).toContain("計月供");
    expect(mobileActions.find('a[href="/mortgage"]')).toHaveLength(1);
    expect(mortgageCard).toHaveLength(1);
    expect(mortgageCard.find('a[href="/mortgage"]')).toHaveLength(1);
    expect(mortgageCard.text()).not.toContain("每月供款");
  });

  test("keeps the price deep-link and calculated preview when sale price is valid", () => {
    const $ = renderActions(8_880_000);
    const mortgageCard = $("[data-property-mortgage-card]");

    expect(mortgageCard.find('a[href="/mortgage?price=8880000"]')).toHaveLength(1);
    expect(mortgageCard.text()).toContain("每月供款");
    expect($("[data-property-mobile-actions] a")).toHaveLength(3);
  });
});
