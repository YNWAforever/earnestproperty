import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SITE_BRANCHES } from "@/config/site";
import { calculateMortgage } from "@/lib/mortgage";

import { PropertyDecisionActions } from "./PropertyDecisionActions";

function renderActions(price: number | null, dealType: "sale" | "rent" = "sale") {
  return load(
    renderToStaticMarkup(
      createElement(PropertyDecisionActions, {
        agent: null,
        branchContact: SITE_BRANCHES[0],
        fallbackWhatsapp: "85291234567",
        listingNo: "B059390",
        title: dealType === "rent" ? "測試租盤" : "測試售盤",
        dealType,
        price,
        onInquiry: () => undefined,
      }),
    ),
  );
}

// Mirrors the component's own private formatMoney (Math.round + zh-HK
// grouping) so the assertion checks the actual rendered digits, not just
// that some text appeared.
function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString("zh-HK")}`;
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

  test("cash-required-at-closing equals calculateMortgage's own deposit + stampDuty for a known price", () => {
    const $ = renderActions(8_880_000);
    const cashRequired = $("[data-property-cash-required]");
    const mortgage = calculateMortgage({ price: 8_880_000 });

    // Real regression on the arithmetic, not just "the section rendered":
    // this is deposit + stampDuty specifically, not price, not deposit alone,
    // and not some other combination.
    expect(cashRequired).toHaveLength(1);
    expect(cashRequired.text()).toContain(formatMoney(mortgage.deposit + mortgage.stampDuty));
    // Sanity check the fixture actually exercises two distinct, non-zero
    // components -- otherwise a bug that dropped stampDuty entirely could
    // still pass by coincidence.
    expect(mortgage.deposit).toBeGreaterThan(0);
    expect(mortgage.stampDuty).toBeGreaterThan(0);
    expect(cashRequired.text()).not.toContain(formatMoney(mortgage.deposit));
  });

  test("cash-required-at-closing is absent without a known price (nothing to sum yet)", () => {
    const $ = renderActions(null);
    expect($("[data-property-cash-required]")).toHaveLength(0);
  });

  test("agent branch label prefers a resolved branch_id over the free-text branch string", () => {
    const branches = [
      {
        id: "branch-uuid-1",
        slug: "rhine",
        name: "海韻分行",
        address: null,
        phone: null,
        whatsapp: null,
        photo: null,
      },
    ];
    const agent = {
      name_zh: "陳大文",
      name_en: null,
      phone: null,
      whatsapp: null,
      licence_no: null,
      avatar_url: null,
      branch: "麗都分行",
      branch_id: "branch-uuid-1",
    };

    const $ = load(
      renderToStaticMarkup(
        createElement(PropertyDecisionActions, {
          agent,
          branchContact: SITE_BRANCHES[0],
          branches,
          fallbackWhatsapp: "85291234567",
          listingNo: "B059390",
          title: "測試售盤",
          dealType: "sale",
          price: null,
          onInquiry: () => undefined,
        }),
      ),
    );

    expect($.text()).toContain("海韻分行");
    expect($.text()).not.toContain("麗都分行");
  });

  test("an agent with neither branch_id nor a free-text branch renders no branch label at all", () => {
    const agent = {
      name_zh: "陳大文",
      name_en: null,
      phone: null,
      whatsapp: null,
      licence_no: null,
      avatar_url: null,
      branch: null,
      branch_id: null,
    };

    const $ = load(
      renderToStaticMarkup(
        createElement(PropertyDecisionActions, {
          agent,
          branchContact: SITE_BRANCHES[0],
          branches: [],
          fallbackWhatsapp: "85291234567",
          listingNo: "B059390",
          title: "測試售盤",
          dealType: "sale",
          price: null,
          onInquiry: () => undefined,
        }),
      ),
    );

    // Neither of the configured branch names may appear anywhere on the
    // card -- a blank beats a confident wrong answer (CHANGELOG.md:79-87).
    expect($.text()).not.toContain("麗都分行");
    expect($.text()).not.toContain("海韻分行");
    expect($.text()).not.toContain("青山公路豪景分行");
  });

  test("cash-required-at-closing (and the whole mortgage teaser) never renders for a rent listing", () => {
    // Deposit/stamp duty are sale-transaction concepts; PropertyDecisionActions
    // already gates the entire mortgage card on decision.showMortgage, which
    // getPropertyDecision sets to !isRent -- this new line sits inside that
    // same existing gate rather than needing its own rent/sale branch.
    const $ = renderActions(8_880_000, "rent");
    expect($("[data-property-mortgage-card]")).toHaveLength(0);
    expect($("[data-property-cash-required]")).toHaveLength(0);
  });
});
