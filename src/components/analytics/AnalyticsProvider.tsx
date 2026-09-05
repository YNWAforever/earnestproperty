import { useEffect } from "react";
import { analyticsEnabled, configureAnalytics, trackMeasurement } from "@/lib/analytics/events";
import { safePublicPath } from "@/lib/analytics/attribution";
import { createGa4Adapter, validGa4MeasurementId } from "@/lib/analytics/ga4";
import { createAnalyticsRuntime } from "@/lib/analytics/runtime";

const NO_CAMPAIGN_TOKENS: readonly string[] = [];
let runtime: ReturnType<typeof createAnalyticsRuntime> | undefined;
/** Root must enforce a fresh document at every public/private boundary before approving this. */
export function AnalyticsProvider({
  pathname,
  documentIsolationApproved = false,
  approvedCampaignTokens = NO_CAMPAIGN_TOKENS,
}: {
  pathname: string;
  documentIsolationApproved?: boolean;
  approvedCampaignTokens?: readonly string[];
}) {
  useEffect(() => {
    const id: unknown = import.meta.env.VITE_GA4_MEASUREMENT_ID;
    const manualEventsConfirmed = import.meta.env.VITE_GA4_MANUAL_EVENTS_CONFIRMED === "true";
    if (
      !validGa4MeasurementId(id) ||
      !manualEventsConfirmed ||
      !documentIsolationApproved ||
      !safePublicPath(pathname)
    )
      return;
    if (!runtime) {
      const browser = window as typeof window & {
        dataLayer?: unknown[];
        gtag?: (...args: unknown[]) => void;
      };
      browser.dataLayer ??= [];
      // Google tag command queues use the Arguments object, as in the official bootstrap.
      browser.gtag ??= function () {
        // eslint-disable-next-line prefer-rest-params
        browser.dataLayer!.push(arguments);
      };
      const adapter = createGa4Adapter({
        measurementId: id,
        approvedTokens: approvedCampaignTokens,
        documentIsolationApproved,
        getPath: () => window.location.pathname,
        origin: window.location.origin,
        gtag: (...args) => browser.gtag!(...args),
        load: (measurementId) => {
          if (document.getElementById("earnest-ga4")) return;
          const script = document.createElement("script");
          script.id = "earnest-ga4";
          script.async = true;
          script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
          document.head.appendChild(script);
        },
      });
      if (!adapter.start()) return;
      configureAnalytics({ enabled: true, sink: adapter.sink, approvedCampaignTokens });
      let storage: Storage | null = null;
      try {
        storage = window.sessionStorage;
      } catch {
        /* blocked storage */
      }
      runtime = createAnalyticsRuntime({
        enabled: analyticsEnabled,
        getPath: () => window.location.pathname,
        emit: trackMeasurement,
        storage,
        approvedTokens: approvedCampaignTokens,
        documentIsolationApproved,
        loadVitals: () => import("web-vitals"),
        getSearch: () => window.location.search,
        getReferrer: () => document.referrer,
        getDevice: () => (window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop"),
      });
    }
    void runtime.enter(pathname);
  }, [pathname, documentIsolationApproved, approvedCampaignTokens]);
  return null;
}
