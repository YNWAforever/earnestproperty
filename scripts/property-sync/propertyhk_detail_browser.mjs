import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { digest, parseArgs } from "./price_status_diff.mjs";

export function detailIdentity(value) {
  const url = new URL(value);
  const match = /^\/asking_detail\/(?:[a-z]+\/[a-z0-9_-]+\/)?(\d{1,12})\.html$/.exec(url.pathname);
  if (url.origin !== "https://www.property.hk" || url.search || url.hash || !match)
    throw Error("unapproved_detail_url");
  return match[1];
}
export function parseDetail(dom, url, capturedAt) {
  const refs = [...new Set(dom.refs.map((s) => s.normalize("NFKC").replace(/\s+/g, "")))];
  const ref = refs.length === 1 && /^物業編號[:：]([A-Z][0-9]{6})$/.exec(refs[0]);
  if (!dom.license || !ref) throw Error("detail_identity_missing");
  const field = (labels, multiplier) => {
    const values = dom.fields
      .filter(([label]) => labels.includes(label))
      .map(([, raw]) => {
        const cleaned = raw.replace(/[,\s]/g, "");
        if (["--", "面議", "已售", "已租", "已撤盤", "已下架"].includes(cleaned)) return null;
        const match = /^\$(\d+(?:\.\d+)?)(萬)?$/.exec(cleaned);
        if (!match || (multiplier === 10000 && !match[2]) || (multiplier === 1 && match[2]))
          throw Error("detail_amount_invalid");
        const amount = Number(match[1]) * multiplier;
        if (!Number.isSafeInteger(amount) || amount <= 0) throw Error("detail_amount_invalid");
        return String(amount);
      });
    if (new Set(values).size > 1) throw Error("conflicting_detail_amount");
    return values[0] ?? null;
  };
  const labels = [...new Set(dom.lifecycle)];
  if (labels.length > 1 || labels.some((v) => !["已售", "已租", "已撤盤", "已下架"].includes(v)))
    throw Error("conflicting_detail_status");
  const reason =
    { 已售: "sold", 已租: "rented", 已撤盤: "delisted", 已下架: "delisted" }[labels[0]] ?? null;
  const price = field(["售價", "出售價"], 10000),
    rent = field(["出租價", "租金"], 1);
  if (!reason && price == null && rent == null) throw Error("detail_offers_missing");
  return {
    property_id: detailIdentity(url),
    agency_property_no: ref[1],
    captured_at: capturedAt,
    price,
    rent,
    source_status: reason ? "delisted" : "active",
    source_status_reason: reason,
    identity_verified: true,
    evidence_hash: digest(JSON.stringify(dom)),
  };
}

// Runs in the page. Select only identity, quoted amounts and explicit status;
// personal contacts and the rest of the body never leave the browser.
export function readDetailDom() {
  const fields = [],
    lifecycle = [];
  for (const tr of document.querySelectorAll("tr")) {
    const label = tr.querySelector(":scope > .lbl"),
      value = tr.querySelector(":scope > .val");
    if (!label || !value) continue;
    const name = label.textContent.trim().replace(/[:：]$/, "");
    if (!["售價", "出售價", "出租價", "租金", "狀態", "樓盤狀態"].includes(name)) continue;
    const clone = value.cloneNode(true);
    for (const node of clone.querySelectorAll(".mortgage, script, style")) node.remove();
    const text = clone.textContent.trim();
    const status = text.match(/已售|已租|已撤盤|已下架/g) ?? [];
    lifecycle.push(...status);
    if (!["狀態", "樓盤狀態"].includes(name))
      fields.push([name, text.replace(/已售|已租|已撤盤|已下架/g, "").trim() || text]);
  }
  return {
    refs: [...document.querySelectorAll(".refno")].map((n) => n.textContent.trim()),
    license: /\bC-018613(?:-A\d{3})?\b/.test(document.body.textContent),
    fields,
    lifecycle,
  };
}

export async function collectDetails(
  urls,
  {
    chromium,
    executablePath,
    now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  },
) {
  if (
    !Array.isArray(urls) ||
    urls.length > 1000 ||
    new Set(urls.map(detailIdentity)).size !== urls.length ||
    !isAbsolute(executablePath ?? "")
  )
    throw Error("invalid_browser_input");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^(?:http|https|all|no)_proxy$/i.test(name)),
  );
  const browser = await chromium.launch({ executablePath, headless: true, env });
  let context;
  try {
    context = await browser.newContext(); // Fresh, in-memory; no storageState/cookie import/export.
    const page = await context.newPage();
    let lastNavigation = null,
      stop = null,
      status = null;
    await context.route("**/*", async (route) => {
      if (stop) return route.abort();
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        try {
          detailIdentity(request.url());
        } catch {
          stop = "unexpected_navigation";
          return route.abort();
        }
        if (lastNavigation !== null) await sleep(Math.max(0, 3000 - (now() - lastNavigation)));
        lastNavigation = now();
        if (stop) return route.abort();
      }
      return route.continue();
    });
    page.on("response", (response) => {
      if (response.status() === 429) stop = "rate_limited";
      if (response.request().isNavigationRequest() && response.frame() === page.mainFrame())
        status = response.status();
    });
    const listings = [];
    for (const url of urls) {
      let result;
      for (let attempt = 0; attempt < 4 && !result; attempt++) {
        if (stop) throw Error(stop);
        status = null;
        const start = now();
        try {
          await page.goto(url, { waitUntil: "commit", timeout: 20000 });
        } catch {
          if (stop) throw Error(stop);
        }
        let challenge = false;
        while (now() - start < 20000) {
          if (stop) throw Error(stop);
          if (status === 401 || (status >= 400 && status < 500 && status !== 403))
            throw Error("detail_access_rejected");
          let title = "",
            dom;
          try {
            title = await page.title();
            dom = await page.evaluate(readDetailDom);
          } catch {
            /* reload in progress */
          }
          challenge ||= status === 403 || /正在驗證|安全檢查|captcha|verify.*browser/i.test(title);
          if (status === 200 && dom?.refs.length && !/正在驗證|安全檢查|captcha/i.test(title)) {
            if (page.url() !== url) throw Error("detail_identity_redirect");
            result = parseDetail(dom, url, new Date(now()).toISOString());
            break;
          }
          if (status >= 500 || (status === 200 && dom && !challenge)) break;
          await sleep(500);
        }
        // A security check has one bounded normal-browser opportunity, never four retries.
        if (!result && challenge) throw Error("challenge_not_cleared_20s");
        if (!result && attempt < 3) await sleep(3000);
      }
      if (!result) throw Error("detail_attempts_exhausted");
      listings.push(result);
      await sleep(3000);
    }
    return { schema: "propertyhk-details/v1", complete: true, absence_enabled: false, listings };
  } finally {
    try {
      await context?.close();
    } finally {
      await browser.close();
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2), ["urls", "out"]);
    const { chromium } = await import("playwright");
    const result = await collectDetails(JSON.parse(await readFile(args.urls, "utf8")), {
      chromium,
      executablePath: process.env.PROPERTYHK_BROWSER_EXECUTABLE,
    });
    await writeFile(args.out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  } catch {
    console.error("propertyhk_browser_failed_closed");
    process.exitCode = 2;
  }
}
