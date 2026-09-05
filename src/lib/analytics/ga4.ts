import { safePublicPath } from "./attribution.ts";
import { validateAnalytics } from "./privacy.ts";
export type Gtag = (...args: unknown[]) => void;
export function validGa4MeasurementId(value: unknown): value is string {
  return typeof value === "string" && /^G-[A-Z0-9]{10,16}$/.test(value);
}
export function createGa4Adapter(input: {
  measurementId?: unknown;
  documentIsolationApproved?: boolean;
  getPath: () => string;
  origin?: string;
  gtag: Gtag;
  load: (measurementId: string) => unknown;
  approvedTokens?: readonly string[];
}) {
  let started = false;
  const allowed = () =>
    validGa4MeasurementId(input.measurementId) &&
    input.documentIsolationApproved === true &&
    safePublicPath(input.getPath()) !== null;
  const page = (path: string) => ({
    page_location: (input.origin ?? "") + path,
    page_title: "Earnest Property",
    page_referrer: "",
  });
  return {
    start(): boolean {
      try {
        if (!allowed()) return false;
        if (started) return true;
        const path = safePublicPath(input.getPath())!;
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
        const { route, utm, ...dimensions } = clean.context;
        const fields = {
          ...page(route),
          ...dimensions,
          ...(typeof utm === "object" && utm ? utm : {}),
          ...clean.event.payload,
          send_to: input.measurementId,
        };
        input.gtag("set", page(route));
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
