import { VIDEO_CATEGORIES } from "../../content/video-categories.ts";
import {
  plainRecord,
  safeCampaignParams,
  safePublicPath,
  safeToken,
  safeReferrerHost,
} from "./attribution.ts";

type Validator = (value: unknown) => boolean;
const token: Validator = safeToken;
const bool: Validator = (v) => typeof v === "boolean";
const number: Validator = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12;
const count: Validator = (v) => number(v) && Number.isInteger(v);
const enumeration =
  (...values: string[]): Validator =>
  (v) =>
    typeof v === "string" && values.includes(v);
const deal = enumeration("all", "sale", "rent");
const listing = { listingNo: token, dealType: enumeration("sale", "rent") };
const optional =
  (validator: Validator): Validator =>
  (value) =>
    value === undefined || validator(value);
const EVENT_RULES: Record<string, Record<string, Validator>> = {
  listing_search: {
    dealType: deal,
    districtSlug: optional(token),
    minPrice: optional(number),
    maxPrice: optional(number),
    resultCount: count,
  },
  listing_view: listing,
  listing_share: { listingNo: token },
  listing_whatsapp_click: listing,
  zero_results_notify: { dealType: deal, districtSlug: optional(token), source: token },
  estate_view: { estateSlug: token, districtSlug: optional(token) },
  district_view: { districtSlug: token },
  transaction_share: {
    transactionId: (v) =>
      token(v) ||
      (typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)),
  },
  transaction_filter: {
    dealType: deal,
    districtSlug: optional(token),
    month: optional((v) => typeof v === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(v)),
    resultCount: count,
  },
  agent_view: { agentSlug: token },
  agent_whatsapp_click: { agentSlug: token },
  whatsapp_cta_click: { intent: optional(enumeration("buy", "rent", "valuation")), source: token },
  contact_form_submit: { hasPhone: bool },
  valuation_form_submit: { districtSlug: optional(token), estateSlug: optional(token) },
  mortgage_calculate: { hasIncome: bool },
  mortgage_scenario_save: { scenarioCount: count },
  article_view: { articleSlug: token },
  video_click: { videoId: token, category: optional(enumeration(...VIDEO_CATEGORIES)) },
  page_view: {},
  inquiry_conversion: {},
  web_vital: {
    metric: enumeration("CLS", "INP", "LCP"),
    value: number,
    delta: (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e12,
    rating: enumeration("good", "needs-improvement", "poor"),
    metricId: (v) => typeof v === "string" && v.length <= 64 && /^v\d+-\d+-\d+$/.test(v),
    device: enumeration("mobile", "desktop"),
  },
};
export type ValidatedAnalyticsEvent = { name: string; payload: Record<string, unknown> };
export type ValidatedAnalyticsContext = { route: string; [key: string]: unknown };
export function validateAnalytics(
  event: unknown,
  context: unknown,
  tokens: readonly string[] = [],
): { event: ValidatedAnalyticsEvent; context: ValidatedAnalyticsContext } | null {
  if (
    !plainRecord(event) ||
    Object.keys(event).some((k) => !["name", "payload"].includes(k)) ||
    typeof event.name !== "string" ||
    !Object.hasOwn(EVENT_RULES, event.name) ||
    !plainRecord(event.payload) ||
    !plainRecord(context)
  )
    return null;
  const rules = EVENT_RULES[event.name];
  const payload = event.payload;
  if (
    Object.keys(event.payload).some((k) => !Object.hasOwn(rules, k)) ||
    Object.entries(rules).some(([k, check]) => !check(payload[k]))
  )
    return null;
  if (
    Object.keys(context).some(
      (k) =>
        ![
          "route",
          "districtSlug",
          "estateSlug",
          "listingNo",
          "agentSlug",
          "utm",
          "landingPath",
          "referrerHost",
        ].includes(k),
    )
  )
    return null;
  const route = safePublicPath(context.route);
  if (!route) return null;
  for (const key of ["districtSlug", "estateSlug", "listingNo", "agentSlug"])
    if (context[key] !== undefined && !token(context[key])) return null;
  // Caller-provided attribution is never trusted at dispatch: only approved UTM tokens survive.
  if (
    context.utm !== undefined &&
    (!plainRecord(context.utm) ||
      Object.entries(context.utm).some(
        ([key, value]) =>
          !["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(key) ||
          typeof value !== "string" ||
          /@|\d{8,}|[\s?&#=%]/.test(value),
      ))
  )
    return null;
  const utm = safeCampaignParams(context.utm, tokens);
  const clean: ValidatedAnalyticsContext = { route };
  for (const key of ["districtSlug", "estateSlug", "listingNo", "agentSlug"])
    if (context[key] !== undefined) clean[key] = context[key];
  if (Object.keys(utm).length) clean.utm = utm;
  if (context.landingPath !== undefined) {
    const path = safePublicPath(context.landingPath);
    if (!path) return null;
    clean.landingPath = path;
  }
  if (context.referrerHost !== undefined) {
    if (
      typeof context.referrerHost !== "string" ||
      safeReferrerHost("https://" + context.referrerHost) !== context.referrerHost
    )
      return null;
    clean.referrerHost = context.referrerHost;
  }
  return {
    event: {
      name: event.name,
      payload: Object.fromEntries(Object.entries(event.payload).filter(([, v]) => v !== undefined)),
    },
    context: clean,
  };
}
