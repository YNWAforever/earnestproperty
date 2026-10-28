import { safePublicPath } from "./attribution.ts";
import { validateAnalytics } from "./privacy.ts";
export type Gtag = (...args: unknown[]) => void;
export function validGa4MeasurementId(value: unknown): value is string {
  return typeof value === "string" && /^G-[A-Z0-9]{10,16}$/.test(value);
}
// Only a small set of known search and AI services is sent to GA4. In
// particular, never forward a referrer's path, query, fragment or credentials.
const MEASURED_REFERRER_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "google.com.hk",
  "www.google.com.hk",
  "bing.com",
  "www.bing.com",
  "chatgpt.com",
  "www.chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "www.perplexity.ai",
  "claude.ai",
  "www.claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
]);
function measuredReferrer(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      MEASURED_REFERRER_HOSTS.has(url.hostname)
      ? `https://${url.hostname}/`
      : "";
  } catch {
    return "";
  }
}
export function createGa4Adapter(input: {
  measurementId?: unknown;
  documentIsolationApproved?: boolean;
  getPath: () => string;
  getReferrer?: () => string;
  origin?: string;
  gtag: Gtag;
  load: (measurementId: string) => unknown;
  approvedTokens?: readonly string[];
}) {
  let started = false;
  let currentReferrer = "";
  let documentReferrer = "";
  let observedPath: string | null = null;
  let observedPublicPath: string | null = null;
  const allowed = () =>
    validGa4MeasurementId(input.measurementId) &&
    input.documentIsolationApproved === true &&
    safePublicPath(input.getPath()) !== null;
  const page = (path: string, referrer = currentReferrer) => ({
    page_location: (input.origin ?? "") + path,
    page_title: "Earnest Property",
    page_referrer: referrer,
  });
  return {
    start(): boolean {
      try {
        if (!allowed()) return false;
        if (started) return true;
        const rawPath = input.getPath();
        const path = safePublicPath(rawPath)!;
        observedPath = rawPath;
        observedPublicPath = path;
        try {
          currentReferrer = measuredReferrer(input.getReferrer?.());
        } catch {
          currentReferrer = "";
        }
        documentReferrer = currentReferrer;
        input.gtag("js", new Date());
        input.gtag("config", input.measurementId, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          ...page(path),
        });
        input.load(input.measurementId as string);
        started = true;
        return true;
      } catch {
        return false;
      }
    },
    sink(event: unknown, context: unknown): void {
      try {
        if (!started || !allowed()) return;
        const clean = validateAnalytics(event, context, input.approvedTokens);
        if (!clean) return;
        // Route components may emit their view event before the provider emits
        // page_view. Advance on the first event observed at the new location.
        const rawPath = input.getPath();
        const publicPath = safePublicPath(rawPath);
        if (!publicPath) return;
        if (rawPath !== observedPath && observedPublicPath !== null) {
          currentReferrer = (input.origin ?? "") + observedPublicPath;
          observedPath = rawPath;
          observedPublicPath = publicPath;
        }
        const { route, utm, referrerHost, ...dimensions } = clean.context;
        const approvedReferrerHost =
          typeof referrerHost === "string" && MEASURED_REFERRER_HOSTS.has(referrerHost)
            ? referrerHost
            : undefined;
        // Web Vitals describe the original document, even after SPA navigation.
        const documentMetric = clean.event.name === "web_vital";
        const eventPage = page(route, documentMetric ? documentReferrer : currentReferrer);
        const fields = {
          ...eventPage,
          ...dimensions,
          ...(approvedReferrerHost ? { referrerHost: approvedReferrerHost } : {}),
          ...(typeof utm === "object" && utm ? utm : {}),
          ...clean.event.payload,
          send_to: input.measurementId,
        };
        if (!documentMetric) input.gtag("set", eventPage);
        input.gtag(
          "event",
          clean.event.name === "inquiry_conversion" ? "generate_lead" : clean.event.name,
          fields,
        );
      } catch {
        /* Analytics never changes application success/failure. */
      }
    },
  };
}
