// Local-only mobile lab run (FX-15). It hits a live network, so it is NOT run in CI:
// only the pure helpers below are covered by `npm run test:media`.
//
//   node scripts/perf/throttled-lab.mjs [--base=https://…] [--property=T027001]
//        [--runs=3] [--out=.cache/perf/x.json] [--share=<vercel share url>]
//
// Throttling matches the 2026-10 audit: 150 ms latency, 1.6 Mbps down, 750 kbps up,
// CPU x4, 412x823 at DPR 1.75. Read-only: /api, /w, /admin, non-GET, analytics
// beacons and wa.me are blocked, so a run creates no leads, clicks or analytics.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** LCP targets in ms. */
export const TARGETS = Object.freeze({ home: 4000, listings: 4000, property: 3500 });

const DEFAULT_BASE = "https://www.earnestproperty.com";
const DEFAULT_PROPERTY = "T027001";
const PAGES = ["home", "listings", "property"];

function stamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

function argValue(argv, name) {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function httpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an https URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new TypeError(`${label} must be an https URL`);
  return url;
}

export function parseLabArgs(argv) {
  const base = httpsUrl(argValue(argv, "base") ?? DEFAULT_BASE, "base").origin;
  const runsValue = argValue(argv, "runs") ?? "3";
  const runs = Number(runsValue);
  if (!/^\d+$/.test(runsValue) || runs < 1 || runs > 10) throw new TypeError("runs must be 1..10");
  const property = argValue(argv, "property") ?? DEFAULT_PROPERTY;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(property)) throw new TypeError("invalid property number");
  const out = argValue(argv, "out") ?? `.cache/perf/throttled-${stamp()}.json`;
  if (
    !out ||
    path.isAbsolute(out) ||
    path.win32.isAbsolute(out) ||
    /^[A-Za-z]:/.test(out) ||
    out.split(/[\\/]/).includes("..")
  )
    throw new TypeError("out must be a workspace-relative path");
  const shareValue = argValue(argv, "share");
  const share = shareValue ? httpsUrl(shareValue, "share").href : null;
  return { base, property, runs, out, share };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median LCP per page against TARGETS. A page with no usable LCP fails. */
export function evaluateTargets(results) {
  return PAGES.map((page) => {
    const values = results
      .filter((row) => row.page === page && Number.isFinite(row.lcp))
      .map((row) => row.lcp);
    const medianLcp = values.length ? median(values) : null;
    const target = TARGETS[page];
    return { page, medianLcp, target, pass: medianLcp !== null && medianLcp < target };
  });
}

/** True for requests the lab must never let through. */
export function shouldBlock(url, method) {
  if (!["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase())) return true;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (/^\/(api|w|admin)(\/|$)/.test(parsed.pathname)) return true;
  if (/insights\/event|speed-insights\/vitals|\/g\/collect/.test(url)) return true;
  return /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/.test(parsed.hostname);
}

// Metric observers, from the audit (lane-f/audit.mjs INIT). Injected before page scripts.
const INIT = `
(() => {
  const describe = (el) => {
    if (!el || !el.tagName) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0,4).join('.');
    const src = el.currentSrc || el.src || '';
    const txt = (el.innerText || '').trim().slice(0,60);
    return { sel: s, src: src ? src.slice(0,200) : undefined, text: txt || undefined };
  };
  const m = window.__m = { lcp: null, lcpSize: null, lcpEl: null, lcpUrl: null, clsWindows: [], shifts: [], fcp: null, longTasks: 0, tbtApprox: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { m.lcp = e.startTime; m.lcpSize = e.size; m.lcpEl = describe(e.element); m.lcpUrl = e.url || null; m.lcpRenderTime = e.renderTime; m.lcpLoadTime = e.loadTime; } }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    let cur = null;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      const t = e.startTime;
      if (!cur || t - cur.last > 1000 || t - cur.first > 5000) { cur = { first: t, last: t, value: 0 }; m.clsWindows.push(cur); }
      cur.last = t; cur.value += e.value;
      m.shifts.push({ t: Math.round(t), v: +e.value.toFixed(4), src: (e.sources||[]).slice(0,3).map(s => describe(s.node)) });
    } }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.name === 'first-contentful-paint') m.fcp = e.startTime; } }).observe({ type: 'paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { m.longTasks++; m.tbtApprox += Math.max(0, e.duration - 50); } }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
})();
`;

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

async function measureOnce(browser, options, page, url) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  });
  try {
    const tab = await context.newPage();
    await tab.route("**/*", (route) => {
      const request = route.request();
      return shouldBlock(request.url(), request.method())
        ? route.abort("blockedbyclient")
        : route.continue();
    });
    if (options.share) {
      // Passes Vercel Authentication on a preview; the cookie stays in this context.
      await tab.goto(options.share, { waitUntil: "load", timeout: 120000 });
    }
    const cdp = await context.newCDPSession(tab);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await tab.addInitScript(INIT);
    const started = Date.now();
    await tab.goto(url, { waitUntil: "load", timeout: 120000 });
    try {
      await tab.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // A page that never goes idle is still measured.
    }
    await tab.waitForTimeout(2000);
    const metrics = await tab.evaluate(() => {
      const m = window.__m;
      const nav = performance.getEntriesByType("navigation")[0];
      const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);
      return {
        ttfb: round(nav.responseStart),
        fcp: round(m.fcp),
        lcp: round(m.lcp),
        lcpEl: m.lcpEl,
        cls: +Math.max(0, ...m.clsWindows.map((w) => w.value)).toFixed(4),
        longTasks: m.longTasks,
        tbtApprox: round(m.tbtApprox),
        load: round(nav.loadEventEnd),
      };
    });
    return { page, wallMs: Date.now() - started, ...metrics };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseLabArgs(process.argv.slice(2));
  const { chromium } = await import("@playwright/test");
  const urls = {
    home: `${options.base}/`,
    listings: `${options.base}/listings?deal=sale&page=1&sort=newest`,
    property: `${options.base}/property/${options.property}`,
  };
  const browser = await chromium.launch();
  const runs = [];
  try {
    for (let run = 1; run <= options.runs; run += 1) {
      for (const page of PAGES) {
        const row = { run, ...(await measureOnce(browser, options, page, urls[page])) };
        runs.push(row);
        console.log(JSON.stringify(row));
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  } finally {
    await browser.close();
  }
  const summary = evaluateTargets(runs);
  console.log("\npage       median LCP ms   target ms   result");
  for (const row of summary)
    console.log(
      `${row.page.padEnd(10)} ${String(row.medianLcp ?? "n/a").padStart(13)}   ${String(row.target).padStart(9)}   ${row.pass ? "PASS" : "FAIL"}`,
    );
  // The share URL (a credential) is deliberately not written out.
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(
    options.out,
    JSON.stringify({ base: options.base, at: new Date().toISOString(), summary, runs }, null, 1),
  );
  console.log(`\nwrote ${options.out}`);
  process.exitCode = summary.every((row) => row.pass) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main();
