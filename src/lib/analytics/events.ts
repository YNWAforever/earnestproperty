import { useEffect, useRef } from "react";

/**
 * Shared context every event carries. `route` is always the current pathname;
 * the entity slugs/ids and `utm` are populated only when relevant to the
 * firing event. No PII (names, phone numbers, emails, free-text) belongs here
 * or in any payload below -- only slugs, ids, booleans, and enums.
 */
export interface AnalyticsContext {
  route: string;
  districtSlug?: string;
  estateSlug?: string;
  listingNo?: string;
  agentSlug?: string;
  utm?: Record<string, string>;
}

const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

// Deliberately a third copy, not a shared export -- listings.tsx and
// OwnerValuationPanel.tsx each already carry this same 5-line function with a
// comment explaining that avoiding a shared UTM utility was a deliberate
// choice ("cross-feature coupling for five lines of logic"). Reversing that
// precedent for this module isn't warranted.
export function collectUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const utm: Record<string, string> = {};
  for (const key of UTM_PARAM_KEYS) {
    const value = params.get(key);
    if (value) utm[key] = value.slice(0, 200);
  }
  return utm;
}

export function buildContext(
  partial: Omit<AnalyticsContext, "route" | "utm"> = {},
): AnalyticsContext {
  const route = typeof window === "undefined" ? "" : window.location.pathname;
  const utm = collectUtmParams();
  return {
    route,
    ...partial,
    ...(Object.keys(utm).length > 0 ? { utm } : {}),
  };
}

export interface ListingSearchPayload {
  dealType: "all" | "sale" | "rent";
  districtSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  resultCount: number;
}

export interface ListingViewPayload {
  listingNo: string;
  dealType: "sale" | "rent";
}

export interface ListingSharePayload {
  listingNo: string;
}

export interface ListingWhatsappClickPayload {
  listingNo: string;
  dealType: "sale" | "rent";
}

export interface ZeroResultsNotifyPayload {
  dealType: "all" | "sale" | "rent";
  districtSlug?: string;
  source: string;
}

export interface EstateViewPayload {
  estateSlug: string;
  districtSlug?: string;
}

export interface DistrictViewPayload {
  districtSlug: string;
}

export interface TransactionSharePayload {
  transactionId: string;
}

export interface TransactionFilterPayload {
  dealType: "all" | "sale" | "rent";
  districtSlug?: string;
  month?: string;
  resultCount: number;
}

export interface AgentViewPayload {
  agentSlug: string;
}

export interface AgentWhatsappClickPayload {
  agentSlug: string;
}

export interface WhatsappCtaClickPayload {
  intent?: "buy" | "rent" | "valuation";
  source: string;
}

export interface ContactFormSubmitPayload {
  hasPhone: boolean;
}

export interface ValuationFormSubmitPayload {
  districtSlug?: string;
  estateSlug?: string;
}

export interface MortgageCalculatePayload {
  hasIncome: boolean;
}

export interface MortgageScenarioSavePayload {
  scenarioCount: number;
}

export interface ArticleViewPayload {
  articleSlug: string;
}

export interface VideoClickPayload {
  videoId: string;
  category?: string;
}

/**
 * The full 18-event taxonomy from the master plan's P7 analytics item. Each
 * member's `name` is a discriminant, so `track()` callers get payload
 * type-checking for free.
 */
export type AnalyticsEvent =
  | { name: "listing_search"; payload: ListingSearchPayload }
  | { name: "listing_view"; payload: ListingViewPayload }
  | { name: "listing_share"; payload: ListingSharePayload }
  | { name: "listing_whatsapp_click"; payload: ListingWhatsappClickPayload }
  | { name: "zero_results_notify"; payload: ZeroResultsNotifyPayload }
  | { name: "estate_view"; payload: EstateViewPayload }
  | { name: "district_view"; payload: DistrictViewPayload }
  | { name: "transaction_share"; payload: TransactionSharePayload }
  | { name: "transaction_filter"; payload: TransactionFilterPayload }
  | { name: "agent_view"; payload: AgentViewPayload }
  | { name: "agent_whatsapp_click"; payload: AgentWhatsappClickPayload }
  | { name: "whatsapp_cta_click"; payload: WhatsappCtaClickPayload }
  | { name: "contact_form_submit"; payload: ContactFormSubmitPayload }
  | { name: "valuation_form_submit"; payload: ValuationFormSubmitPayload }
  | { name: "mortgage_calculate"; payload: MortgageCalculatePayload }
  | { name: "mortgage_scenario_save"; payload: MortgageScenarioSavePayload }
  | { name: "article_view"; payload: ArticleViewPayload }
  | { name: "video_click"; payload: VideoClickPayload };

export const ANALYTICS_EVENT_NAMES: AnalyticsEvent["name"][] = [
  "listing_search",
  "listing_view",
  "listing_share",
  "listing_whatsapp_click",
  "zero_results_notify",
  "estate_view",
  "district_view",
  "transaction_share",
  "transaction_filter",
  "agent_view",
  "agent_whatsapp_click",
  "whatsapp_cta_click",
  "contact_form_submit",
  "valuation_form_submit",
  "mortgage_calculate",
  "mortgage_scenario_save",
  "article_view",
  "video_click",
];

/**
 * Provider-agnostic sink. No analytics provider has been chosen yet (master
 * plan open input #11), so this stays a real no-op in production. The
 * DEV-only console line is the only way to verify wiring locally until a
 * provider exists -- it never runs in a production build.
 */
export function track(event: AnalyticsEvent, context: AnalyticsContext): void {
  if (import.meta.env.DEV) {
    console.debug("[analytics]", event.name, { ...event.payload, ...context });
  }
}

/**
 * Fires a view event once per mount (not once per re-render). `build`
 * returning null skips the event -- e.g. while loader data hasn't resolved
 * yet -- without the caller needing its own guard.
 */
export function useTrackPageView(
  build: () => { event: AnalyticsEvent; context: AnalyticsContext } | null,
  deps: unknown[],
): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    const result = build();
    if (!result) return;
    fired.current = true;
    track(result.event, result.context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
