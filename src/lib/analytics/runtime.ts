import { captureFirstTouch, safePublicPath } from "./attribution.ts";
import type { AnalyticsStorage, FirstTouch } from "./attribution.ts";
export type VitalMetric = {
  name: string;
  value: number;
  delta: number;
  rating: string;
  id: string;
  navigationURL?: string;
};
type Vitals = {
  onCLS: (callback: (metric: VitalMetric) => void) => unknown;
  onINP: (callback: (metric: VitalMetric) => void) => unknown;
  onLCP: (callback: (metric: VitalMetric) => void) => unknown;
};
export function createAnalyticsRuntime(input: {
  enabled: () => boolean;
  getPath: () => string;
  emit: (event: unknown, context: unknown) => boolean;
  storage?: AnalyticsStorage | null;
  approvedTokens?: readonly string[];
  documentIsolationApproved?: boolean;
  loadVitals?: () => Promise<Vitals>;
  getSearch?: () => string;
  getReferrer?: () => string;
  getDevice?: () => "mobile" | "desktop";
}) {
  let disabled = false,
    privateVisited = false,
    started = false,
    previousPath: string | null = null;
  let landingPath: string | null = null,
    touch: FirstTouch | null = null;
  const active = () => !disabled && input.enabled() && safePublicPath(input.getPath()) !== null;
  return {
    disable() {
      disabled = true;
    },
    async enter(pathname: string): Promise<void> {
      try {
        if (!safePublicPath(pathname)) {
          privateVisited = true;
          previousPath = null;
          return;
        }
        if (!active()) return;
        const path = safePublicPath(pathname)!;
        landingPath ??= path;
        touch ??= captureFirstTouch({
          enabled: true,
          pathname,
          search: input.getSearch?.(),
          referrer: input.getReferrer?.(),
          storage: input.storage,
          approvedTokens: input.approvedTokens,
        });
        if (previousPath !== pathname) {
          previousPath = pathname;
          input.emit({ name: "page_view", payload: {} }, { route: path, ...touch });
        }
        if (started || privateVisited || !input.documentIsolationApproved || !input.loadVitals)
          return;
        started = true;
        const vitals = await input.loadVitals();
        if (!active() || privateVisited) return;
        const report = (metric: VitalMetric) => {
          if (!active() || privateVisited) return;
          // Document metrics belong to their measured navigation, never the current SPA URL.
          let measuredPath = landingPath;
          if (metric.navigationURL) {
            try {
              measuredPath = safePublicPath(new URL(metric.navigationURL).pathname);
            } catch {
              return;
            }
          }
          if (!measuredPath) return;
          input.emit(
            {
              name: "web_vital",
              payload: {
                metric: metric.name,
                value: metric.value,
                delta: metric.delta,
                rating: metric.rating,
                metricId: metric.id,
                device: input.getDevice?.() ?? "desktop",
              },
            },
            { route: measuredPath },
          );
        };
        // Official defaults report final/hidden/BFCache values; do not fabricate INP or round CLS.
        vitals.onCLS(report);
        vitals.onINP(report);
        vitals.onLCP(report);
      } catch {
        /* Optional analytics must not break navigation. */
      }
    },
  };
}
