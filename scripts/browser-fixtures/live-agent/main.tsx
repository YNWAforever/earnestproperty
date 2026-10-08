// Owned browser fixture: the actual public live-agent widget, opened. Its /api/live-agent/*
// calls are answered by the Playwright spec (e2e/live-agent-cards.spec.ts) with fixed JSON, so
// no database, provider or network is involved.
import { createRoot } from "react-dom/client";
import { LiveAgentWidget } from "@/components/live-agent/LiveAgentWidget";
import "@/styles.css";

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-3xl px-4 py-8">
    <h1 className="text-lg font-semibold">Live agent fixture</h1>
    <LiveAgentWidget initiallyOpen />
  </main>,
);
