// Owned browser fixture: the actual public live-agent widget, opened. Its /api/live-agent/*
// calls are answered by the Playwright spec (e2e/live-agent-cards.spec.ts) with fixed JSON, so
// no database, provider or network is involved.
//
// FX-16 F-07 adds three scenes for e2e/public-mobile-chrome.spec.ts. Each mirrors the public
// root (`__root.tsx`): the same page reservation, the real mobile bar and the real launcher.
// - `?scene=chrome`: long content, an owner-form stand-in, a footer, StickyWhatsAppBar and the
//   docked launcher.
// - `?scene=property`: the same page with the property bar (PropertyDecisionActions) instead.
// - `?scene=desktop`: the undocked launcher only, i.e. main's pill.
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LiveAgentLauncher } from "@/components/live-agent/LiveAgentLauncher";
import { LiveAgentWidget } from "@/components/live-agent/LiveAgentWidget";
import { PropertyDecisionActions } from "@/components/property/PropertyDecisionActions";
import { StickyWhatsAppBar } from "@/components/site/StickyWhatsAppBar";
import { SITE_BRANCHES } from "@/config/site";
import "@/styles.css";

// The generic bar is an <aside> outside <main> (root); the property bar renders inside the
// route, so inside <main>, exactly as on the site.
export function ChromePage({ bar, barInMain = false }: { bar: ReactNode; barInMain?: boolean }) {
  return (
    <>
      <div className="flex min-h-screen flex-col pb-[calc(3.8125rem+env(safe-area-inset-bottom))] lg:pb-0">
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
          <h1 className="text-lg font-semibold">Mobile chrome fixture</h1>
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
      <LiveAgentLauncher docked />
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
  if (scene === "desktop") return <LiveAgentLauncher docked={false} />;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold">Live agent fixture</h1>
      <LiveAgentWidget initiallyOpen />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Scene />);
