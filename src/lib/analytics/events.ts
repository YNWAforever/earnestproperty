import { useEffect, useRef } from "react";
import { captureFirstTouch, safeCampaignParams, safePublicPath } from "./attribution.ts";
import { validateAnalytics } from "./privacy.ts";
import type { ValidatedAnalyticsEvent, ValidatedAnalyticsContext } from "./privacy.ts";

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
  landingPath?: string;
  referrerHost?: string;
}

export function collectUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return safeCampaignParams(
    Object.fromEntries(new URLSearchParams(window.location.search)),
    approvedCampaignTokens,
  );
}
export function buildContext(
  partial: Omit<AnalyticsContext, "route" | "utm"> = {},
): AnalyticsContext {
  const route = typeof window === "undefined" ? "" : window.location.pathname;
  const utm = collectUtmParams();
  let firstTouch = null;
  if (typeof window !== "undefined" && analyticsEnabled() && safePublicPath(route)) {
    try {
      firstTouch = captureFirstTouch({
        enabled: true,
        pathname: route,
        search: window.location.search,
        referrer: document.referrer,
        storage: window.sessionStorage,
        approvedTokens: approvedCampaignTokens,
      });
    } catch {
      /* blocked browser storage */
    }
  }
  return {
    route,
    ...partial,
    ...(firstTouch ?? (Object.keys(utm).length > 0 ? { utm } : {})),
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

export type AnalyticsConfiguration = {
  enabled?: boolean;
  sink?: (event: ValidatedAnalyticsEvent, context: ValidatedAnalyticsContext) => unknown;
  getPath?: () => string;
  approvedCampaignTokens?: readonly string[];
};
export function createAnalyticsDispatcher(config: AnalyticsConfiguration = {}) {
  const enabled = config.enabled === true && typeof config.sink === "function";
  return {
    enabled,
    track(event: unknown, context: unknown): boolean {
      try {
        if (!enabled) return false;
        const currentPath =
          config.getPath?.() ?? (typeof window === "undefined" ? "" : window.location.pathname);
        if (!validateAnalytics({ name: "page_view", payload: {} }, { route: currentPath }))
          return false;
        const clean = validateAnalytics(event, context, config.approvedCampaignTokens);
        if (!clean) return false;
        void Promise.resolve(config.sink!(clean.event, clean.context)).catch(() => undefined);
        return true;
      } catch {
        return false;
      }
    },
  };
}
let approvedCampaignTokens: readonly string[] = [];
let dispatcher = createAnalyticsDispatcher();
const readinessListeners = new Set<() => void>();
/** Explicit injected adapter only; no provider or environment-based auto-enablement. */
export function configureAnalytics(config: AnalyticsConfiguration = {}): void {
  approvedCampaignTokens = config.approvedCampaignTokens ?? [];
  dispatcher = createAnalyticsDispatcher(config);
  if (dispatcher.enabled)
    for (const notify of readinessListeners) {
      try {
        notify();
      } catch {
        /* Optional observers cannot break configuration. */
      }
    }
}
export function analyticsEnabled(): boolean {
  return dispatcher.enabled;
}
export function track(event: AnalyticsEvent, context: AnalyticsContext): void {
  dispatcher.track(event, context);
}
export function trackMeasurement(event: unknown, context: unknown): boolean {
  return dispatcher.track(event, context);
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
    const attempt = () => {
      if (fired.current || !dispatcher.enabled) return;
      const result = build();
      if (!result || !dispatcher.track(result.event, result.context)) return;
      fired.current = true;
      readinessListeners.delete(attempt);
    };
    // A page effect may run before the sibling provider enables analytics.
    // Keep only this mounted hook's callback; cleanup discards obsolete views.
    readinessListeners.add(attempt);
    attempt();
    return () => {
      readinessListeners.delete(attempt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const CONVERSION_KEY = "earnest:analytics:inquiry-conversions:v1";
const inquiryId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
/** IDs remain only in the bounded local replay ledger, never in analytics payloads. */
export function createInquiryConversionTracker(input: {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  emit: () => boolean;
  getPath: () => string;
  enabled: () => boolean;
}) {
  const seen = new Set<string>();
  return (id: unknown): boolean => {
    try {
      if (!input.enabled() || !safePublicPath(input.getPath()) || !inquiryId(id) || !input.storage)
        return false;
      const canonicalId = id.toLowerCase();
      if (seen.has(canonicalId)) return false;
      const raw = input.storage.getItem(CONVERSION_KEY);
      // A corrupt ledger cannot prove an ID was not previously sent: fail closed.
      const stored: unknown = raw === null ? [] : raw.length <= 20000 ? JSON.parse(raw) : null;
      if (!Array.isArray(stored) || stored.length >= 500 || !stored.every(inquiryId)) return false;
      if (stored.some((value) => value.toLowerCase() === canonicalId)) {
        seen.add(canonicalId);
        return false;
      }
      input.storage.setItem(CONVERSION_KEY, JSON.stringify([...stored, canonicalId]));
      seen.add(canonicalId);
      return input.emit();
    } catch {
      return false;
    }
  };
}
let conversionTracker: ReturnType<typeof createInquiryConversionTracker> | undefined;
/** Call only after the server returned the durable inquiry ID. Analytics cannot break success UI. */
export function trackInquiryConversion(id: unknown): boolean {
  try {
    if (
      typeof window === "undefined" ||
      !analyticsEnabled() ||
      !safePublicPath(window.location.pathname)
    )
      return false;
    conversionTracker ??= createInquiryConversionTracker({
      storage: window.sessionStorage,
      enabled: analyticsEnabled,
      getPath: () => window.location.pathname,
      emit: () => trackMeasurement({ name: "inquiry_conversion", payload: {} }, buildContext()),
    });
    return conversionTracker(id);
  } catch {
    return false;
  }
}
