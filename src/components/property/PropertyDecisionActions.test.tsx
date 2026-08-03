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

  test("WhatsApp CTA is a real wa.me link with the 852 country code and price context", () => {
    const $ = renderActions(8_880_000);
    // fallbackWhatsapp "85291234567" already carries the 852 country code;
    // the link must not double it up, and must not drop it either (the old
    // component built this by stripping non-digits with no country-code
    // normalization at all, so an 8-digit agent number produced a broken
    // wa.me/91234567 link).
    const desktopLink = $('[data-listing-no="B059390"] a[href^="https://wa.me/85291234567"]');
    const mobileLink = $('[data-property-mobile-actions] a[href^="https://wa.me/85291234567"]');
    expect(desktopLink).toHaveLength(1);
    expect(mobileLink).toHaveLength(1);

    const decoded = decodeURIComponent(mobileLink.attr("href") ?? "");
    // title_zh-style strings already bake in the deal label and listing
    // number (e.g. "測試售盤"), so the prefill must not repeat "編號 B059390".
    expect(decoded).toContain("測試售盤");
    expect(decoded).toContain("$8,880,000");
    expect(decoded).not.toContain("編號");
    expect(mobileLink.attr("target")).toBe("_blank");
  });

  test("falls back to /contact without opening a new tab when no WhatsApp number resolves", () => {
    const $ = load(
      renderToStaticMarkup(
        createElement(PropertyDecisionActions, {
          agent: null,
          branchContact: SITE_BRANCHES[0],
          fallbackWhatsapp: "",
          listingNo: "B059390",
          title: "測試售盤",
          dealType: "sale",
          price: null,
          onInquiry: () => undefined,
        }),
      ),
    );
    const mobileLink = $('[data-property-mobile-actions] a[href="/contact"]');
    expect(mobileLink).toHaveLength(1);
    expect(mobileLink.attr("target")).toBeUndefined();
  });
});
