import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { collectDetails } from "./propertyhk_detail_browser.mjs";

// Every response is synthetic; DNS is disabled as a second network boundary.
function offlineBrowser(html, fulfilled) {
  return {
    async launch(options) {
      const browser = await chromium.launch({
        ...options,
        args: [...options.args, "--host-resolver-rules=MAP * ~NOTFOUND"],
      });
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (contextOptions) => {
        const context = await newContext(contextOptions);
        // Registered first so the collector's boundary/pacing routes run first.
        await context.route("**/*", async (route) => {
          const path = new URL(route.request().url()).pathname;
          fulfilled.push({ path, at: performance.now() });
          if (/^\/asking_detail\/(?:100|101)\.html$/.test(path))
            await route.fulfill({
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: html,
            });
          else if (
            ["/synthetic-blocking.js", "/one.png", "/two.png", "/favicon.ico"].includes(path)
          )
            await route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
          else await route.abort();
        });
        return context;
      };
      return browser;
    },
  };
}

test("Property.hk waits for a paced blocking script before parsing the complete detail DOM", async () => {
  const url = "https://www.property.hk/asking_detail/100.html";
  const fulfilled = [];
  // The reference is parsed before the blocking script, while amounts follow it.
  const html = `<!doctype html><html><head><title>Synthetic detail</title></head><body>
    <p>C-018613</p><div class="refno">物業編號：A000001</div>
    <script src="/synthetic-blocking.js"></script>
    <table><tr><td class="lbl">售價</td><td class="val">$500萬</td></tr></table>
    </body></html>`;
  const result = await collectDetails([url], {
    chromium: offlineBrowser(html, fulfilled),
    executablePath: process.env.PROPERTYHK_BROWSER_EXECUTABLE || chromium.executablePath(),
  });
  assert.equal(result.complete, true);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].agency_property_no, "A000001");
  assert.equal(result.listings[0].price, "5000000");
  const main = fulfilled.find((r) => r.path === "/asking_detail/100.html");
  const script = fulfilled.find((r) => r.path === "/synthetic-blocking.js");
  assert.ok(script.at - main.at >= 2950, "blocking script must pass through request pacing");
});

test("Property.hk continues to the next detail when navigation cancels queued resources", async () => {
  const fulfilled = [];
  const html = `<!doctype html><html><head><title>Synthetic detail</title>
    <script src="/synthetic-blocking.js"></script></head><body>
    <p>C-018613</p><div class="refno">物業編號：A000001</div>
    <table><tr><td class="lbl">售價</td><td class="val">$500萬</td></tr></table>
    <img src="/one.png"><img src="/two.png"></body></html>`;
  const result = await collectDetails(
    [
      "https://www.property.hk/asking_detail/100.html",
      "https://www.property.hk/asking_detail/101.html",
    ],
    {
      chromium: offlineBrowser(html, fulfilled),
      executablePath: process.env.PROPERTYHK_BROWSER_EXECUTABLE || chromium.executablePath(),
    },
  );
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.listings.map((r) => r.property_id),
    ["100", "101"],
  );
  assert.ok(result.listings.every((r) => r.price === "5000000"));
});
