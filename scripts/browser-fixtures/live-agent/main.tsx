// Owned browser fixture: the actual public live-agent widget, opened. Its /api/live-agent/*
// calls are answered by the Playwright spec (e2e/live-agent-cards.spec.ts) with fixed JSON, so
// no database, provider or network is involved.
//
// FX-16 F-07 adds scenes for e2e/public-mobile-chrome.spec.ts. Each mirrors the public root
// (`__root.tsx`): the same reservation class and the same launcher, both imported from the code
// the root uses, so the fixture exercises the root's real dock/reserve rule (a bar in the DOM).
// - `?scene=chrome`: long content, an owner-form stand-in, a footer and StickyWhatsAppBar.
// - `?scene=property`: the same page with the property bar (PropertyDecisionActions) inside main.
// - `?scene=property-unavailable`: a property page with no bar, as for a sold, rented, not-found
//   or failed listing (the route renders no PropertyDecisionActions there).
// - `?scene=plain`: a normal page with no bar (as /dashboard).
// - `?scene=mortgage`: the real MortgageCalculator (FX-16 F-21, live results while typing).
// The default scene loads the widget lazily (the same chunk the launcher imports), so a spec can
// delay or fail that chunk to see the launcher's loading and retry states.
import { lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LiveAgentLauncher } from "@/components/live-agent/LiveAgentLauncher";
import { PropertyDecisionActions } from "@/components/property/PropertyDecisionActions";
import { MortgageCalculator } from "@/components/site/MortgageCalculator";
import { StickyWhatsAppBar } from "@/components/site/StickyWhatsAppBar";
import { MOBILE_ACTION_BAR_RESERVE_CLASS } from "@/components/site/mobile-action-bar";
import { SITE_BRANCHES } from "@/config/site";
import "@/styles.css";

const LazyLiveAgentWidget = lazy(() =>
  import("@/components/live-agent/LiveAgentWidget").then((module) => ({
    default: module.LiveAgentWidget,
  })),
);

// The generic bar is an <aside> outside <main> (root); the property bar renders inside the
// route, so inside <main>, exactly as on the site.
export function ChromePage({
  bar = null,
  barInMain = false,
  heading = "Mobile chrome fixture",
}: {
  bar?: ReactNode;
  barInMain?: boolean;
  heading?: string;
}) {
  return (
    <>
      <div className={`flex min-h-screen flex-col ${MOBILE_ACTION_BAR_RESERVE_CLASS}`}>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <h1 className="text-lg font-semibold">{heading}</h1>
          {Array.from({ length: 60 }, (_, index) => (
            <p className="mt-3 text-sm" key={index}>
              段落 {index + 1}：深井、青山公路及汀九一帶的物業資料。
            </p>
          ))}
          <form
            aria-label="業主估價"
            className="mt-8 space-y-3"
            data-owner-form
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="block text-sm" htmlFor="owner-name">
              姓名
            </label>
            <input className="block h-11 w-full rounded-md border px-3" id="owner-name" />
            <label className="block text-sm" htmlFor="owner-phone">
              電話
            </label>
            <input className="block h-11 w-full rounded-md border px-3" id="owner-phone" />
            <button
              className="h-11 w-full rounded-md bg-primary text-primary-foreground"
              type="submit"
            >
              提交估價
            </button>
          </form>
          {barInMain ? bar : null}
        </main>
        <footer className="border-t px-4 py-6">
          <ul className="space-y-1 text-sm" data-footer-links>
            {Array.from({ length: 20 }, (_, index) => (
              <li key={index}>
                <a className="inline-flex min-h-11 items-center" href={`#footer-${index + 1}`}>
                  頁尾連結 {index + 1}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      </div>
      {barInMain ? null : bar}
      <LiveAgentLauncher />
    </>
  );
}

export function Scene() {
  const scene = new URLSearchParams(location.search).get("scene");
  if (scene === "chrome") return <ChromePage bar={<StickyWhatsAppBar />} />;
  if (scene === "property") {
    return (
      <ChromePage
        barInMain
        bar={
          <PropertyDecisionActions
            agent={null}
            branchContact={SITE_BRANCHES[0]}
            fallbackWhatsapp="85291234567"
            listingNo="B059390"
            title="測試售盤"
            dealType="sale"
            price={8_880_000}
            onInquiry={() => undefined}
          />
        }
      />
    );
  }
  if (scene === "property-unavailable") return <ChromePage heading="Property fixture, no bar" />;
  if (scene === "plain") return <ChromePage />;
  if (scene === "mortgage") return <MortgageCalculator initialSearch={{}} />;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold">Live agent fixture</h1>
      <Suspense fallback={null}>
        <LazyLiveAgentWidget initiallyOpen />
      </Suspense>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Scene />);
