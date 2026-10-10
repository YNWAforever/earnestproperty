/**
 * FX-16 F-07: the single source of truth for "a mobile action bar is on this page".
 *
 * Each bottom bar (StickyWhatsAppBar, and the property bar in PropertyDecisionActions)
 * spreads `mobileActionBarAttribute`. Every docking and reservation style is a `max-lg:`
 * variant keyed on `html:has([data-mobile-action-bar])`. So below lg, the 問樓助手 launcher
 * docks into the bar's right slot and the page reserves the bar's height exactly when a bar
 * is in the DOM, including server-rendered HTML, so nothing shifts on hydration.
 *
 * Pages without a bar keep main's labelled pill and no padding. That covers a sold or rented
 * listing, a listing that is not found or failed to load, and /dashboard.
 *
 * Tailwind only sees literal class strings, so the variant is spelled out in full in each
 * class below and in `live-agent-trigger.ts`.
 */
export const MOBILE_ACTION_BAR_SELECTOR = "[data-mobile-action-bar]";

export const mobileActionBarAttribute = { "data-mobile-action-bar": "" } as const;

/** 61 px = 1 px border + 8 px + 44 px control + 8 px, plus the safe-area inset. */
export const MOBILE_ACTION_BAR_RESERVE_CLASS =
  "max-lg:[html:has([data-mobile-action-bar])_&]:pb-[calc(3.8125rem+env(safe-area-inset-bottom))]";
