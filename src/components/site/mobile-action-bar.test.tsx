import { describe, expect, test } from "bun:test";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveAgentLauncher } from "@/components/live-agent/LiveAgentLauncher";
import { LIVE_AGENT_PILL_CLASS } from "@/components/live-agent/live-agent-trigger";
import { PropertyDecisionActions } from "@/components/property/PropertyDecisionActions";
import { SITE_BRANCHES } from "@/config/site";

import { MOBILE_ACTION_BAR_RESERVE_CLASS, MOBILE_ACTION_BAR_SELECTOR } from "./mobile-action-bar";
import { StickyWhatsAppBar } from "./StickyWhatsAppBar";

// FX-16 F-07: the launcher docks, and the page reserves the bar's height, only where a bar is
// in the DOM. These tests pin both halves of that rule: every bar carries the marker, and
// every docking or reservation class is gated on it (so a page without a bar is main's).
const DOCKED_VARIANT = "max-lg:[html:has([data-mobile-action-bar])_&]:";

const render = (node: ReturnType<typeof createElement>) => load(renderToStaticMarkup(node));

function propertyActions(dealType: "sale" | "rent") {
  return createElement(PropertyDecisionActions, {
    agent: null,
    branchContact: SITE_BRANCHES[0],
    fallbackWhatsapp: "85291234567",
    listingNo: "B059390",
    title: "測試盤",
    dealType,
    price: 8_880_000,
    onInquiry: () => undefined,
  });
}

describe("mobile action bar rule", () => {
  test("every mobile bar carries the marker exactly once", () => {
    expect(render(createElement(StickyWhatsAppBar))(MOBILE_ACTION_BAR_SELECTOR)).toHaveLength(1);
    for (const dealType of ["sale", "rent"] as const) {
      const $ = render(propertyActions(dealType));
      expect($(MOBILE_ACTION_BAR_SELECTOR)).toHaveLength(1);
      expect($(MOBILE_ACTION_BAR_SELECTOR).is("[data-property-mobile-actions]")).toBe(true);
    }
  });

  test("the launcher without a bar is main's pill: every extra class is gated on a bar", () => {
    const $ = render(createElement(LiveAgentLauncher));
    const button = $("button");
    expect(button.attr("aria-label")).toBe("問樓助手");
    expect(button.text()).toBe("問樓助手");
    const classes = (button.attr("class") ?? "").split(/\s+/);
    for (const pill of LIVE_AGENT_PILL_CLASS.split(" ")) expect(classes).toContain(pill);
    const docked = classes.filter((name) => name.startsWith(DOCKED_VARIANT));
    expect(docked.map((name) => name.slice(DOCKED_VARIANT.length)).sort()).toEqual(
      [
        "bottom-[calc(0.5rem+env(safe-area-inset-bottom))]",
        "p-0",
        "right-3",
        "rounded-md",
        "shadow-none",
        "w-11",
      ].sort(),
    );
    // The label and icon also change only beside a bar.
    expect(button.find("span").attr("class")).toBe(`${DOCKED_VARIANT}sr-only`);
    expect(button.find("svg").attr("class")).toContain(`mr-2 h-5 w-5 ${DOCKED_VARIANT}mr-0`);
  });

  test("the page reservation applies only beside a bar and below lg", () => {
    expect(MOBILE_ACTION_BAR_RESERVE_CLASS).toBe(
      `${DOCKED_VARIANT}pb-[calc(3.8125rem+env(safe-area-inset-bottom))]`,
    );
  });
});
