import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as events from "./events.ts";
import * as attribution from "./attribution.ts";
import * as ga4 from "./ga4.ts";
import * as lifecycle from "./runtime.ts";
const source = readFileSync(
  new URL("../../components/analytics/AnalyticsProvider.tsx", import.meta.url),
  "utf8",
);
function load(environment, vitals) {
  const code = ts.transpileModule(source.replaceAll("import.meta.env.", "analyticsEnvironment."), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("exports", "require", "analyticsEnvironment", code)(
    exports,
    (name) =>
      ({
        react: { useEffect: (fn) => fn() },
        "@/lib/analytics/events": events,
        "@/lib/analytics/attribution": attribution,
        "@/lib/analytics/ga4": ga4,
        "@/lib/analytics/runtime": lifecycle,
        "web-vitals": vitals,
      })[name],
    environment,
  );
  return exports.AnalyticsProvider;
}
test("actual mount keeps invalid configuration and private documents entirely inert", () => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  try {
    for (const [path, id, confirmed] of [
      ["/admin/cms", "G-ABCDEFGHIJ", "true"],
      ["/contact", "", "true"],
      ["/contact", "G-ABCDEFGHIJ", "false"],
      ["/auth/login", "G-ABCDEFGHIJ", "true"],
      ["/account/me", "G-ABCDEFGHIJ", "true"],
    ]) {
      let sideEffects = 0;
      globalThis.window = {
        location: { pathname: path, origin: "https://example.test", search: "" },
      };
      globalThis.document = {
        getElementById: () => {
          sideEffects++;
          return null;
        },
        createElement: () => {
          sideEffects++;
          return {};
        },
        head: { appendChild: () => sideEffects++ },
      };
      const Provider = load(
        { VITE_GA4_MEASUREMENT_ID: id, VITE_GA4_MANUAL_EVENTS_CONFIRMED: confirmed },
        {},
      );
      Provider({ pathname: path, documentIsolationApproved: true });
      assert.equal(sideEffects, 0);
      assert.equal(window.dataLayer, undefined);
    }
  } finally {
    events.configureAnalytics();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
test("actual public mount registers once and emits only sanitized page/vital fields through fake gtag", async () => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  let scripts = 0,
    observers = 0;
  const callbacks = {};
  try {
    const s = new Map();
    globalThis.window = {
      location: {
        pathname: "/property/person@example.com",
        origin: "https://example.test",
        search: "?email=secret",
      },
      sessionStorage: {
        getItem: (k) => s.get(k) ?? null,
        setItem: (k, v) => s.set(k, v),
        removeItem: (k) => s.delete(k),
      },
      matchMedia: () => ({ matches: true }),
    };
    globalThis.document = {
      referrer: "https://example.org/private?email=secret",
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild: () => scripts++ },
    };
    const Provider = load(
      { VITE_GA4_MEASUREMENT_ID: "G-ABCDEFGHIJ", VITE_GA4_MANUAL_EVENTS_CONFIRMED: "true" },
      Object.fromEntries(
        ["CLS", "LCP", "INP"].map((name) => [
          "on" + name,
          (cb) => {
            observers++;
            callbacks[name] = cb;
          },
        ]),
      ),
    );
    Provider({ pathname: window.location.pathname, documentIsolationApproved: true });
    await new Promise((r) => setTimeout(r, 0));
    Provider({ pathname: window.location.pathname, documentIsolationApproved: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(scripts, 1);
    assert.equal(observers, 3);
    callbacks.CLS({
      name: "CLS",
      value: 0.012,
      delta: 0.012,
      rating: "good",
      id: "v6-1234567890123-1234567890",
    });
    const commands = window.dataLayer.map((args) => Array.from(args));
    assert.equal(commands.filter((c) => c[0] === "event" && c[1] === "page_view").length, 1);
    assert.equal(commands.at(-1)[2].value, 0.012);
    assert.doesNotMatch(JSON.stringify(commands), /person@example|email=secret|\/private\?/);
  } finally {
    events.configureAnalytics();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
